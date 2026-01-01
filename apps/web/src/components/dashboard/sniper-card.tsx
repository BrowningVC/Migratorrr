'use client';

import { memo, useState } from 'react';
import { Shield, ChevronDown, Filter, AlertTriangle, Copy, Check, Wallet } from 'lucide-react';
import { Sniper } from '@/lib/stores/snipers';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface SniperCardProps {
  sniper: Sniper;
  walletBalance?: number; // SOL balance of associated wallet
  walletAddress?: string; // Public key of the wallet
  onToggle?: (sniperId: string, hasInsufficientFunds: boolean) => void;
  onDelete?: (sniperId: string) => void;
}

export const SniperCard = memo(function SniperCard({
  sniper,
  walletBalance,
  walletAddress,
  onToggle,
  onDelete,
}: SniperCardProps) {
  const { id, name, isActive, config, stats } = sniper;

  // Calculate minimum required balance:
  // snipe amount + priority fee (Jito tip) + platform fee (1%) + network fees buffer
  const platformFeePct = 0.01; // 1% platform fee (100 bps)
  const platformFee = config.snipeAmountSol * platformFeePct;
  const networkFeeBuffer = 0.001; // ~5000 lamports for tx fees
  const minRequiredBalance = config.snipeAmountSol + config.priorityFeeSol + platformFee + networkFeeBuffer;
  // Treat undefined balance as 0 (wallet not funded yet)
  const effectiveBalance = walletBalance ?? 0;
  const hasInsufficientFunds = effectiveBalance < minRequiredBalance;
  const [showFilters, setShowFilters] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const handleCopyAddress = async () => {
    if (walletAddress) {
      await navigator.clipboard.writeText(walletAddress);
      setCopiedAddress(true);
      toast.success('Wallet address copied!');
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

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

  // Format holder count filter for display
  const formatHolders = (count?: number) => {
    if (!count) return null;
    return `${count}+`;
  };

  // Format percentage filter for display
  const formatPercentage = (pct?: number) => {
    if (!pct) return null;
    return `≤${pct}%`;
  };

  // Get active social requirements
  const getSocialRequirements = () => {
    const socials = [];
    if (config.requireTwitter) socials.push('X');
    if (config.requireTelegram) socials.push('TG');
    if (config.requireWebsite) socials.push('Web');
    return socials.length > 0 ? socials.join(', ') : null;
  };

  // Check if any migration filters are set
  const hasFilters = config.maxMigrationTimeMinutes ||
    config.minVolumeUsd ||
    config.minHolderCount ||
    config.maxDevHoldingsPct ||
    config.maxTop10HoldingsPct ||
    config.requireTwitter ||
    config.requireTelegram ||
    config.requireWebsite;

  return (
    <Card
      className={cn(
        'bg-zinc-900/50 border-zinc-800 transition-[border-color,box-shadow] duration-200',
        isActive && 'border-green-900/50 ring-1 ring-green-500/20'
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
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

        {/* Wallet Address */}
        {walletAddress && (
          <div className="flex items-center gap-2 mb-4 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
            <Wallet className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
            <code className="text-xs text-zinc-400 font-mono flex-1 truncate">
              {walletAddress}
            </code>
            <button
              onClick={handleCopyAddress}
              className="p-1 hover:bg-zinc-700 rounded transition-colors flex-shrink-0"
              title="Copy address"
            >
              {copiedAddress ? (
                <Check className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
              )}
            </button>
          </div>
        )}

        {/* Insufficient funds warning */}
        {hasInsufficientFunds && (
          <div className="flex items-center gap-2 p-2.5 mb-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-300">
              Wallet needs {minRequiredBalance.toFixed(3)} SOL to snipe. Current: {effectiveBalance.toFixed(4)} SOL
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
                {[
                  config.maxMigrationTimeMinutes,
                  config.minVolumeUsd,
                  config.minHolderCount,
                  config.maxDevHoldingsPct,
                  config.maxTop10HoldingsPct,
                  config.requireTwitter,
                  config.requireTelegram,
                  config.requireWebsite
                ].filter(Boolean).length}
              </span>
            )}
          </span>
          <ChevronDown className={cn(
            'w-4 h-4 text-zinc-500 transition-transform',
            showFilters && 'rotate-180'
          )} />
        </button>

        {/* Migration Filters Content - Compact 2-column grid */}
        {showFilters && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-4 p-2 bg-zinc-800/30 rounded-lg border border-zinc-800">
            <div className="flex justify-between">
              <span className="text-zinc-500">Migration Speed</span>
              <span className="text-white">{formatMigrationTime(config.maxMigrationTimeMinutes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Volume</span>
              <span className="text-white">{formatVolume(config.minVolumeUsd)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Holders</span>
              <span className="text-white">{formatHolders(config.minHolderCount) || 'Any'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Dev %</span>
              <span className="text-white">{formatPercentage(config.maxDevHoldingsPct) || 'Any'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Top 10</span>
              <span className="text-white">{formatPercentage(config.maxTop10HoldingsPct) || 'Any'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Socials</span>
              <span className="text-white">{getSocialRequirements() || 'None'}</span>
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
            className="flex-1 text-red-400 hover:text-red-300 hover:bg-red-900/20"
            onClick={() => onDelete?.(id)}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});
