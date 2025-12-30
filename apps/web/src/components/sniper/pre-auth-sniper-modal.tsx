'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import toast from 'react-hot-toast';
import { usePendingSniperStore } from '@/lib/stores/pending-sniper';
import { SniperConfig } from '@/lib/stores/snipers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Copy, Check, Eye, EyeOff, Wallet, ArrowRight, AlertTriangle, Shield } from 'lucide-react';

interface PreAuthSniperModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'basics' | 'selling' | 'buying' | 'filters' | 'review' | 'wallet';

interface GeneratedWallet {
  publicKey: string;
  privateKey: string;
}

const DEFAULT_CONFIG: SniperConfig = {
  snipeAmountSol: 0.1,
  slippageBps: 1000, // 10%
  priorityFeeSol: 0.001,
  takeProfitPct: 100, // 2x
  stopLossPct: 50,
  trailingStopPct: undefined,
  minLiquiditySol: 5,
  mevProtection: true, // Enabled by default
};

export function PreAuthSniperModal({ isOpen, onClose }: PreAuthSniperModalProps) {
  const router = useRouter();
  const { setPendingSniper } = usePendingSniperStore();

  const [step, setStep] = useState<Step>('basics');

  // Form state
  const [name, setName] = useState('My First Sniper');
  const [config, setConfig] = useState<SniperConfig>(DEFAULT_CONFIG);

  // Wallet generation state
  const [generatedWallet, setGeneratedWallet] = useState<GeneratedWallet | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copiedPublic, setCopiedPublic] = useState(false);
  const [copiedPrivate, setCopiedPrivate] = useState(false);
  const [hasBackedUp, setHasBackedUp] = useState(false);

  const steps: Step[] = ['basics', 'selling', 'buying', 'filters', 'review', 'wallet'];
  const stepIndex = steps.indexOf(step);

  const stepLabels: Record<Step, string> = {
    basics: 'Name Your Sniper',
    selling: 'Exit Strategy',
    buying: 'Buy Settings',
    filters: 'Token Filters',
    review: 'Review Config',
    wallet: 'Your Wallet',
  };

  const updateConfig = (updates: Partial<SniperConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
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
      <Card className="bg-zinc-900 border-zinc-800 w-full max-w-lg max-h-[85vh] flex flex-col">
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
                  You configure the parameters, and it executes trades faster than any human could.
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Exit Strategy (Selling Options) */}
          {step === 'selling' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="takeProfit">Take Profit (%)</Label>
                <Input
                  id="takeProfit"
                  type="number"
                  step="10"
                  min="10"
                  max="10000"
                  value={config.takeProfitPct || ''}
                  onChange={(e) =>
                    updateConfig({
                      takeProfitPct: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  placeholder="e.g., 100 for 2x"
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Automatically sell when profit reaches this % (100% = 2x)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="stopLoss">Stop Loss (%)</Label>
                <Input
                  id="stopLoss"
                  type="number"
                  step="5"
                  min="5"
                  max="100"
                  value={config.stopLossPct || ''}
                  onChange={(e) =>
                    updateConfig({
                      stopLossPct: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  placeholder="e.g., 50"
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Automatically sell when loss reaches this %
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="trailingStop">Trailing Stop (%)</Label>
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
                  placeholder="e.g., 20"
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Sell when price drops this % from highest point (optional)
                </p>
              </div>

              {/* MEV Protection */}
              <div className="mt-6 pt-4 border-t border-zinc-700/50">
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
                      Uses Jito bundles to protect your buy and sell transactions from sandwich attacks and front-running bots.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Step 3: Buy Settings */}
          {step === 'buying' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="snipeAmount">Snipe Amount (SOL)</Label>
                <Input
                  id="snipeAmount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="100"
                  value={config.snipeAmountSol}
                  onChange={(e) =>
                    updateConfig({ snipeAmountSol: parseFloat(e.target.value) || 0 })
                  }
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Amount of SOL to spend per snipe (excluding fees)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="slippage">Slippage Tolerance (%)</Label>
                <Input
                  id="slippage"
                  type="number"
                  step="0.5"
                  min="1"
                  max="50"
                  value={config.slippageBps / 100}
                  onChange={(e) =>
                    updateConfig({ slippageBps: Math.round(parseFloat(e.target.value) * 100) || 100 })
                  }
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Maximum price slippage allowed (recommended: 10-20%)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="priorityFee">Priority Fee (SOL)</Label>
                <Input
                  id="priorityFee"
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  max="0.1"
                  value={config.priorityFeeSol}
                  onChange={(e) =>
                    updateConfig({ priorityFeeSol: parseFloat(e.target.value) || 0.001 })
                  }
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Jito tip for faster execution (recommended: 0.001-0.005 SOL)
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
                    <span className="font-medium text-white text-sm">{name || 'My First Sniper'}</span>
                    <div className="flex items-center gap-1 px-2 py-0.5 bg-green-900/30 rounded text-xs text-green-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      Migrations
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
                      {config.takeProfitPct ? `+${config.takeProfitPct}%` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">SL</span>
                    <span className="font-medium text-red-400">
                      {config.stopLossPct ? `-${config.stopLossPct}%` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Trail</span>
                    <span className="font-medium text-yellow-400">
                      {config.trailingStopPct ? `${config.trailingStopPct}%` : '—'}
                    </span>
                  </div>
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
              </div>

              <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-2">
                <p className="text-green-400 text-xs text-center">
                  Generate a wallet to fund your sniper and start catching migrations.
                </p>
              </div>
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
                    <p className="text-xs font-medium text-white">Recommended deposit</p>
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
          {step !== 'basics' && step !== 'wallet' && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleBack}
            >
              Back
            </Button>
          )}
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
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={handleGenerateWallet}
              disabled={!name}
            >
              <Wallet className="w-4 h-4 mr-2" />
              Generate Wallet
            </Button>
          ) : (
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={handleNext}
              disabled={step === 'basics' && !name}
            >
              Continue
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
