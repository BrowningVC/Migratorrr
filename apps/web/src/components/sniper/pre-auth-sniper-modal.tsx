'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { usePendingSniperStore } from '@/lib/stores/pending-sniper';
import { useAuthStore } from '@/lib/stores/auth';
import { useWalletsStore } from '@/lib/stores/wallets';
import { useSnipersStore, SniperConfig, Sniper } from '@/lib/stores/snipers';
import { sniperApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Zap,
  Target,
  Shield,
  Check,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Filter,
  Rocket
} from 'lucide-react';

interface PreAuthSniperModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'basics' | 'buying' | 'selling' | 'filters' | 'review';

const DEFAULT_CONFIG: SniperConfig = {
  snipeAmountSol: 0.2,
  slippageBps: 1000,
  priorityFeeSol: 0.003,
  takeProfitPct: 100,
  stopLossPct: 50,
  trailingStopPct: undefined,
  mevProtection: true,
};

export function PreAuthSniperModal({ isOpen, onClose }: PreAuthSniperModalProps) {
  const router = useRouter();
  const { setPendingSniper } = usePendingSniperStore();
  const { token, isAuthenticated, _hasHydrated: authHydrated } = useAuthStore();
  const { wallets, _hasHydrated: walletsHydrated } = useWalletsStore();
  const { addSniper } = useSnipersStore();

  const [step, setStep] = useState<Step>('basics');
  const [isCreatingSniper, setIsCreatingSniper] = useState(false);

  const [name, setName] = useState('My BondShot Sniper');
  const [config, setConfig] = useState<SniperConfig>(DEFAULT_CONFIG);

  const [snipeAmountInput, setSnipeAmountInput] = useState(String(DEFAULT_CONFIG.snipeAmountSol));
  const [slippageInput, setSlippageInput] = useState(String(DEFAULT_CONFIG.slippageBps / 100));
  const [priorityFeeInput, setPriorityFeeInput] = useState(String(DEFAULT_CONFIG.priorityFeeSol));
  const [takeProfitInput, setTakeProfitInput] = useState(String(DEFAULT_CONFIG.takeProfitPct));
  const [stopLossInput, setStopLossInput] = useState(String(DEFAULT_CONFIG.stopLossPct));
  const [trailingStopInput, setTrailingStopInput] = useState('');

  const storesHydrated = authHydrated && walletsHydrated;
  const existingGeneratedWallet = storesHydrated ? wallets.find(w => w.walletType === 'generated') : undefined;
  const hasExistingWallet = storesHydrated && isAuthenticated && token && !!existingGeneratedWallet;

  const [validationErrors, setValidationErrors] = useState<{
    snipeAmountSol?: boolean;
    slippageBps?: boolean;
    priorityFeeSol?: boolean;
  }>({});

  const steps: Step[] = ['basics', 'buying', 'selling', 'filters', 'review'];
  const stepIndex = steps.indexOf(step);

  const stepConfig = {
    basics: { icon: Sparkles, label: 'Name', color: 'text-purple-400' },
    buying: { icon: Zap, label: 'Buy', color: 'text-blue-400' },
    selling: { icon: Target, label: 'Sell', color: 'text-green-400' },
    filters: { icon: Filter, label: 'Filter', color: 'text-yellow-400' },
    review: { icon: Rocket, label: 'Launch', color: 'text-orange-400' },
  };

  const updateConfig = (updates: Partial<SniperConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

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

        setStep('basics');
        setName('My BondShot Sniper');
        setConfig(DEFAULT_CONFIG);
        onClose();
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
    if (step === 'buying') {
      const snipeAmount = parseFloat(snipeAmountInput) || 0;
      const slippagePct = parseFloat(slippageInput) || 0;
      const priorityFee = parseFloat(priorityFeeInput) || 0;

      updateConfig({
        snipeAmountSol: snipeAmount,
        slippageBps: Math.round(slippagePct * 100),
        priorityFeeSol: priorityFee,
      });

      const errors: typeof validationErrors = {};

      if (snipeAmount < 0.1) errors.snipeAmountSol = true;
      if (slippagePct < 10) errors.slippageBps = true;
      if (priorityFee < 0.003) errors.priorityFeeSol = true;

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        toast.error('Please fix the highlighted fields');
        return;
      }

      setValidationErrors({});
    }

    if (step === 'selling') {
      const takeProfit = parseFloat(takeProfitInput) || 0;
      const stopLoss = parseFloat(stopLossInput) || 0;
      const trailingStop = trailingStopInput ? parseFloat(trailingStopInput) : undefined;

      updateConfig({
        takeProfitPct: takeProfit,
        stopLossPct: stopLoss,
        trailingStopPct: trailingStop,
      });
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

  const handleContinueToOnboarding = () => {
    setPendingSniper({
      name,
      config,
      createdAt: Date.now(),
    });
    router.push('/onboarding');
    onClose();
  };

  const handleClose = () => {
    setStep('basics');
    setName('My BondShot Sniper');
    setConfig(DEFAULT_CONFIG);
    setValidationErrors({});
    setSnipeAmountInput(String(DEFAULT_CONFIG.snipeAmountSol));
    setSlippageInput(String(DEFAULT_CONFIG.slippageBps / 100));
    setPriorityFeeInput(String(DEFAULT_CONFIG.priorityFeeSol));
    setTakeProfitInput(String(DEFAULT_CONFIG.takeProfitPct));
    setStopLossInput(String(DEFAULT_CONFIG.stopLossPct));
    setTrailingStopInput('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className={cn(
        "relative w-full bg-[#0c0c0c] rounded-3xl border border-white/10 shadow-2xl overflow-hidden",
        step === 'filters' ? 'max-w-4xl' : 'max-w-xl'
      )}>
        {/* Gradient accent at top */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-orange-500 to-yellow-500" />

        {/* Header */}
        <div className="relative px-6 pt-6 pb-4">
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>

          <h2 className="text-xl font-semibold text-white">Configure Sniper</h2>
          <p className="text-sm text-white/40 mt-1">
            Set up your automated trading bot
          </p>
        </div>

        {/* Step Navigation - Horizontal pills */}
        <div className="px-6 pb-4">
          <div className="flex items-center gap-2 p-1.5 bg-white/[0.03] rounded-2xl">
            {steps.map((s, i) => {
              const StepIcon = stepConfig[s].icon;
              const isActive = s === step;
              const isCompleted = i < stepIndex;

              return (
                <button
                  key={s}
                  onClick={() => i <= stepIndex && setStep(s)}
                  disabled={i > stepIndex}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl transition-all text-sm font-medium",
                    isActive
                      ? "bg-white/10 text-white"
                      : isCompleted
                        ? "text-white/60 hover:text-white/80 cursor-pointer"
                        : "text-white/30 cursor-not-allowed"
                  )}
                >
                  <StepIcon className={cn("w-4 h-4", isActive && stepConfig[s].color)} />
                  <span className="hidden sm:inline">{stepConfig[s].label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className={cn(
          "px-6 overflow-y-auto",
          step === 'filters' ? 'max-h-[50vh]' : 'max-h-[45vh]'
        )}>

          {/* Step 1: Basics */}
          {step === 'basics' && (
            <div className="space-y-6 py-2">
              <div className="space-y-3">
                <label className="text-sm font-medium text-white/70">Sniper Name</label>
                <input
                  type="text"
                  placeholder="e.g., Alpha Sniper"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3.5 bg-white/[0.03] border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-all"
                />
              </div>

              <div className="p-5 bg-gradient-to-br from-purple-500/10 via-transparent to-orange-500/10 rounded-2xl border border-white/5">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-orange-500/20 rounded-xl">
                    <Target className="w-5 h-5 text-orange-400" />
                  </div>
                  <div>
                    <h4 className="font-medium text-white mb-1">What is a Sniper?</h4>
                    <p className="text-sm text-white/50 leading-relaxed">
                      Your sniper automatically buys tokens the moment they migrate from PumpFun to Raydium.
                      Configure it once, and it trades 24/7.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Buying */}
          {step === 'buying' && (
            <div className="space-y-5 py-2">
              {/* Amount */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white/70">Snipe Amount</label>
                  <span className="text-xs text-white/40">Min: 0.1 SOL</span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={snipeAmountInput}
                    onChange={(e) => {
                      setSnipeAmountInput(e.target.value);
                      if (validationErrors.snipeAmountSol) {
                        setValidationErrors(prev => ({ ...prev, snipeAmountSol: false }));
                      }
                    }}
                    className={cn(
                      "w-full px-4 py-3.5 bg-white/[0.03] border rounded-xl text-white placeholder-white/30 focus:outline-none transition-all pr-16",
                      validationErrors.snipeAmountSol
                        ? "border-red-500/50 focus:border-red-500"
                        : "border-white/10 focus:border-blue-500/50"
                    )}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/40">SOL</span>
                </div>
                {validationErrors.snipeAmountSol && (
                  <p className="text-xs text-red-400">Minimum 0.1 SOL required</p>
                )}
              </div>

              {/* Slippage */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white/70">Slippage Tolerance</label>
                  <span className="text-xs text-white/40">Min: 10%</span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slippageInput}
                    onChange={(e) => {
                      setSlippageInput(e.target.value);
                      if (validationErrors.slippageBps) {
                        setValidationErrors(prev => ({ ...prev, slippageBps: false }));
                      }
                    }}
                    className={cn(
                      "w-full px-4 py-3.5 bg-white/[0.03] border rounded-xl text-white placeholder-white/30 focus:outline-none transition-all pr-12",
                      validationErrors.slippageBps
                        ? "border-red-500/50 focus:border-red-500"
                        : "border-white/10 focus:border-blue-500/50"
                    )}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/40">%</span>
                </div>
                {validationErrors.slippageBps && (
                  <p className="text-xs text-red-400">Minimum 10% slippage required</p>
                )}
              </div>

              {/* Priority Fee */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white/70">Priority Fee (Jito Tip)</label>
                  <span className="text-xs text-white/40">Min: 0.003 SOL</span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priorityFeeInput}
                    onChange={(e) => {
                      setPriorityFeeInput(e.target.value);
                      if (validationErrors.priorityFeeSol) {
                        setValidationErrors(prev => ({ ...prev, priorityFeeSol: false }));
                      }
                    }}
                    placeholder="0.003"
                    className={cn(
                      "w-full px-4 py-3.5 bg-white/[0.03] border rounded-xl text-white placeholder-white/30 focus:outline-none transition-all pr-16",
                      validationErrors.priorityFeeSol
                        ? "border-red-500/50 focus:border-red-500"
                        : "border-white/10 focus:border-blue-500/50"
                    )}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/40">SOL</span>
                </div>
                {validationErrors.priorityFeeSol && (
                  <p className="text-xs text-red-400">Minimum 0.003 SOL required</p>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Selling */}
          {step === 'selling' && (
            <div className="space-y-5 py-2">
              {/* Take Profit */}
              <div className="p-4 bg-green-500/5 border border-green-500/20 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  <label className="text-sm font-medium text-white">Take Profit</label>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={takeProfitInput}
                    onChange={(e) => setTakeProfitInput(e.target.value)}
                    className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 rounded-xl text-white focus:outline-none focus:border-green-500/50 pr-12"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/40">%</span>
                </div>
                <p className="text-xs text-white/40">100% = 2x, 200% = 3x your investment</p>
              </div>

              {/* Cover Initials */}
              <button
                type="button"
                onClick={() => updateConfig({ coverInitials: !config.coverInitials })}
                className={cn(
                  "w-full p-4 rounded-2xl border transition-all text-left",
                  config.coverInitials
                    ? "bg-blue-500/10 border-blue-500/30"
                    : "bg-white/[0.02] border-white/10 hover:border-white/20"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                      config.coverInitials ? "bg-blue-500 border-blue-500" : "border-white/30"
                    )}>
                      {config.coverInitials && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <span className="text-sm font-medium text-white">Cover Initials</span>
                  </div>
                </div>
                <p className="text-xs text-white/40 mt-2 ml-8">
                  Sell 50% at 2x to recover your initial investment
                </p>
              </button>

              {/* Stop Loss */}
              <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-400" />
                  <label className="text-sm font-medium text-white">Stop Loss</label>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={stopLossInput}
                    onChange={(e) => setStopLossInput(e.target.value)}
                    className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 rounded-xl text-white focus:outline-none focus:border-red-500/50 pr-12"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/40">%</span>
                </div>
                <p className="text-xs text-white/40">Sell when MCAP drops this % from entry</p>
              </div>

              {/* Trailing Stop */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/50">Trailing Stop (optional)</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={trailingStopInput}
                    onChange={(e) => setTrailingStopInput(e.target.value)}
                    placeholder="Leave empty to disable"
                    className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-yellow-500/50 pr-12"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/40">%</span>
                </div>
              </div>

              {/* MEV Protection */}
              <button
                type="button"
                onClick={() => updateConfig({ mevProtection: !config.mevProtection })}
                className={cn(
                  "w-full p-4 rounded-2xl border transition-all text-left",
                  config.mevProtection
                    ? "bg-orange-500/10 border-orange-500/30"
                    : "bg-white/[0.02] border-white/10 hover:border-white/20"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Shield className={cn("w-5 h-5", config.mevProtection ? "text-orange-400" : "text-white/40")} />
                    <span className="text-sm font-medium text-white">MEV Protection</span>
                  </div>
                  <div className={cn(
                    "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                    config.mevProtection ? "bg-orange-500 border-orange-500" : "border-white/30"
                  )}>
                    {config.mevProtection && <Check className="w-3 h-3 text-white" />}
                  </div>
                </div>
                <p className="text-xs text-white/40 mt-2">
                  Uses Jito bundles to protect from sandwich attacks
                </p>
              </button>
            </div>
          )}

          {/* Step 4: Filters */}
          {step === 'filters' && (
            <div className="py-2">
              {/* Token type indicator */}
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                <span className="text-sm text-orange-400 font-medium">Targeting: New Migrations</span>
              </div>

              {/* Filters Grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* Migration Speed */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Migration Speed</span>
                    {config.maxMigrationTimeMinutes && (
                      <button onClick={() => updateConfig({ maxMigrationTimeMinutes: undefined })} className="text-xs text-white/40 hover:text-white">Clear</button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[{ v: 5, l: '5m' }, { v: 15, l: '15m' }, { v: 60, l: '1h' }, { v: 360, l: '6h' }].map(o => (
                      <button
                        key={o.v}
                        onClick={() => updateConfig({ maxMigrationTimeMinutes: o.v })}
                        className={cn(
                          "py-2 rounded-lg text-xs font-medium transition-all",
                          config.maxMigrationTimeMinutes === o.v
                            ? "bg-orange-500 text-white"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        )}
                      >
                        {'<'}{o.l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Volume */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Min Volume</span>
                    {config.minVolumeUsd && (
                      <button onClick={() => updateConfig({ minVolumeUsd: undefined })} className="text-xs text-white/40 hover:text-white">Clear</button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[{ v: 10000, l: '$10k' }, { v: 25000, l: '$25k' }, { v: 50000, l: '$50k' }, { v: 100000, l: '$100k' }].map(o => (
                      <button
                        key={o.v}
                        onClick={() => updateConfig({ minVolumeUsd: o.v })}
                        className={cn(
                          "py-2 rounded-lg text-xs font-medium transition-all",
                          config.minVolumeUsd === o.v
                            ? "bg-orange-500 text-white"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        )}
                      >
                        {o.l}+
                      </button>
                    ))}
                  </div>
                </div>

                {/* Holders */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Min Holders</span>
                    {config.minHolderCount && (
                      <button onClick={() => updateConfig({ minHolderCount: undefined })} className="text-xs text-white/40 hover:text-white">Clear</button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[25, 50, 100, 250].map(v => (
                      <button
                        key={v}
                        onClick={() => updateConfig({ minHolderCount: v })}
                        className={cn(
                          "py-2 rounded-lg text-xs font-medium transition-all",
                          config.minHolderCount === v
                            ? "bg-orange-500 text-white"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        )}
                      >
                        {v}+
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dev Holdings */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Max Dev Holdings</span>
                    {config.maxDevHoldingsPct && (
                      <button onClick={() => updateConfig({ maxDevHoldingsPct: undefined })} className="text-xs text-white/40 hover:text-white">Clear</button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[5, 15, 30, 50].map(v => (
                      <button
                        key={v}
                        onClick={() => updateConfig({ maxDevHoldingsPct: v })}
                        className={cn(
                          "py-2 rounded-lg text-xs font-medium transition-all",
                          config.maxDevHoldingsPct === v
                            ? "bg-orange-500 text-white"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        )}
                      >
                        ≤{v}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Top 10 */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Max Top 10</span>
                    {config.maxTop10HoldingsPct && (
                      <button onClick={() => updateConfig({ maxTop10HoldingsPct: undefined })} className="text-xs text-white/40 hover:text-white">Clear</button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[30, 50, 70, 90].map(v => (
                      <button
                        key={v}
                        onClick={() => updateConfig({ maxTop10HoldingsPct: v })}
                        className={cn(
                          "py-2 rounded-lg text-xs font-medium transition-all",
                          config.maxTop10HoldingsPct === v
                            ? "bg-orange-500 text-white"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        )}
                      >
                        ≤{v}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* X Followers */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Min X Followers</span>
                    {config.minTwitterFollowers && (
                      <button onClick={() => updateConfig({ minTwitterFollowers: undefined })} className="text-xs text-white/40 hover:text-white">Clear</button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[{ v: 100, l: '100' }, { v: 500, l: '500' }, { v: 1000, l: '1K' }, { v: 5000, l: '5K' }].map(o => (
                      <button
                        key={o.v}
                        onClick={() => updateConfig({ minTwitterFollowers: o.v })}
                        className={cn(
                          "py-2 rounded-lg text-xs font-medium transition-all",
                          config.minTwitterFollowers === o.v
                            ? "bg-orange-500 text-white"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        )}
                      >
                        {o.l}+
                      </button>
                    ))}
                  </div>
                </div>

                {/* Socials */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <span className="text-sm font-medium text-white">Require Socials</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      onClick={() => updateConfig({ requireTwitter: !config.requireTwitter })}
                      className={cn(
                        "py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5",
                        config.requireTwitter
                          ? "bg-orange-500 text-white"
                          : "bg-white/5 text-white/50 hover:bg-white/10"
                      )}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                      X
                    </button>
                    <button
                      onClick={() => updateConfig({ requireTelegram: !config.requireTelegram })}
                      className={cn(
                        "py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5",
                        config.requireTelegram
                          ? "bg-orange-500 text-white"
                          : "bg-white/5 text-white/50 hover:bg-white/10"
                      )}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                      </svg>
                      TG
                    </button>
                    <button
                      onClick={() => updateConfig({ requireWebsite: !config.requireWebsite })}
                      className={cn(
                        "py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5",
                        config.requireWebsite
                          ? "bg-orange-500 text-white"
                          : "bg-white/5 text-white/50 hover:bg-white/10"
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

                {/* Creator Score */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Min Creator Score</span>
                    {config.minCreatorScore && (
                      <button onClick={() => updateConfig({ minCreatorScore: undefined })} className="text-xs text-white/40 hover:text-white">Clear</button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[25, 50, 75].map(v => (
                      <button
                        key={v}
                        onClick={() => updateConfig({ minCreatorScore: v })}
                        className={cn(
                          "py-2 rounded-lg text-xs font-medium transition-all",
                          config.minCreatorScore === v
                            ? "bg-orange-500 text-white"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        )}
                      >
                        {v}+
                      </button>
                    ))}
                  </div>
                </div>

                {/* LP Locked */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <span className="text-sm font-medium text-white">LP Locked</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => updateConfig({ requireLiquidityLock: false })}
                      className={cn(
                        "py-2 rounded-lg text-xs font-medium transition-all",
                        !config.requireLiquidityLock
                          ? "bg-white/20 text-white"
                          : "bg-white/5 text-white/50 hover:bg-white/10"
                      )}
                    >
                      No
                    </button>
                    <button
                      onClick={() => updateConfig({ requireLiquidityLock: true })}
                      className={cn(
                        "py-2 rounded-lg text-xs font-medium transition-all",
                        config.requireLiquidityLock
                          ? "bg-orange-500 text-white"
                          : "bg-white/5 text-white/50 hover:bg-white/10"
                      )}
                    >
                      Yes
                    </button>
                  </div>
                </div>

                {/* DexScreener Paid */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-3">
                  <span className="text-sm font-medium text-white">DexScreener Paid</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => updateConfig({ requireDexScreenerPaid: false })}
                      className={cn(
                        "py-2 rounded-lg text-xs font-medium transition-all",
                        !config.requireDexScreenerPaid
                          ? "bg-white/20 text-white"
                          : "bg-white/5 text-white/50 hover:bg-white/10"
                      )}
                    >
                      No
                    </button>
                    <button
                      onClick={() => updateConfig({ requireDexScreenerPaid: true })}
                      className={cn(
                        "py-2 rounded-lg text-xs font-medium transition-all",
                        config.requireDexScreenerPaid
                          ? "bg-orange-500 text-white"
                          : "bg-white/5 text-white/50 hover:bg-white/10"
                      )}
                    >
                      Yes
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Filters Summary */}
              {(config.maxMigrationTimeMinutes || config.minVolumeUsd || config.minHolderCount ||
                config.maxDevHoldingsPct || config.maxTop10HoldingsPct ||
                config.requireTwitter || config.requireTelegram || config.requireWebsite ||
                config.minTwitterFollowers || config.minCreatorScore ||
                config.requireLiquidityLock || config.requireDexScreenerPaid) && (
                <div className="mt-4 pt-4 border-t border-white/5">
                  <div className="flex flex-wrap gap-2">
                    {config.maxMigrationTimeMinutes && (
                      <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">Speed {'<'}{config.maxMigrationTimeMinutes}m</span>
                    )}
                    {config.minVolumeUsd && (
                      <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">Vol ${(config.minVolumeUsd / 1000)}k+</span>
                    )}
                    {config.minHolderCount && (
                      <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">{config.minHolderCount}+ holders</span>
                    )}
                    {config.maxDevHoldingsPct && (
                      <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">Dev ≤{config.maxDevHoldingsPct}%</span>
                    )}
                    {config.maxTop10HoldingsPct && (
                      <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">Top10 ≤{config.maxTop10HoldingsPct}%</span>
                    )}
                    {config.requireTwitter && <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">X</span>}
                    {config.requireTelegram && <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">TG</span>}
                    {config.requireWebsite && <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">Web</span>}
                    {config.minTwitterFollowers && (
                      <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">{config.minTwitterFollowers >= 1000 ? `${config.minTwitterFollowers / 1000}K` : config.minTwitterFollowers}+ followers</span>
                    )}
                    {config.minCreatorScore && (
                      <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">Creator {config.minCreatorScore}+</span>
                    )}
                    {config.requireLiquidityLock && <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">LP Lock</span>}
                    {config.requireDexScreenerPaid && <span className="px-2.5 py-1 bg-orange-500/20 text-orange-400 rounded-lg text-xs">DexPaid</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Review */}
          {step === 'review' && (
            <div className="py-2 space-y-4">
              {/* Header Card */}
              <div className="p-5 bg-gradient-to-br from-orange-500/10 via-transparent to-purple-500/10 rounded-2xl border border-white/10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center">
                    <Target className="w-6 h-6 text-orange-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">{name || 'My First Sniper'}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                      <span className="text-sm text-white/50">New Migrations</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Settings Grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* Buy Settings */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-medium text-white/50 uppercase tracking-wider">Buy</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-white/50">Amount</span>
                      <span className="text-sm font-medium text-white">{config.snipeAmountSol} SOL</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-white/50">Slippage</span>
                      <span className="text-sm font-medium text-white">{config.slippageBps / 100}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-white/50">Priority</span>
                      <span className="text-sm font-medium text-white">{config.priorityFeeSol} SOL</span>
                    </div>
                  </div>
                </div>

                {/* Exit Settings */}
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4 text-green-400" />
                    <span className="text-xs font-medium text-white/50 uppercase tracking-wider">Exit</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-white/50">Take Profit</span>
                      <span className="text-sm font-medium text-green-400">+{config.takeProfitPct}%</span>
                    </div>
                    {config.coverInitials && (
                      <div className="flex justify-between">
                        <span className="text-sm text-white/50">Cover</span>
                        <span className="text-sm font-medium text-blue-400">50% @ 2x</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-sm text-white/50">Stop Loss</span>
                      <span className="text-sm font-medium text-red-400">-{config.stopLossPct}%</span>
                    </div>
                    {config.trailingStopPct && (
                      <div className="flex justify-between">
                        <span className="text-sm text-white/50">Trailing</span>
                        <span className="text-sm font-medium text-yellow-400">{config.trailingStopPct}%</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-sm text-white/50">MEV</span>
                      <span className={cn("text-sm font-medium", config.mevProtection ? "text-orange-400" : "text-white/30")}>
                        {config.mevProtection ? 'On' : 'Off'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Filters Summary */}
              <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <Filter className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs font-medium text-white/50 uppercase tracking-wider">Filters</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Speed</span>
                    <span className="text-white">{config.maxMigrationTimeMinutes ? (config.maxMigrationTimeMinutes < 60 ? `<${config.maxMigrationTimeMinutes}m` : `<${config.maxMigrationTimeMinutes / 60}h`) : 'Any'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Dev %</span>
                    <span className="text-white">{config.maxDevHoldingsPct ? `≤${config.maxDevHoldingsPct}%` : 'Any'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Volume</span>
                    <span className="text-white">{config.minVolumeUsd ? `$${(config.minVolumeUsd / 1000).toFixed(0)}k+` : 'Any'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Top 10</span>
                    <span className="text-white">{config.maxTop10HoldingsPct ? `≤${config.maxTop10HoldingsPct}%` : 'Any'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Holders</span>
                    <span className="text-white">{config.minHolderCount ? `${config.minHolderCount}+` : 'Any'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Socials</span>
                    <span className="text-white">
                      {config.requireTwitter || config.requireTelegram || config.requireWebsite
                        ? [config.requireTwitter && 'X', config.requireTelegram && 'TG', config.requireWebsite && 'Web'].filter(Boolean).join(', ')
                        : 'Any'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status */}
              {hasExistingWallet && existingGeneratedWallet ? (
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center">
                      <Check className="w-4 h-4 text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Ready to Create</p>
                      <p className="text-xs text-white/40">
                        Using: {existingGeneratedWallet.publicKey?.slice(0, 6)}...{existingGeneratedWallet.publicKey?.slice(-4)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center">
                      <ChevronRight className="w-4 h-4 text-orange-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Next: Quick Setup</p>
                      <p className="text-xs text-white/40">Connect wallet, get trading wallet, done!</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex gap-3">
          {step !== 'basics' && (
            <button
              onClick={handleBack}
              disabled={isCreatingSniper}
              className="px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white font-medium transition-all flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}

          {step === 'review' ? (
            hasExistingWallet ? (
              <button
                onClick={handleCreateSniperDirect}
                disabled={!name || isCreatingSniper}
                className="flex-1 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl text-white font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Rocket className="w-4 h-4" />
                {isCreatingSniper ? 'Creating...' : 'Create Sniper'}
              </button>
            ) : (
              <button
                onClick={handleContinueToOnboarding}
                disabled={!name}
                className="flex-1 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl text-white font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                Continue to Setup
                <ChevronRight className="w-4 h-4" />
              </button>
            )
          ) : (
            <button
              onClick={handleNext}
              disabled={step === 'basics' && !name}
              className="flex-1 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl text-white font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
