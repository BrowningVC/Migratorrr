'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

import { useAuthStore } from '@/lib/stores/auth';
import { useWalletsStore, Wallet as WalletType } from '@/lib/stores/wallets';
import { useSnipersStore, Sniper, SniperConfig } from '@/lib/stores/snipers';
import { sniperApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Shield, Check, Crosshair, CheckCircle, Rocket } from 'lucide-react';

interface CreateSniperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (sniper: Sniper) => void;
}

type Step = 'basics' | 'buying' | 'selling' | 'filters' | 'review' | 'success';

const DEFAULT_CONFIG: SniperConfig = {
  snipeAmountSol: 0.1,
  slippageBps: 1000, // 10%
  priorityFeeSol: 0.003, // Minimum for reliable execution
  takeProfitPct: 100, // 2x
  stopLossPct: 50,
  trailingStopPct: undefined,
  mevProtection: true, // Enabled by default
};

export function CreateSniperModal({
  isOpen,
  onClose,
  onCreated,
}: CreateSniperModalProps) {
  const { token } = useAuthStore();
  const { wallets, _hasHydrated: walletsHydrated } = useWalletsStore();
  const { addSniper } = useSnipersStore();

  const [step, setStep] = useState<Step>('basics');
  const [isLoading, setIsLoading] = useState(false);
  const [createdSniper, setCreatedSniper] = useState<Sniper | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [config, setConfig] = useState<SniperConfig>(DEFAULT_CONFIG);

  // Update selectedWalletId when wallets load/hydrate
  useEffect(() => {
    if (walletsHydrated && wallets.length > 0 && !selectedWalletId) {
      const defaultWallet = wallets.find((w) => w.walletType === 'generated') || wallets[0];
      if (defaultWallet) {
        setSelectedWalletId(defaultWallet.id);
      }
    }
  }, [walletsHydrated, wallets, selectedWalletId]);

  // Validation errors for buy settings and exit strategy
  const [validationErrors, setValidationErrors] = useState<{
    snipeAmountSol?: boolean;
    slippageBps?: boolean;
    priorityFeeSol?: boolean;
    takeProfitPct?: boolean;
    stopLossPct?: boolean;
  }>({});

  // String input states for better UX (allows typing any value)
  const [snipeAmountInput, setSnipeAmountInput] = useState(String(DEFAULT_CONFIG.snipeAmountSol));
  const [slippageInput, setSlippageInput] = useState(String(DEFAULT_CONFIG.slippageBps / 100));
  const [priorityFeeInput, setPriorityFeeInput] = useState(String(DEFAULT_CONFIG.priorityFeeSol));
  const [takeProfitInput, setTakeProfitInput] = useState(String(DEFAULT_CONFIG.takeProfitPct));
  const [stopLossInput, setStopLossInput] = useState(String(DEFAULT_CONFIG.stopLossPct));
  const [trailingStopInput, setTrailingStopInput] = useState('');

  const steps: Step[] = ['basics', 'buying', 'selling', 'filters', 'review'];
  const stepIndex = steps.indexOf(step);

  const stepLabels = {
    basics: 'Basics',
    buying: 'Buy Settings',
    selling: 'Exit Strategy',
    filters: 'Filters',
    review: 'Review',
    success: 'Success',
  };

  const updateConfig = (updates: Partial<SniperConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    // Validate buy settings before proceeding
    if (step === 'buying') {
      // Parse the string inputs to get final values
      const snipeAmount = parseFloat(snipeAmountInput) || 0;
      const slippagePct = parseFloat(slippageInput) || 0;
      const priorityFee = parseFloat(priorityFeeInput) || 0;

      // Update config with parsed values
      updateConfig({
        snipeAmountSol: snipeAmount,
        slippageBps: Math.round(slippagePct * 100),
        priorityFeeSol: priorityFee,
      });

      const errors: typeof validationErrors = {};

      if (snipeAmount < 0.1) {
        errors.snipeAmountSol = true;
      }
      if (slippagePct < 10) { // 10% minimum
        errors.slippageBps = true;
      }
      if (priorityFee < 0.003) {
        errors.priorityFeeSol = true;
      }

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        toast.error('Please fix the highlighted fields');
        return;
      }

      setValidationErrors({});
    }

    // Validate exit strategy settings before proceeding
    if (step === 'selling') {
      // Parse the string inputs to get final values
      const takeProfit = parseFloat(takeProfitInput) || 0;
      const stopLoss = parseFloat(stopLossInput) || 0;
      const trailingStop = trailingStopInput ? parseFloat(trailingStopInput) : undefined;

      // Update config with parsed values
      updateConfig({
        takeProfitPct: takeProfit,
        stopLossPct: stopLoss,
        trailingStopPct: trailingStop,
      });

      const errors: typeof validationErrors = {};

      if (takeProfit < 10 || takeProfit > 10000) {
        errors.takeProfitPct = true;
      }
      if (stopLoss < 5 || stopLoss > 95) {
        errors.stopLossPct = true;
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

  const handleCreate = async () => {
    if (!token || !selectedWalletId || !name) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsLoading(true);
    const toastId = toast.loading('Creating sniper...');

    try {
      const finalConfig: SniperConfig = {
        ...config,
      };

      const res = await sniperApi.create(token, {
        walletId: selectedWalletId,
        name,
        config: finalConfig as unknown as Record<string, unknown>,
        isActive: false,
      });

      if (!res.success || !res.data) {
        throw new Error(res.error || 'Failed to create sniper');
      }

      // Server returns sniper object directly as data
      const sniperData = res.data;
      const newSniper: Sniper = {
        id: sniperData.id,
        name: sniperData.name,
        isActive: sniperData.isActive || false,
        walletId: selectedWalletId,
        config: finalConfig,
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
      toast.success(`Sniper "${name}" created!`, { id: toastId });

      onCreated?.(newSniper);
      setCreatedSniper(newSniper);
      setStep('success');
    } catch (error) {
      console.error('Create sniper error:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to create sniper',
        { id: toastId }
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setStep('basics');
    setName('');
    setConfig(DEFAULT_CONFIG);
    setCreatedSniper(null);
    setValidationErrors({});
    // Reset string inputs
    setSnipeAmountInput(String(DEFAULT_CONFIG.snipeAmountSol));
    setSlippageInput(String(DEFAULT_CONFIG.slippageBps / 100));
    setPriorityFeeInput(String(DEFAULT_CONFIG.priorityFeeSol));
    setTakeProfitInput(String(DEFAULT_CONFIG.takeProfitPct));
    setStopLossInput(String(DEFAULT_CONFIG.stopLossPct));
    setTrailingStopInput('');
    onClose();
  };

  if (!isOpen) return null;

  // Only access wallets after store has hydrated
  const generatedWallets = walletsHydrated
    ? wallets.filter((w) => w.walletType === 'generated')
    : [];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="bg-zinc-900 border-zinc-800 w-full max-w-lg max-h-[85vh] flex flex-col">
        <CardHeader className="border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">
              {step === 'success' ? 'Success!' : 'Configure Your Sniper'}
            </CardTitle>
            <button
              onClick={handleClose}
              className="text-zinc-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step indicators - hide on success */}
          {step !== 'success' && (
            <>
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
            </>
          )}
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

              <div className="space-y-2">
                <Label>Trading Wallet</Label>
                {!walletsHydrated ? (
                  <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 animate-pulse">
                    <div className="h-4 bg-zinc-700 rounded w-24 mb-2"></div>
                    <div className="h-3 bg-zinc-700/50 rounded w-32"></div>
                  </div>
                ) : generatedWallets.length === 0 ? (
                  <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-3">
                    <p className="text-yellow-400 text-sm">
                      You need to generate a trading wallet first. Go to Settings to create one.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {generatedWallets.map((wallet) => (
                      <button
                        key={wallet.id}
                        onClick={() => setSelectedWalletId(wallet.id)}
                        className={cn(
                          'w-full p-3 rounded-lg border text-left transition-colors',
                          selectedWalletId === wallet.id
                            ? 'bg-green-900/20 border-green-700'
                            : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
                        )}
                      >
                        <p className="font-medium text-sm">
                          {wallet.label || 'Trading Wallet'}
                        </p>
                        <p className="text-zinc-400 text-xs font-mono truncate">
                          {wallet.publicKey}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
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

          {/* Step 2: Selling/Exit Strategy */}
          {step === 'selling' && (
            <div className="space-y-4">
              {/* Take Profit - Required */}
              <div className="space-y-2">
                <Label htmlFor="takeProfit">
                  Take Profit (%) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="takeProfit"
                  type="text"
                  inputMode="decimal"
                  value={takeProfitInput}
                  onChange={(e) => {
                    // Allow free typing - validation happens on Next
                    setTakeProfitInput(e.target.value);
                    // Clear error when user starts typing
                    if (validationErrors.takeProfitPct) {
                      setValidationErrors(prev => ({ ...prev, takeProfitPct: false }));
                    }
                  }}
                  className={cn(
                    "bg-zinc-800 border-zinc-700",
                    validationErrors.takeProfitPct && "border-red-500 focus:border-red-500 focus:ring-red-500"
                  )}
                />
                <p className={cn(
                  "text-xs",
                  validationErrors.takeProfitPct ? "text-red-400" : "text-zinc-500"
                )}>
                  {validationErrors.takeProfitPct
                    ? "Take profit must be between 10% and 10000%"
                    : "Automatically sell when profit reaches this % (100% = 2x, 200% = 3x)"}
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
                  type="text"
                  inputMode="decimal"
                  value={stopLossInput}
                  onChange={(e) => {
                    // Allow free typing - validation happens on Next
                    setStopLossInput(e.target.value);
                    // Clear error when user starts typing
                    if (validationErrors.stopLossPct) {
                      setValidationErrors(prev => ({ ...prev, stopLossPct: false }));
                    }
                  }}
                  className={cn(
                    "bg-zinc-800 border-zinc-700",
                    validationErrors.stopLossPct && "border-red-500 focus:border-red-500 focus:ring-red-500"
                  )}
                />
                <p className={cn(
                  "text-xs",
                  validationErrors.stopLossPct ? "text-red-400" : "text-zinc-500"
                )}>
                  {validationErrors.stopLossPct
                    ? "Stop loss must be between 5% and 95%"
                    : "Sell when market cap drops this % from your entry (e.g., 50% = sell at half the MCAP you bought at)"}
                </p>
              </div>

              {/* Trailing Stop - Optional */}
              <div className="space-y-2">
                <Label htmlFor="trailingStop" className="text-zinc-400">
                  Trailing Stop (%) <span className="text-zinc-500 text-xs font-normal">— optional</span>
                </Label>
                <Input
                  id="trailingStop"
                  type="text"
                  inputMode="decimal"
                  value={trailingStopInput}
                  onChange={(e) => {
                    // Allow free typing - validation happens on Next
                    setTrailingStopInput(e.target.value);
                  }}
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

          {/* Step 2: Buying/Entry Settings */}
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
                  value={snipeAmountInput}
                  onChange={(e) => {
                    // Allow free typing - validation happens on Next
                    setSnipeAmountInput(e.target.value);
                    // Clear error when user starts typing
                    if (validationErrors.snipeAmountSol) {
                      setValidationErrors(prev => ({ ...prev, snipeAmountSol: false }));
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
                  value={slippageInput}
                  onChange={(e) => {
                    // Allow free typing - validation happens on Next
                    setSlippageInput(e.target.value);
                    // Clear error when user starts typing
                    if (validationErrors.slippageBps) {
                      setValidationErrors(prev => ({ ...prev, slippageBps: false }));
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
                  value={priorityFeeInput}
                  onChange={(e) => {
                    // Allow free typing - validation happens on Next
                    setPriorityFeeInput(e.target.value);
                    // Clear error when user starts typing
                    if (validationErrors.priorityFeeSol) {
                      setValidationErrors(prev => ({ ...prev, priorityFeeSol: false }));
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

          {/* Step 4: Filters */}
          {step === 'filters' && (
            <div className="space-y-6">
              {/* Token Type Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-green-900/30 border border-green-700/50 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm font-medium text-green-400">Newly Migrated Tokens ONLY</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/30 border border-yellow-700/50 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  <span className="text-sm font-medium text-yellow-400">More Options Soon</span>
                </div>
              </div>

              {/* Migration Speed Filter */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Migration Speed</Label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    How fast did the token migrate after creation?
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 5, label: '< 5 min', description: 'Ultra fast' },
                    { value: 15, label: '< 15 min', description: 'Fast' },
                    { value: 60, label: '< 1 hour', description: 'Normal' },
                    { value: 360, label: '< 6 hours', description: 'Slow' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateConfig({ maxMigrationTimeMinutes: option.value })}
                      className={cn(
                        'flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all',
                        config.maxMigrationTimeMinutes === option.value
                          ? 'bg-green-900/30 border-green-600 shadow-lg shadow-green-900/20'
                          : 'bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800'
                      )}
                    >
                      <span className={cn(
                        'text-lg font-bold',
                        config.maxMigrationTimeMinutes === option.value ? 'text-green-400' : 'text-white'
                      )}>
                        {option.label}
                      </span>
                      <span className="text-xs text-zinc-500">{option.description}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateConfig({ maxMigrationTimeMinutes: undefined })}
                  className={cn(
                    'w-full py-2 px-3 rounded-lg text-sm transition-all',
                    !config.maxMigrationTimeMinutes
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  Any migration speed
                </button>
              </div>

              {/* Volume Filter */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Minimum Volume</Label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Total trading volume since token deployment
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 10000, label: '$10k+' },
                    { value: 25000, label: '$25k+' },
                    { value: 50000, label: '$50k+' },
                    { value: 100000, label: '$100k+' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateConfig({ minVolumeUsd: option.value })}
                      className={cn(
                        'py-2.5 px-2 rounded-xl border-2 text-sm font-semibold transition-all',
                        config.minVolumeUsd === option.value
                          ? 'bg-green-900/30 border-green-600 text-green-400 shadow-lg shadow-green-900/20'
                          : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateConfig({ minVolumeUsd: undefined })}
                  className={cn(
                    'w-full py-2 px-3 rounded-lg text-sm transition-all',
                    !config.minVolumeUsd
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  Any volume
                </button>
              </div>

              {/* Holder Count Filter */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Minimum Holders</Label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Minimum unique wallet holders
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 25, label: '25+' },
                    { value: 50, label: '50+' },
                    { value: 100, label: '100+' },
                    { value: 250, label: '250+' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateConfig({ minHolderCount: option.value })}
                      className={cn(
                        'py-2.5 px-2 rounded-xl border-2 text-sm font-semibold transition-all',
                        config.minHolderCount === option.value
                          ? 'bg-green-900/30 border-green-600 text-green-400 shadow-lg shadow-green-900/20'
                          : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateConfig({ minHolderCount: undefined })}
                  className={cn(
                    'w-full py-2 px-3 rounded-lg text-sm transition-all',
                    !config.minHolderCount
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  Any holder count
                </button>
              </div>

              {/* Dev Wallet Holdings Filter */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Max Dev Holdings</Label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Maximum % of supply the dev/creator can hold
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 5, label: '≤5%' },
                    { value: 15, label: '≤15%' },
                    { value: 30, label: '≤30%' },
                    { value: 50, label: '≤50%' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateConfig({ maxDevHoldingsPct: option.value })}
                      className={cn(
                        'py-2.5 px-2 rounded-xl border-2 text-sm font-semibold transition-all',
                        config.maxDevHoldingsPct === option.value
                          ? 'bg-green-900/30 border-green-600 text-green-400 shadow-lg shadow-green-900/20'
                          : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateConfig({ maxDevHoldingsPct: undefined })}
                  className={cn(
                    'w-full py-2 px-3 rounded-lg text-sm transition-all',
                    !config.maxDevHoldingsPct
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  Any dev holdings
                </button>
              </div>

              {/* Top 10 Wallet Concentration Filter */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Max Top 10 Concentration</Label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Maximum % of supply held by top 10 wallets
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 30, label: '≤30%' },
                    { value: 50, label: '≤50%' },
                    { value: 70, label: '≤70%' },
                    { value: 90, label: '≤90%' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateConfig({ maxTop10HoldingsPct: option.value })}
                      className={cn(
                        'py-2.5 px-2 rounded-xl border-2 text-sm font-semibold transition-all',
                        config.maxTop10HoldingsPct === option.value
                          ? 'bg-green-900/30 border-green-600 text-green-400 shadow-lg shadow-green-900/20'
                          : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateConfig({ maxTop10HoldingsPct: undefined })}
                  className={cn(
                    'w-full py-2 px-3 rounded-lg text-sm transition-all',
                    !config.maxTop10HoldingsPct
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  Any concentration
                </button>
              </div>

              {/* Social Presence Filters */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Social Presence</Label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Require tokens to have social links
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border-2 cursor-pointer transition-all',
                      config.requireTwitter
                        ? 'bg-green-900/30 border-green-600 shadow-lg shadow-green-900/20'
                        : 'bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={config.requireTwitter ?? false}
                      onChange={(e) => updateConfig({ requireTwitter: e.target.checked })}
                      className="sr-only"
                    />
                    <svg className={cn('w-4 h-4', config.requireTwitter ? 'text-green-400' : 'text-zinc-400')} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    <span className={cn('text-sm font-medium', config.requireTwitter ? 'text-green-400' : 'text-zinc-300')}>
                      Twitter
                    </span>
                  </label>

                  <label
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border-2 cursor-pointer transition-all',
                      config.requireTelegram
                        ? 'bg-green-900/30 border-green-600 shadow-lg shadow-green-900/20'
                        : 'bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={config.requireTelegram ?? false}
                      onChange={(e) => updateConfig({ requireTelegram: e.target.checked })}
                      className="sr-only"
                    />
                    <svg className={cn('w-4 h-4', config.requireTelegram ? 'text-green-400' : 'text-zinc-400')} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                    </svg>
                    <span className={cn('text-sm font-medium', config.requireTelegram ? 'text-green-400' : 'text-zinc-300')}>
                      Telegram
                    </span>
                  </label>

                  <label
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border-2 cursor-pointer transition-all',
                      config.requireWebsite
                        ? 'bg-green-900/30 border-green-600 shadow-lg shadow-green-900/20'
                        : 'bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={config.requireWebsite ?? false}
                      onChange={(e) => updateConfig({ requireWebsite: e.target.checked })}
                      className="sr-only"
                    />
                    <svg className={cn('w-4 h-4', config.requireWebsite ? 'text-green-400' : 'text-zinc-400')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <span className={cn('text-sm font-medium', config.requireWebsite ? 'text-green-400' : 'text-zinc-300')}>
                      Website
                    </span>
                  </label>
                </div>
              </div>

              {/* Min Twitter Followers Filter */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Min Twitter Followers</Label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Minimum followers on token's Twitter account
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 100, label: '100+' },
                    { value: 500, label: '500+' },
                    { value: 1000, label: '1K+' },
                    { value: 5000, label: '5K+' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateConfig({ minTwitterFollowers: option.value })}
                      className={cn(
                        'py-2.5 px-2 rounded-xl border-2 text-sm font-semibold transition-all',
                        config.minTwitterFollowers === option.value
                          ? 'bg-green-900/30 border-green-600 text-green-400 shadow-lg shadow-green-900/20'
                          : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateConfig({ minTwitterFollowers: undefined })}
                  className={cn(
                    'w-full py-2 px-3 rounded-lg text-sm transition-all',
                    !config.minTwitterFollowers
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  Any follower count
                </button>
              </div>

              {/* Creator Score Filter */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Min Creator Score</Label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Trust score based on creator's past token history (0-100)
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 25, label: '25+' },
                    { value: 50, label: '50+' },
                    { value: 75, label: '75+' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateConfig({ minCreatorScore: option.value })}
                      className={cn(
                        'py-2.5 px-2 rounded-xl border-2 text-sm font-semibold transition-all',
                        config.minCreatorScore === option.value
                          ? 'bg-green-900/30 border-green-600 text-green-400 shadow-lg shadow-green-900/20'
                          : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateConfig({ minCreatorScore: undefined })}
                  className={cn(
                    'w-full py-2 px-3 rounded-lg text-sm transition-all',
                    !config.minCreatorScore
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  Any creator score
                </button>
              </div>

              {/* Token Security Filters */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Token Security</Label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Additional security and legitimacy checks
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border-2 cursor-pointer transition-all',
                      config.requireLiquidityLock
                        ? 'bg-green-900/30 border-green-600 shadow-lg shadow-green-900/20'
                        : 'bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={config.requireLiquidityLock ?? false}
                      onChange={(e) => updateConfig({ requireLiquidityLock: e.target.checked })}
                      className="sr-only"
                    />
                    <svg className={cn('w-4 h-4', config.requireLiquidityLock ? 'text-green-400' : 'text-zinc-400')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <span className={cn('text-sm font-medium', config.requireLiquidityLock ? 'text-green-400' : 'text-zinc-300')}>
                      LP Locked
                    </span>
                  </label>

                  <label
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border-2 cursor-pointer transition-all',
                      config.requireDexScreenerPaid
                        ? 'bg-green-900/30 border-green-600 shadow-lg shadow-green-900/20'
                        : 'bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={config.requireDexScreenerPaid ?? false}
                      onChange={(e) => updateConfig({ requireDexScreenerPaid: e.target.checked })}
                      className="sr-only"
                    />
                    <svg className={cn('w-4 h-4', config.requireDexScreenerPaid ? 'text-green-400' : 'text-zinc-400')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    <span className={cn('text-sm font-medium', config.requireDexScreenerPaid ? 'text-green-400' : 'text-zinc-300')}>
                      DexScreener Paid
                    </span>
                  </label>
                </div>
              </div>
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
                    <span className="font-medium text-white text-sm">{name || 'My Sniper'}</span>
                    <div className="flex items-center gap-1 px-2 py-0.5 bg-green-900/30 rounded text-xs text-green-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      New Migrations
                    </div>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-zinc-400 text-xs">Wallet</span>
                  <span className="font-medium text-white text-xs font-mono">
                    {wallets.find(w => w.id === selectedWalletId)?.publicKey?.slice(0, 8)}...
                  </span>
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
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Migration Speed</span>
                  <span className="font-medium text-white">
                    {config.maxMigrationTimeMinutes
                      ? config.maxMigrationTimeMinutes < 60
                        ? `< ${config.maxMigrationTimeMinutes} min`
                        : `< ${config.maxMigrationTimeMinutes / 60}h`
                      : 'Any'}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Min Volume</span>
                  <span className="font-medium text-white">
                    {config.minVolumeUsd ? `$${(config.minVolumeUsd / 1000).toFixed(0)}k+` : 'Any'}
                  </span>
                </div>
                {config.minHolderCount && (
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Min Holders</span>
                    <span className="font-medium text-white">{config.minHolderCount}+</span>
                  </div>
                )}
                {config.maxDevHoldingsPct && (
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Max Dev</span>
                    <span className="font-medium text-white">≤{config.maxDevHoldingsPct}%</span>
                  </div>
                )}
                {config.maxTop10HoldingsPct && (
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Max Top 10</span>
                    <span className="font-medium text-white">≤{config.maxTop10HoldingsPct}%</span>
                  </div>
                )}
                {(config.requireTwitter || config.requireTelegram || config.requireWebsite) && (
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Socials</span>
                    <span className="font-medium text-white">
                      {[
                        config.requireTwitter && 'X',
                        config.requireTelegram && 'TG',
                        config.requireWebsite && 'Web'
                      ].filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
                {config.minTwitterFollowers && (
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Min Followers</span>
                    <span className="font-medium text-white">
                      {config.minTwitterFollowers >= 1000
                        ? `${(config.minTwitterFollowers / 1000).toFixed(0)}K+`
                        : `${config.minTwitterFollowers}+`}
                    </span>
                  </div>
                )}
                {config.minCreatorScore && (
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Creator Score</span>
                    <span className="font-medium text-white">{config.minCreatorScore}+</span>
                  </div>
                )}
                {config.requireLiquidityLock && (
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">LP Lock</span>
                    <span className="font-medium text-green-400">Required</span>
                  </div>
                )}
                {config.requireDexScreenerPaid && (
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">DexScreener</span>
                    <span className="font-medium text-green-400">Paid</span>
                  </div>
                )}
              </div>

              <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-3 mt-2">
                <p className="text-yellow-400 text-xs">
                  <strong>Note:</strong> The sniper will be created in paused state.
                  Activate it from the dashboard when ready to start sniping.
                </p>
              </div>
            </div>
          )}

          {/* Step 6: Success */}
          {step === 'success' && createdSniper && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6">
              <div className="w-20 h-20 rounded-full bg-green-900/30 border-2 border-green-600 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-green-400" />
              </div>

              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold text-white">Sniper Created!</h3>
                <p className="text-zinc-400">
                  Your sniper <span className="text-green-400 font-medium">&quot;{createdSniper.name}&quot;</span> is ready to go.
                </p>
              </div>

              <div className="w-full bg-zinc-800/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-sm">Status</span>
                  <span className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
                    <div className="w-2 h-2 rounded-full bg-yellow-400" />
                    Paused
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-sm">Snipe Amount</span>
                  <span className="text-white text-sm font-medium">{config.snipeAmountSol} SOL</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-sm">Take Profit</span>
                  <span className="text-green-400 text-sm font-medium">+{config.takeProfitPct}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-sm">Stop Loss</span>
                  <span className="text-red-400 text-sm font-medium">-{config.stopLossPct}%</span>
                </div>
              </div>

              <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-4 w-full">
                <div className="flex items-start gap-3">
                  <Rocket className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-blue-400 text-sm font-medium">Next Steps</p>
                    <p className="text-zinc-400 text-xs mt-1">
                      Fund your trading wallet and activate your sniper from the dashboard to start sniping migrations.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </CardContent>

        {/* Navigation - Fixed at bottom */}
        <div className="flex gap-3 p-4 border-t border-zinc-800 shrink-0">
          {step === 'success' ? (
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={handleClose}
            >
              Go to Dashboard
            </Button>
          ) : (
            <>
              {step !== 'basics' && (
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={isLoading}
                >
                  Back
                </Button>
              )}
              {step !== 'review' ? (
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={handleNext}
                  disabled={step === 'basics' && (!name || !selectedWalletId)}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={handleCreate}
                  disabled={isLoading || !name || !selectedWalletId}
                >
                  {isLoading ? 'Creating...' : 'Create Sniper'}
                </Button>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
