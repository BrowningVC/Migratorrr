'use client';

import { memo, useState } from 'react';
import { Shield, ChevronDown, Filter, AlertTriangle } from 'lucide-react';
import { Sniper } from '@/lib/stores/snipers';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SniperCardProps {
  sniper: Sniper;
  walletBalance?: number; // SOL balance of associated wallet
  onToggle?: (sniperId: string, hasInsufficientFunds: boolean) => void;
  onEdit?: (sniperId: string) => void;
  onDelete?: (sniperId: string) => void;
}

export const SniperCard = memo(function SniperCard({
  sniper,
  walletBalance,
  onToggle,
  onEdit,
  onDelete,
}: SniperCardProps) {
  const { id, name, isActive, config, stats } = sniper;

  // Calculate minimum required balance (snipe amount + priority fee + buffer for tx fees)
  const minRequiredBalance = config.snipeAmountSol + config.priorityFeeSol + 0.002;
  const hasInsufficientFunds = walletBalance !== undefined && walletBalance < minRequiredBalance;
  const [showFilters, setShowFilters] = useState(false);

  const winRate =
    stats.totalSnipes > 0
      ? ((stats.successfulSnipes / stats.totalSnipes) * 100).toFixed(0)
      : '--';

  // Format migration time filter for display
  const formatMigrationTime = (minutes?: number) => {
    if (!minutes) return 'Any';
    if (minutes < 60) return `< ${minutes} min`;
    return `< ${minutes / 60}h`;
  };

  // Format volume filter for display
  const formatVolume = (usd?: number) => {
    if (!usd) return 'Any';
    if (usd >= 1000) return `$${(usd / 1000).toFixed(0)}k+`;
    return `$${usd}+`;
  };

  // Check if any migration filters are set
  const hasFilters = config.maxMigrationTimeMinutes || config.minVolumeUsd || config.minLiquiditySol;

  return (
    <Card
      className={cn(
        'bg-zinc-900/50 border-zinc-800 transition-[border-color,box-shadow] duration-200',
        isActive && 'border-green-900/50 ring-1 ring-green-500/20'
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-lg flex items-center gap-2">
              {name}
              {isActive && (
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              )}
            </h3>
            <p className="text-zinc-500 text-sm">
              {config.snipeAmountSol} SOL per snipe
            </p>
          </div>
          <Button
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            onClick={() => onToggle?.(id, !isActive && hasInsufficientFunds)}
            className={cn(
              isActive && 'bg-green-600 hover:bg-green-700'
            )}
          >
            {isActive ? 'Active' : 'Paused'}
          </Button>
        </div>

        {/* Insufficient funds warning */}
        {hasInsufficientFunds && (
          <div className="flex items-center gap-2 p-2.5 mb-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-300">
              Wallet needs {minRequiredBalance.toFixed(3)} SOL to snipe. Current: {walletBalance?.toFixed(4) || '0'} SOL
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 text-sm mb-4">
          <div>
            <p className="text-zinc-500">Snipes</p>
            <p className="font-medium">{stats.totalSnipes}</p>
          </div>
          <div>
            <p className="text-zinc-500">Win Rate</p>
            <p className="font-medium">{winRate}%</p>
          </div>
          <div>
            <p className="text-zinc-500">SOL Spent</p>
            <p className="font-medium">{stats.totalSolSpent.toFixed(2)}</p>
          </div>
        </div>

        <div className="space-y-2 text-sm mb-4">
          <div className="flex justify-between">
            <span className="text-zinc-500">Slippage</span>
            <span>{config.slippageBps / 100}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Priority Fee</span>
            <span>{config.priorityFeeSol} SOL</span>
          </div>
          {config.takeProfitPct && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Take Profit</span>
              <span className="text-green-400">+{config.takeProfitPct}%</span>
            </div>
          )}
          {config.stopLossPct && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Stop Loss</span>
              <span className="text-red-400">-{config.stopLossPct}%</span>
            </div>
          )}
          {config.trailingStopPct && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Trailing Stop</span>
              <span className="text-yellow-400">{config.trailingStopPct}%</span>
            </div>
          )}
          {config.minLiquiditySol && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Min Liquidity</span>
              <span>{config.minLiquiditySol} SOL</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-zinc-500 flex items-center gap-1">
              <Shield className="w-3 h-3" />
              MEV Protection
            </span>
            <span className={cn(
              'font-medium',
              config.mevProtection ?? true ? 'text-green-400' : 'text-zinc-500'
            )}>
              {config.mevProtection ?? true ? 'On' : 'Off'}
            </span>
          </div>
        </div>

        {/* Migration Filters Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="w-full flex items-center justify-between px-3 py-2 mb-3 text-sm bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <span className="flex items-center gap-2 text-zinc-400">
            <Filter className="w-3.5 h-3.5" />
            Migration Filters
            {hasFilters && (
              <span className="px-1.5 py-0.5 text-xs bg-blue-900/40 text-blue-400 rounded">
                {[config.maxMigrationTimeMinutes, config.minVolumeUsd, config.minLiquiditySol].filter(Boolean).length}
              </span>
            )}
          </span>
          <ChevronDown className={cn(
            'w-4 h-4 text-zinc-500 transition-transform',
            showFilters && 'rotate-180'
          )} />
        </button>

        {/* Migration Filters Content */}
        {showFilters && (
          <div className="space-y-2 text-sm mb-4 p-3 bg-zinc-800/30 rounded-lg border border-zinc-800">
            <div className="flex justify-between">
              <span className="text-zinc-500">Migration Speed</span>
              <span className="text-white">{formatMigrationTime(config.maxMigrationTimeMinutes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Min Volume</span>
              <span className="text-white">{formatVolume(config.minVolumeUsd)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Min Liquidity</span>
              <span className="text-white">{config.minLiquiditySol ? `${config.minLiquiditySol} SOL` : 'Any'}</span>
            </div>
          </div>
        )}

        {/* Name Filters */}
        {(config.namePatterns?.length || config.excludedPatterns?.length) && (
          <div className="space-y-2 text-sm mb-4 pt-2 border-t border-zinc-800">
            {config.namePatterns && config.namePatterns.length > 0 && (
              <div>
                <p className="text-zinc-500 text-xs mb-1">Include patterns:</p>
                <div className="flex flex-wrap gap-1">
                  {config.namePatterns.map((p, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-blue-900/30 text-blue-400 text-xs rounded"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {config.excludedPatterns && config.excludedPatterns.length > 0 && (
              <div>
                <p className="text-zinc-500 text-xs mb-1">Exclude patterns:</p>
                <div className="flex flex-wrap gap-1">
                  {config.excludedPatterns.map((p, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-red-900/30 text-red-400 text-xs rounded"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onEdit?.(id)}
          >
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
            onClick={() => onDelete?.(id)}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});
