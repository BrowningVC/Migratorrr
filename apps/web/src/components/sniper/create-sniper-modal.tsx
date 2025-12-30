'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';

import { useAuthStore } from '@/lib/stores/auth';
import { useWalletsStore, Wallet } from '@/lib/stores/wallets';
import { useSnipersStore, Sniper, SniperConfig } from '@/lib/stores/snipers';
import { sniperApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface CreateSniperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (sniper: Sniper) => void;
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

export function CreateSniperModal({
  isOpen,
  onClose,
  onCreated,
}: CreateSniperModalProps) {
  const { token } = useAuthStore();
  const { wallets } = useWalletsStore();
  const { addSniper } = useSnipersStore();

  const [step, setStep] = useState<Step>('basics');
  const [isLoading, setIsLoading] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [selectedWalletId, setSelectedWalletId] = useState(
    wallets.find((w) => w.walletType === 'generated')?.id || wallets[0]?.id || ''
  );
  const [config, setConfig] = useState<SniperConfig>(DEFAULT_CONFIG);

  const steps: Step[] = ['basics', 'selling', 'buying', 'filters', 'review'];
  const stepIndex = steps.indexOf(step);

  const stepLabels = {
    basics: 'Basics',
    selling: 'Exit Strategy',
    buying: 'Buy Settings',
    filters: 'Filters',
    review: 'Review',
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
        config: finalConfig,
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
      handleClose();
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
    onClose();
  };

  if (!isOpen) return null;

  const generatedWallets = wallets.filter((w) => w.walletType === 'generated');

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="bg-zinc-900 border-zinc-800 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader className="border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Create Sniper</CardTitle>
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
              </div>

              <div className="space-y-2">
                <Label>Trading Wallet</Label>
                {generatedWallets.length === 0 ? (
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
            </div>
          )}

          {/* Step 2: Selling/Exit Strategy */}
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
                  Automatically sell when profit reaches this % (leave empty to disable)
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
                  Automatically sell when loss reaches this % (leave empty to disable)
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
                  Sell when price drops this % from highest point (leave empty to disable)
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Buying/Entry Settings */}
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
            <div className="space-y-5">
              {/* Token Type - Always enabled */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Token Type</Label>
                <div className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled={true}
                    className="w-4 h-4 rounded bg-green-600 border-green-600 text-green-600 cursor-not-allowed"
                  />
                  <div>
                    <span className="text-sm font-medium">Newly Migrated Tokens</span>
                    <p className="text-xs text-zinc-500">Only tokens that just migrated from PumpFun to Raydium</p>
                  </div>
                </div>
              </div>

              {/* Migration Time Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Migration Speed</Label>
                <p className="text-xs text-zinc-500 mb-2">
                  Time from token creation to migration (select one)
                </p>
                <div className="space-y-2">
                  {[
                    { value: 5, label: 'Migrated in less than 5 minutes' },
                    { value: 15, label: 'Migrated in less than 15 minutes' },
                    { value: 60, label: 'Migrated in less than 1 hour' },
                    { value: 360, label: 'Migrated in less than 6 hours' },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                        config.maxMigrationTimeMinutes === option.value
                          ? 'bg-green-900/20 border-green-700'
                          : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-600'
                      )}
                    >
                      <input
                        type="radio"
                        name="migrationTime"
                        checked={config.maxMigrationTimeMinutes === option.value}
                        onChange={() => updateConfig({ maxMigrationTimeMinutes: option.value })}
                        className="w-4 h-4 text-green-600 bg-zinc-800 border-zinc-600"
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                  <label
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      !config.maxMigrationTimeMinutes
                        ? 'bg-green-900/20 border-green-700'
                        : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-600'
                    )}
                  >
                    <input
                      type="radio"
                      name="migrationTime"
                      checked={!config.maxMigrationTimeMinutes}
                      onChange={() => updateConfig({ maxMigrationTimeMinutes: undefined })}
                      className="w-4 h-4 text-green-600 bg-zinc-800 border-zinc-600"
                    />
                    <span className="text-sm text-zinc-400">No time restriction</span>
                  </label>
                </div>
              </div>

              {/* Volume Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Minimum Volume</Label>
                <p className="text-xs text-zinc-500 mb-2">
                  Total trading volume since token deployment (select one)
                </p>
                <div className="space-y-2">
                  {[
                    { value: 10000, label: 'Over $10k in Volume' },
                    { value: 25000, label: 'Over $25k in Volume' },
                    { value: 50000, label: 'Over $50k in Volume' },
                    { value: 100000, label: 'Over $100k in Volume' },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                        config.minVolumeUsd === option.value
                          ? 'bg-green-900/20 border-green-700'
                          : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-600'
                      )}
                    >
                      <input
                        type="radio"
                        name="volumeFilter"
                        checked={config.minVolumeUsd === option.value}
                        onChange={() => updateConfig({ minVolumeUsd: option.value })}
                        className="w-4 h-4 text-green-600 bg-zinc-800 border-zinc-600"
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                  <label
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      !config.minVolumeUsd
                        ? 'bg-green-900/20 border-green-700'
                        : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-600'
                    )}
                  >
                    <input
                      type="radio"
                      name="volumeFilter"
                      checked={!config.minVolumeUsd}
                      onChange={() => updateConfig({ minVolumeUsd: undefined })}
                      className="w-4 h-4 text-green-600 bg-zinc-800 border-zinc-600"
                    />
                    <span className="text-sm text-zinc-400">No volume restriction</span>
                  </label>
                </div>
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
                {config.maxMigrationTimeMinutes && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Migration Speed</span>
                    <span className="font-medium">
                      {config.maxMigrationTimeMinutes < 60
                        ? `< ${config.maxMigrationTimeMinutes}m`
                        : `< ${config.maxMigrationTimeMinutes / 60}h`}
                    </span>
                  </div>
                )}
                {config.minVolumeUsd && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Min Volume</span>
                    <span className="font-medium">${(config.minVolumeUsd / 1000).toFixed(0)}k+</span>
                  </div>
                )}
              </div>

              <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-3">
                <p className="text-yellow-400 text-xs">
                  <strong>Note:</strong> The sniper will be created in paused state.
                  Activate it from the dashboard when ready to start sniping.
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
