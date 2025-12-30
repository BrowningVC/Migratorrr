'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePendingSniperStore } from '@/lib/stores/pending-sniper';
import { SniperConfig } from '@/lib/stores/snipers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface PreAuthSniperModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'basics' | 'selling' | 'buying' | 'filters' | 'review';

const DEFAULT_CONFIG: SniperConfig = {
  snipeAmountSol: 0.1,
  slippageBps: 1000, // 10%
  priorityFeeSol: 0.001,
  takeProfitPct: 100, // 2x
  stopLossPct: 50,
  trailingStopPct: undefined,
  minLiquiditySol: 5,
};

export function PreAuthSniperModal({ isOpen, onClose }: PreAuthSniperModalProps) {
  const router = useRouter();
  const { setPendingSniper } = usePendingSniperStore();

  const [step, setStep] = useState<Step>('basics');

  // Form state
  const [name, setName] = useState('My First Sniper');
  const [config, setConfig] = useState<SniperConfig>(DEFAULT_CONFIG);
  const [namePatterns, setNamePatterns] = useState('');
  const [excludedPatterns, setExcludedPatterns] = useState('');

  const steps: Step[] = ['basics', 'selling', 'buying', 'filters', 'review'];
  const stepIndex = steps.indexOf(step);

  const stepLabels = {
    basics: 'Name Your Sniper',
    selling: 'Exit Strategy',
    buying: 'Buy Settings',
    filters: 'Token Filters',
    review: 'Review & Continue',
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

  const handleContinueToSignup = () => {
    // Save config to localStorage via store
    setPendingSniper({
      name,
      config,
      namePatterns: namePatterns || undefined,
      excludedPatterns: excludedPatterns || undefined,
      createdAt: Date.now(),
    });

    // Navigate to onboarding
    router.push('/onboarding');
    onClose();
  };

  const handleClose = () => {
    setStep('basics');
    setName('My First Sniper');
    setConfig(DEFAULT_CONFIG);
    setNamePatterns('');
    setExcludedPatterns('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="bg-zinc-900 border-zinc-800 w-full max-w-lg max-h-[90vh] overflow-y-auto">
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

        <CardContent className="p-6">
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
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="minLiquidity">Minimum Liquidity (SOL)</Label>
                <Input
                  id="minLiquidity"
                  type="number"
                  step="1"
                  min="0"
                  value={config.minLiquiditySol || ''}
                  onChange={(e) =>
                    updateConfig({
                      minLiquiditySol: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  placeholder="e.g., 5"
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Only snipe tokens with at least this much liquidity
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="namePatterns">Name Patterns (comma-separated)</Label>
                <Input
                  id="namePatterns"
                  value={namePatterns}
                  onChange={(e) => setNamePatterns(e.target.value)}
                  placeholder="e.g., pepe, doge, shib"
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Only snipe tokens whose name/symbol contains these (leave empty for all)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="excludedPatterns">Excluded Patterns (comma-separated)</Label>
                <Input
                  id="excludedPatterns"
                  value={excludedPatterns}
                  onChange={(e) => setExcludedPatterns(e.target.value)}
                  placeholder="e.g., scam, rug, honeypot"
                  className="bg-zinc-800 border-zinc-700"
                />
                <p className="text-xs text-zinc-500">
                  Skip tokens whose name/symbol contains these
                </p>
              </div>
            </div>
          )}

          {/* Step 5: Review */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Name</span>
                  <span className="font-medium">{name || '-'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Snipe Amount</span>
                  <span className="font-medium">{config.snipeAmountSol} SOL</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Slippage</span>
                  <span className="font-medium">{config.slippageBps / 100}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Priority Fee</span>
                  <span className="font-medium">{config.priorityFeeSol} SOL</span>
                </div>
                {config.takeProfitPct && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Take Profit</span>
                    <span className="font-medium text-green-400">+{config.takeProfitPct}%</span>
                  </div>
                )}
                {config.stopLossPct && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Stop Loss</span>
                    <span className="font-medium text-red-400">-{config.stopLossPct}%</span>
                  </div>
                )}
                {config.trailingStopPct && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Trailing Stop</span>
                    <span className="font-medium text-yellow-400">{config.trailingStopPct}%</span>
                  </div>
                )}
                {config.minLiquiditySol && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Min Liquidity</span>
                    <span className="font-medium">{config.minLiquiditySol} SOL</span>
                  </div>
                )}
              </div>

              <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-3">
                <p className="text-green-400 text-xs">
                  <strong>Almost there!</strong> Connect your wallet to create this sniper and start catching migrations.
                </p>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-6">
            {step !== 'basics' && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleBack}
              >
                Back
              </Button>
            )}
            {step !== 'review' ? (
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleNext}
                disabled={step === 'basics' && !name}
              >
                Continue
              </Button>
            ) : (
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleContinueToSignup}
                disabled={!name}
              >
                Connect Wallet & Create
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
