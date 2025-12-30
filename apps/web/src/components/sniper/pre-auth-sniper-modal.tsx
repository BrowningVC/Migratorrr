'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import toast from 'react-hot-toast';
import { usePendingSniperStore } from '@/lib/stores/pending-sniper';
import { useAuthStore } from '@/lib/stores/auth';
import { useWalletsStore } from '@/lib/stores/wallets';
import { useSnipersStore, SniperConfig, Sniper } from '@/lib/stores/snipers';
import { sniperApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Copy, Check, Eye, EyeOff, Wallet, AlertTriangle, Shield, Crosshair } from 'lucide-react';

interface PreAuthSniperModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'basics' | 'buying' | 'selling' | 'filters' | 'review' | 'wallet';

interface GeneratedWallet {
  publicKey: string;
  privateKey: string;
}

const DEFAULT_CONFIG: SniperConfig = {
  snipeAmountSol: 0.1,
  slippageBps: 1000, // 10%
  priorityFeeSol: 0.003, // Minimum for reliable execution
  takeProfitPct: 100, // 2x
  stopLossPct: 50,
  trailingStopPct: undefined,
  minLiquiditySol: 5,
  mevProtection: true, // Enabled by default
};

export function PreAuthSniperModal({ isOpen, onClose }: PreAuthSniperModalProps) {
  const router = useRouter();
  const { setPendingSniper } = usePendingSniperStore();

  // Auth and wallet stores for authenticated users
  const { token, isAuthenticated, _hasHydrated: authHydrated } = useAuthStore();
  const { wallets, _hasHydrated: walletsHydrated } = useWalletsStore();
  const { addSniper } = useSnipersStore();

  const [step, setStep] = useState<Step>('basics');
  const [isCreatingSniper, setIsCreatingSniper] = useState(false);

  // Form state
  const [name, setName] = useState('My First Sniper');
  const [config, setConfig] = useState<SniperConfig>(DEFAULT_CONFIG);

  // Check if user is authenticated with a GENERATED wallet (server can sign)
  // Connected wallets don't work for sniping - server needs signing authority
  // Only check after stores have hydrated from localStorage
  const storesHydrated = authHydrated && walletsHydrated;
  const existingGeneratedWallet = wallets.find(w => w.walletType === 'generated');
  const hasExistingWallet = storesHydrated && isAuthenticated && token && !!existingGeneratedWallet;

  // Wallet generation state (for new wallets created in this modal)
  const [generatedWallet, setGeneratedWallet] = useState<GeneratedWallet | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copiedPublic, setCopiedPublic] = useState(false);
  const [copiedPrivate, setCopiedPrivate] = useState(false);
  const [hasBackedUp, setHasBackedUp] = useState(false);


  // Validation errors for buy settings
  const [validationErrors, setValidationErrors] = useState<{
    snipeAmountSol?: boolean;
    slippageBps?: boolean;
    priorityFeeSol?: boolean;
  }>({});

  const steps: Step[] = ['basics', 'buying', 'selling', 'filters', 'review', 'wallet'];
  const stepIndex = steps.indexOf(step);

  const stepLabels: Record<Step, string> = {
    basics: 'Name Your Sniper',
    buying: 'Buy Settings',
    selling: 'Exit Strategy',
    filters: 'Token Filters',
    review: 'Review Config',
    wallet: 'Your Wallet',
  };

  const updateConfig = (updates: Partial<SniperConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  // Create sniper directly for authenticated users with existing GENERATED wallet
  const handleCreateSniperDirect = async () => {
    if (!token || !hasExistingWallet || !existingGeneratedWallet) {
      toast.error('Please generate a trading wallet first');
      return;
    }

    setIsCreatingSniper(true);
    const toastId = toast.loading(`Creating sniper "${name}"...`);

    try {
      const res = await sniperApi.create(token, {
        walletId: existingGeneratedWallet.id,
        name,
        config: config as unknown as Record<string, unknown>,
        isActive: false,
      });

      if (res.success && res.data) {
        const sniperData = res.data;
        const newSniper: Sniper = {
          id: sniperData.id,
          name: sniperData.name,
          isActive: sniperData.isActive || false,
          walletId: existingGeneratedWallet.id,
          config,
          stats: {
            totalSnipes: 0,
            successfulSnipes: 0,
            failedSnipes: 0,
            totalSolSpent: 0,
            totalSolProfit: 0,
          },
          createdAt: sniperData.createdAt || new Date().toISOString(),
          updatedAt: sniperData.updatedAt || new Date().toISOString(),
        };

        addSniper(newSniper);
        toast.success(`Sniper "${name}" created successfully!`, { id: toastId });

        // Reset form and close modal
        setStep('basics');
        setName('My First Sniper');
        setConfig(DEFAULT_CONFIG);
        onClose();

        // Force dashboard refresh by navigating
        router.refresh();
      } else {
        throw new Error(res.error || 'Failed to create sniper');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create sniper',
        { id: toastId }
      );
    } finally {
      setIsCreatingSniper(false);
    }
  };

  const handleNext = () => {
    // Validate buy settings before proceeding
    if (step === 'buying') {
      const errors: typeof validationErrors = {};

      if (config.snipeAmountSol < 0.1) {
        errors.snipeAmountSol = true;
      }
      if (config.slippageBps < 1000) { // 10% minimum
        errors.slippageBps = true;
      }
      if (config.priorityFeeSol < 0.003) {
        errors.priorityFeeSol = true;
      }

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        toast.error('Please fix the highlighted fields');
        return;
      }

      setValidationErrors({});
    }

    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const handleGenerateWallet = () => {
    // Generate a new Solana keypair
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const privateKey = bs58.encode(keypair.secretKey);

    setGeneratedWallet({ publicKey, privateKey });
    setStep('wallet');
  };

  const copyToClipboard = async (text: string, type: 'public' | 'private') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'public') {
        setCopiedPublic(true);
        setTimeout(() => setCopiedPublic(false), 2000);
      } else {
        setCopiedPrivate(true);
        setTimeout(() => setCopiedPrivate(false), 2000);
      }
      toast.success(type === 'public' ? 'Address copied!' : 'Private key copied!');
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleContinueToSignup = () => {
    // SECURITY: Only pass public key to the store
    // The private key exists only in this component's memory and is never persisted
    // The store will strip any private key if accidentally passed
    setPendingSniper({
      name,
      config,
      createdAt: Date.now(),
      generatedWallet: generatedWallet
        ? { publicKey: generatedWallet.publicKey }
        : undefined,
    });

    // Clear sensitive data from component state
    setGeneratedWallet(null);
    setShowPrivateKey(false);

    // Navigate to onboarding
    router.push('/onboarding');
    onClose();
  };

  const handleClose = () => {
    // SECURITY: Warn user if they're closing without backing up
    if (step === 'wallet' && generatedWallet && !hasBackedUp) {
      const confirmed = window.confirm(
        'WARNING: You have not confirmed backing up your private key. ' +
        'If you close now, you will LOSE ACCESS to this wallet forever. ' +
        'Are you sure you want to close?'
      );
      if (!confirmed) return;
    }

    // Clear all state including sensitive wallet data
    setStep('basics');
    setName('My First Sniper');
    setConfig(DEFAULT_CONFIG);
    setGeneratedWallet(null);
    setShowPrivateKey(false);
    setHasBackedUp(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className={cn(
        "bg-zinc-900 border-zinc-800 w-full flex flex-col",
        step === 'filters' ? 'max-w-3xl max-h-[90vh]' : 'max-w-lg max-h-[85vh]'
      )}>
        <CardHeader className="border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Configure Your Sniper</CardTitle>
            <button
              onClick={handleClose}
              className="text-zinc-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step indicators */}
          <div className="flex gap-1 mt-4">
            {steps.map((s, i) => (
              <div
                key={s}
                className={cn(
                  'flex-1 h-1 rounded-full transition-colors',
                  i <= stepIndex ? 'bg-green-500' : 'bg-zinc-700'
                )}
              />
            ))}
          </div>
          <p className="text-sm text-zinc-500 mt-2">
            Step {stepIndex + 1} of {steps.length}: {stepLabels[step]}
          </p>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4">
          {/* Step 1: Basics */}
          {step === 'basics' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Sniper Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Alpha Sniper"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Give your sniper a memorable name
                </p>
              </div>

              <div className="bg-zinc-800/50 rounded-lg p-4 mt-4">
                <h4 className="font-medium text-sm mb-2">What is a Sniper?</h4>
                <p className="text-zinc-400 text-sm">
                  A sniper automatically buys tokens the moment they migrate from PumpFun to Raydium.
                  You configure the parameters, and it executes trades automatically for you, around the clock.
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Exit Strategy (Selling Options) */}
          {step === 'selling' && (
            <div className="space-y-4">
              {/* Take Profit - Required */}
              <div className="space-y-2">
                <Label htmlFor="takeProfit">
                  Take Profit (%) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="takeProfit"
                  type="number"
                  step="10"
                  min="10"
                  max="10000"
                  value={config.takeProfitPct}
                  onChange={(e) =>
                    updateConfig({
                      takeProfitPct: Math.max(10, parseFloat(e.target.value) || 100),
                    })
                  }
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Automatically sell when profit reaches this % (100% = 2x, 200% = 3x)
                </p>
              </div>

              {/* Cover Initials Checkbox */}
              <label className="flex items-start gap-3 cursor-pointer group p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50 hover:border-zinc-600 transition-colors">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={config.coverInitials ?? false}
                    onChange={(e) => updateConfig({ coverInitials: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 transition-colors flex items-center justify-center',
                    config.coverInitials
                      ? 'bg-green-600 border-green-600'
                      : 'border-zinc-600 group-hover:border-zinc-500'
                  )}>
                    {config.coverInitials && <Check className="w-3 h-3 text-white" />}
                  </div>
                </div>
                <div className="flex-1">
                  <span className="text-sm font-medium text-white">Cover Initials</span>
                  <p className="text-xs text-zinc-400 mt-1">
                    Sell 50% at 2x to recover your initial investment, then let the rest ride to take profit.
                  </p>
                </div>
              </label>

              {/* Stop Loss - Required */}
              <div className="space-y-2">
                <Label htmlFor="stopLoss">
                  Stop Loss (%) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="stopLoss"
                  type="number"
                  step="5"
                  min="5"
                  max="95"
                  value={config.stopLossPct}
                  onChange={(e) =>
                    updateConfig({
                      stopLossPct: Math.min(95, Math.max(5, parseFloat(e.target.value) || 50)),
                    })
                  }
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Sell when market cap drops this % from your entry (e.g., 50% = sell at half the MCAP you bought at)
                </p>
              </div>

              {/* Trailing Stop - Optional */}
              <div className="space-y-2">
                <Label htmlFor="trailingStop" className="text-zinc-400">
                  Trailing Stop (%) <span className="text-zinc-500 text-xs font-normal">— optional</span>
                </Label>
                <Input
                  id="trailingStop"
                  type="number"
                  step="5"
                  min="5"
                  max="50"
                  value={config.trailingStopPct || ''}
                  onChange={(e) =>
                    updateConfig({
                      trailingStopPct: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  placeholder="Leave empty to disable"
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Sell when price drops this % from its highest point
                </p>
              </div>

              {/* MEV Protection */}
              <div className="mt-4 pt-4 border-t border-zinc-700/50">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative mt-0.5">
                    <input
                      type="checkbox"
                      checked={config.mevProtection ?? true}
                      onChange={(e) => updateConfig({ mevProtection: e.target.checked })}
                      className="sr-only"
                    />
                    <div className={cn(
                      'w-5 h-5 rounded border-2 transition-colors flex items-center justify-center',
                      config.mevProtection ?? true
                        ? 'bg-green-600 border-green-600'
                        : 'border-zinc-600 group-hover:border-zinc-500'
                    )}>
                      {(config.mevProtection ?? true) && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-green-400" />
                      <span className="text-sm font-medium text-white">MEV Protection</span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                      Uses Jito bundles to protect your transactions from sandwich attacks and front-running bots.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Buy Settings */}
          {step === 'buying' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="snipeAmount">
                  Snipe Amount (SOL) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="snipeAmount"
                  type="text"
                  inputMode="decimal"
                  value={config.snipeAmountSol}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || val === '.') {
                      updateConfig({ snipeAmountSol: 0 });
                      return;
                    }
                    const parsed = parseFloat(val);
                    if (!isNaN(parsed)) {
                      updateConfig({ snipeAmountSol: parsed });
                      // Clear error when user starts typing
                      if (validationErrors.snipeAmountSol) {
                        setValidationErrors(prev => ({ ...prev, snipeAmountSol: false }));
                      }
                    }
                  }}
                  className={cn(
                    "bg-zinc-800 border-zinc-700",
                    validationErrors.snipeAmountSol && "border-red-500 focus:border-red-500 focus:ring-red-500"
                  )}
                />
                <p className={cn(
                  "text-xs",
                  validationErrors.snipeAmountSol ? "text-red-400" : "text-zinc-500"
                )}>
                  {validationErrors.snipeAmountSol
                    ? "Minimum 0.1 SOL required"
                    : "Amount of SOL to spend per snipe (minimum 0.1 SOL)"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="slippage">
                  Slippage Tolerance (%) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="slippage"
                  type="text"
                  inputMode="decimal"
                  value={config.slippageBps / 100}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || val === '.') {
                      updateConfig({ slippageBps: 0 });
                      return;
                    }
                    const parsed = parseFloat(val);
                    if (!isNaN(parsed)) {
                      updateConfig({ slippageBps: Math.round(parsed * 100) });
                      // Clear error when user starts typing
                      if (validationErrors.slippageBps) {
                        setValidationErrors(prev => ({ ...prev, slippageBps: false }));
                      }
                    }
                  }}
                  className={cn(
                    "bg-zinc-800 border-zinc-700",
                    validationErrors.slippageBps && "border-red-500 focus:border-red-500 focus:ring-red-500"
                  )}
                />
                <p className={cn(
                  "text-xs",
                  validationErrors.slippageBps ? "text-red-400" : "text-zinc-500"
                )}>
                  {validationErrors.slippageBps
                    ? "Minimum 10% slippage required for reliable execution"
                    : "Maximum price slippage allowed (minimum 10%)"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="priorityFee">
                  Priority Fee (SOL) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="priorityFee"
                  type="text"
                  inputMode="decimal"
                  value={config.priorityFeeSol}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || val === '.' || val === '0.' || val === '0.0' || val === '0.00') {
                      updateConfig({ priorityFeeSol: parseFloat(val) || 0 });
                      return;
                    }
                    const parsed = parseFloat(val);
                    if (!isNaN(parsed)) {
                      updateConfig({ priorityFeeSol: parsed });
                      // Clear error when user starts typing
                      if (validationErrors.priorityFeeSol) {
                        setValidationErrors(prev => ({ ...prev, priorityFeeSol: false }));
                      }
                    }
                  }}
                  placeholder="0.003"
                  className={cn(
                    "bg-zinc-800 border-zinc-700",
                    validationErrors.priorityFeeSol && "border-red-500 focus:border-red-500 focus:ring-red-500"
                  )}
                />
                <p className={cn(
                  "text-xs",
                  validationErrors.priorityFeeSol ? "text-red-400" : "text-zinc-500"
                )}>
                  {validationErrors.priorityFeeSol
                    ? "Minimum 0.003 SOL required for reliable execution"
                    : "Jito tip for faster execution (minimum 0.003 SOL)"}
                </p>
              </div>
            </div>
          )}

          {/* Step 4: Filters - Compact 2-column layout */}
          {step === 'filters' && (
            <div className="space-y-4">
              {/* Token Type Badge */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-900/30 border border-green-700/50 rounded-full w-fit">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs font-medium text-green-400">Newly Migrated Tokens</span>
              </div>

              {/* 2-Column Grid for Filters */}
              <div className="grid grid-cols-2 gap-4">
                {/* Left Column */}
                <div className="space-y-4">
                  {/* Migration Speed Filter */}
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/50">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium text-zinc-300">Migration Speed</Label>
                      {config.maxMigrationTimeMinutes && (
                        <button
                          type="button"
                          onClick={() => updateConfig({ maxMigrationTimeMinutes: undefined })}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 mb-2">Time from bonding curve to migration</p>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { value: 5, label: '5m' },
                        { value: 15, label: '15m' },
                        { value: 60, label: '1h' },
                        { value: 360, label: '6h' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateConfig({ maxMigrationTimeMinutes: opt.value })}
                          className={cn(
                            'py-1.5 px-1 rounded-md text-xs font-medium transition-all',
                            config.maxMigrationTimeMinutes === opt.value
                              ? 'bg-green-600 text-white'
                              : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                          )}
                        >
                          {'<'}{opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Volume Filter */}
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/50">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium text-zinc-300">Min Volume</Label>
                      {config.minVolumeUsd && (
                        <button
                          type="button"
                          onClick={() => updateConfig({ minVolumeUsd: undefined })}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 mb-2">24h trading volume on Raydium</p>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { value: 10000, label: '$10k' },
                        { value: 25000, label: '$25k' },
                        { value: 50000, label: '$50k' },
                        { value: 100000, label: '$100k' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateConfig({ minVolumeUsd: opt.value })}
                          className={cn(
                            'py-1.5 px-1 rounded-md text-xs font-medium transition-all',
                            config.minVolumeUsd === opt.value
                              ? 'bg-green-600 text-white'
                              : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                          )}
                        >
                          {opt.label}+
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Holder Count Filter */}
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/50">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium text-zinc-300">Min Holders</Label>
                      {config.minHolderCount && (
                        <button
                          type="button"
                          onClick={() => updateConfig({ minHolderCount: undefined })}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 mb-2">Unique wallets holding the token</p>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { value: 25, label: '25' },
                        { value: 50, label: '50' },
                        { value: 100, label: '100' },
                        { value: 250, label: '250' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateConfig({ minHolderCount: opt.value })}
                          className={cn(
                            'py-1.5 px-1 rounded-md text-xs font-medium transition-all',
                            config.minHolderCount === opt.value
                              ? 'bg-green-600 text-white'
                              : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                          )}
                        >
                          {opt.label}+
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Column */}
                <div className="space-y-4">
                  {/* Dev Holdings Filter */}
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/50">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium text-zinc-300">Max Dev Holdings</Label>
                      {config.maxDevHoldingsPct && (
                        <button
                          type="button"
                          onClick={() => updateConfig({ maxDevHoldingsPct: undefined })}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 mb-2">Max % supply held by creator</p>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { value: 5, label: '5%' },
                        { value: 15, label: '15%' },
                        { value: 30, label: '30%' },
                        { value: 50, label: '50%' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateConfig({ maxDevHoldingsPct: opt.value })}
                          className={cn(
                            'py-1.5 px-1 rounded-md text-xs font-medium transition-all',
                            config.maxDevHoldingsPct === opt.value
                              ? 'bg-green-600 text-white'
                              : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                          )}
                        >
                          ≤{opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Top 10 Concentration Filter */}
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/50">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium text-zinc-300">Max Top 10</Label>
                      {config.maxTop10HoldingsPct && (
                        <button
                          type="button"
                          onClick={() => updateConfig({ maxTop10HoldingsPct: undefined })}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 mb-2">Max % held by top 10 wallets</p>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { value: 30, label: '30%' },
                        { value: 50, label: '50%' },
                        { value: 70, label: '70%' },
                        { value: 90, label: '90%' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateConfig({ maxTop10HoldingsPct: opt.value })}
                          className={cn(
                            'py-1.5 px-1 rounded-md text-xs font-medium transition-all',
                            config.maxTop10HoldingsPct === opt.value
                              ? 'bg-green-600 text-white'
                              : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                          )}
                        >
                          ≤{opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Social Presence Filter */}
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/50">
                    <Label className="text-xs font-medium text-zinc-300 block mb-1">Require Socials</Label>
                    <p className="text-[10px] text-zinc-500 mb-2">Token must have these linked</p>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        onClick={() => updateConfig({ requireTwitter: !config.requireTwitter })}
                        className={cn(
                          'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all',
                          config.requireTwitter
                            ? 'bg-green-600 text-white'
                            : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                        )}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                        X
                      </button>
                      <button
                        type="button"
                        onClick={() => updateConfig({ requireTelegram: !config.requireTelegram })}
                        className={cn(
                          'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all',
                          config.requireTelegram
                            ? 'bg-green-600 text-white'
                            : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                        )}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                        </svg>
                        TG
                      </button>
                      <button
                        type="button"
                        onClick={() => updateConfig({ requireWebsite: !config.requireWebsite })}
                        className={cn(
                          'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all',
                          config.requireWebsite
                            ? 'bg-green-600 text-white'
                            : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                        )}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                        Web
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Filters Summary */}
              {(config.maxMigrationTimeMinutes || config.minVolumeUsd || config.minHolderCount ||
                config.maxDevHoldingsPct || config.maxTop10HoldingsPct ||
                config.requireTwitter || config.requireTelegram || config.requireWebsite) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-zinc-700/50">
                  <span className="text-[10px] text-zinc-500 mr-1">Active:</span>
                  {config.maxMigrationTimeMinutes && (
                    <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-[10px]">
                      Speed {'<'}{config.maxMigrationTimeMinutes}m
                    </span>
                  )}
                  {config.minVolumeUsd && (
                    <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-[10px]">
                      Vol ${(config.minVolumeUsd / 1000)}k+
                    </span>
                  )}
                  {config.minHolderCount && (
                    <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-[10px]">
                      {config.minHolderCount}+ holders
                    </span>
                  )}
                  {config.maxDevHoldingsPct && (
                    <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-[10px]">
                      Dev ≤{config.maxDevHoldingsPct}%
                    </span>
                  )}
                  {config.maxTop10HoldingsPct && (
                    <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-[10px]">
                      Top10 ≤{config.maxTop10HoldingsPct}%
                    </span>
                  )}
                  {config.requireTwitter && (
                    <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-[10px]">X</span>
                  )}
                  {config.requireTelegram && (
                    <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-[10px]">TG</span>
                  )}
                  {config.requireWebsite && (
                    <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-[10px]">Web</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 5: Review */}
          {step === 'review' && (
            <div className="space-y-2">
              {/* Sniper Name + Token Type combined */}
              <div className="bg-zinc-800/50 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 text-xs">Sniper</span>
                  <div className="flex items-center gap-2">
                    <Crosshair className="w-4 h-4 text-green-400" />
                    <span className="font-medium text-white text-sm">{name || 'My First Sniper'}</span>
                    <div className="flex items-center gap-1 px-2 py-0.5 bg-green-900/30 rounded text-xs text-green-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      New Migrations
                    </div>
                  </div>
                </div>
              </div>

              {/* Buy Settings + Exit Strategy side by side */}
              <div className="grid grid-cols-2 gap-2">
                {/* Buy Settings */}
                <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Buy</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Amount</span>
                    <span className="font-medium text-white">{config.snipeAmountSol} SOL</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Slippage</span>
                    <span className="font-medium text-white">{config.slippageBps / 100}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Priority</span>
                    <span className="font-medium text-white">{config.priorityFeeSol} SOL</span>
                  </div>
                </div>

                {/* Exit Strategy */}
                <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Exit</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">TP</span>
                    <span className="font-medium text-green-400">
                      +{config.takeProfitPct}%
                    </span>
                  </div>
                  {config.coverInitials && (
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Cover</span>
                      <span className="font-medium text-blue-400">50% @ 2x</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">SL</span>
                    <span className="font-medium text-red-400">
                      -{config.stopLossPct}%
                    </span>
                  </div>
                  {config.trailingStopPct && (
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Trail</span>
                      <span className="font-medium text-yellow-400">
                        {config.trailingStopPct}%
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400 flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      MEV
                    </span>
                    <span className={cn(
                      'font-medium',
                      config.mevProtection ?? true ? 'text-green-400' : 'text-zinc-500'
                    )}>
                      {config.mevProtection ?? true ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="bg-zinc-800/50 rounded-lg p-3">
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Filters</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Speed</span>
                    <span className="font-medium text-white">
                      {config.maxMigrationTimeMinutes
                        ? config.maxMigrationTimeMinutes < 60
                          ? `< ${config.maxMigrationTimeMinutes}m`
                          : `< ${config.maxMigrationTimeMinutes / 60}h`
                        : 'Any'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Dev %</span>
                    <span className="font-medium text-white">
                      {config.maxDevHoldingsPct ? `≤${config.maxDevHoldingsPct}%` : 'Any'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Volume</span>
                    <span className="font-medium text-white">
                      {config.minVolumeUsd ? `$${(config.minVolumeUsd / 1000).toFixed(0)}k+` : 'Any'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Top 10 %</span>
                    <span className="font-medium text-white">
                      {config.maxTop10HoldingsPct ? `≤${config.maxTop10HoldingsPct}%` : 'Any'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Holders</span>
                    <span className="font-medium text-white">
                      {config.minHolderCount ? `${config.minHolderCount}+` : 'Any'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Socials</span>
                    <span className="font-medium text-white">
                      {config.requireTwitter || config.requireTelegram || config.requireWebsite
                        ? [
                            config.requireTwitter && 'X',
                            config.requireTelegram && 'TG',
                            config.requireWebsite && 'Web'
                          ].filter(Boolean).join(', ')
                        : 'Any'}
                    </span>
                  </div>
                </div>
              </div>

              {hasExistingWallet && existingGeneratedWallet ? (
                // Show existing wallet info for authenticated users with generated wallet
                <div className="bg-green-900/20 border-2 border-green-700/60 rounded-xl p-4 mt-2">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Check className="w-5 h-5 text-green-400" />
                    <p className="text-green-400 font-medium text-sm">Ready to Create</p>
                  </div>
                  <p className="text-green-400/70 text-xs text-center">
                    Using trading wallet: {existingGeneratedWallet.publicKey?.slice(0, 4)}...{existingGeneratedWallet.publicKey?.slice(-4)}
                  </p>
                </div>
              ) : (
                // Show wallet generation prompt - all snipers need a server-generated wallet
                <div className="bg-green-900/20 border-2 border-green-700/60 rounded-xl p-4 mt-2">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Wallet className="w-5 h-5 text-green-400" />
                    <p className="text-green-400 font-medium text-sm">Next: Generate Trading Wallet</p>
                  </div>
                  <p className="text-green-400/70 text-xs text-center">
                    We'll generate a secure trading wallet for your sniper
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 6: Wallet Generation */}
          {step === 'wallet' && generatedWallet && (
            <div className="space-y-3">
              {/* Critical Security Warning - Compact */}
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <p className="text-red-400 text-xs font-medium">
                    ONE-TIME DISPLAY — Copy your private key now, it won't be shown again!
                  </p>
                </div>
              </div>

              {/* Success Header - Compact */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-900/30 rounded-full flex items-center justify-center shrink-0">
                  <Wallet className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Wallet Generated</h3>
                  <p className="text-xs text-zinc-400">Deposit SOL to fund your sniper</p>
                </div>
              </div>

              {/* Public Key */}
              <div className="space-y-1">
                <Label className="text-xs text-zinc-500">Wallet Address</Label>
                <div className="flex items-center gap-2 bg-zinc-800 rounded-lg p-2 border border-zinc-700">
                  <code className="flex-1 text-xs text-zinc-200 font-mono break-all">
                    {generatedWallet.publicKey}
                  </code>
                  <button
                    onClick={() => copyToClipboard(generatedWallet.publicKey, 'public')}
                    className="p-1.5 hover:bg-zinc-700 rounded transition-colors shrink-0"
                    title="Copy address"
                  >
                    {copiedPublic ? (
                      <Check className="w-3.5 h-3.5 text-green-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* Private Key */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-red-400 font-medium">Private Key (Secret)</Label>
                  <span className="text-xs text-red-400/70">Never share!</span>
                </div>
                <div className="bg-zinc-800 rounded-lg border border-red-800/50 overflow-hidden">
                  <div className="flex items-center gap-2 p-2">
                    <code className="flex-1 text-xs font-mono break-all select-all">
                      {showPrivateKey ? (
                        <span className="text-zinc-200">{generatedWallet.privateKey}</span>
                      ) : (
                        <span className="text-zinc-500">Click eye to reveal ➜</span>
                      )}
                    </code>
                    <button
                      onClick={() => setShowPrivateKey(!showPrivateKey)}
                      className="p-1.5 hover:bg-zinc-700 rounded transition-colors shrink-0"
                      title={showPrivateKey ? 'Hide key' : 'Show key'}
                    >
                      {showPrivateKey ? (
                        <EyeOff className="w-3.5 h-3.5 text-zinc-400" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 text-zinc-400" />
                      )}
                    </button>
                    <button
                      onClick={() => copyToClipboard(generatedWallet.privateKey, 'private')}
                      className="p-1.5 hover:bg-zinc-700 rounded transition-colors shrink-0"
                      title="Copy private key"
                    >
                      {copiedPrivate ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-zinc-400" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Security Tips - Compact */}
              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-2">
                <div className="flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
                  <p className="text-yellow-400/80 text-xs">
                    Store your key securely (password manager). We don't have access to it.
                  </p>
                </div>
              </div>

              {/* Deposit Info - Compact */}
              <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-white">Minimum Deposit</p>
                    <p className="text-xs text-zinc-400 mt-0.5">Covers snipe amount + fees</p>
                  </div>
                  <span className="text-sm font-semibold text-green-400">{(config.snipeAmountSol + 0.01).toFixed(2)} SOL</span>
                </div>
              </div>

              {/* Backup Confirmation */}
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={hasBackedUp}
                    onChange={(e) => setHasBackedUp(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-4 h-4 rounded border-2 transition-colors flex items-center justify-center',
                    hasBackedUp
                      ? 'bg-green-600 border-green-600'
                      : 'border-zinc-600 group-hover:border-zinc-500'
                  )}>
                    {hasBackedUp && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                </div>
                <span className="text-xs text-zinc-300">
                  I have securely backed up my private key
                </span>
              </label>
            </div>
          )}

        </CardContent>

        {/* Navigation - Fixed at bottom */}
        <div className="flex gap-3 p-4 border-t border-zinc-800 shrink-0">
          {step === 'wallet' ? (
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={handleContinueToSignup}
              disabled={!hasBackedUp}
            >
              <Wallet className="w-4 h-4 mr-2" />
              Continue to Setup
            </Button>
          ) : step === 'review' ? (
            <>
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isCreatingSniper}
              >
                Back
              </Button>
              {hasExistingWallet ? (
                // User has a generated wallet - show single Create button
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={handleCreateSniperDirect}
                  disabled={!name || isCreatingSniper}
                >
                  <Crosshair className="w-4 h-4 mr-2" />
                  {isCreatingSniper ? 'Creating...' : 'Create Sniper'}
                </Button>
              ) : (
                // User needs to generate a wallet first
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={handleGenerateWallet}
                  disabled={!name}
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Generate Wallet
                </Button>
              )}
            </>
          ) : (
            <>
              {step !== 'basics' && (
                <Button
                  variant="outline"
                  onClick={handleBack}
                >
                  Back
                </Button>
              )}
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleNext}
                disabled={step === 'basics' && !name}
              >
                Continue
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
