'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Share2 } from 'lucide-react';

interface StatsCardsProps {
  stats: {
    totalPnlSol: number;
    totalPnlPct: number;
    openPositions: number;
    activeSnipers: number;
    snipesToday: number;
    successRate: number;
    // Extended stats
    bestTradeSol?: number;
    bestTradePct?: number;
    worstTradeSol?: number;
    worstTradePct?: number;
    tokensCaught?: number;
    tokensAvoided?: number;
    biggestMiss?: {
      ticker: string;
      athMcap: number;
    } | null;
  };
  onShare?: () => void;
}

export function StatsCards({ stats, onShare }: StatsCardsProps) {
  const {
    totalPnlSol,
    totalPnlPct,
    openPositions,
    activeSnipers,
    snipesToday,
    successRate,
    bestTradeSol = 0,
    bestTradePct = 0,
    worstTradeSol = 0,
    worstTradePct = 0,
    tokensCaught = 0,
    tokensAvoided = 0,
    biggestMiss = null,
  } = stats;

  const isProfitable = totalPnlSol >= 0;

  const formatMcap = (value: number): string => {
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Core Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Total P&L</p>
            <p
              className={cn(
                'text-2xl font-bold',
                isProfitable ? 'text-green-400' : 'text-red-400'
              )}
            >
              {totalPnlSol >= 0 ? '+' : ''}{totalPnlSol.toFixed(4)}
            </p>
            <p className="text-zinc-500 text-xs">
              ({totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%)
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Open Positions</p>
            <p className="text-2xl font-bold text-white">{openPositions}</p>
            <p className="text-zinc-500 text-xs">Active trades</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Active Snipers</p>
            <p className="text-2xl font-bold text-green-400">{activeSnipers}</p>
            <p className="text-zinc-500 text-xs">Watching for migrations</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Snipes Today</p>
            <p className="text-2xl font-bold text-white">{snipesToday}</p>
            <p className="text-zinc-500 text-xs">Last 24 hours</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Success Rate</p>
            <p className="text-2xl font-bold text-white">{successRate}%</p>
            <p className="text-zinc-500 text-xs">Transaction success</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Status</p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <p className="text-lg font-medium text-green-400">Connected</p>
            </div>
            <p className="text-zinc-500 text-xs">Real-time updates active</p>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Extended Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Best Trade</p>
            <p className={cn(
              'text-2xl font-bold',
              bestTradeSol > 0 ? 'text-green-400' : 'text-zinc-400'
            )}>
              {bestTradeSol > 0 ? `+${bestTradeSol.toFixed(2)}` : '—'}
            </p>
            <p className="text-zinc-500 text-xs">
              {bestTradePct > 0 ? `+${bestTradePct.toFixed(0)}% gain` : 'No trades yet'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Worst Trade</p>
            <p className={cn(
              'text-2xl font-bold',
              worstTradeSol < 0 ? 'text-red-400' : 'text-zinc-400'
            )}>
              {worstTradeSol < 0 ? worstTradeSol.toFixed(2) : '—'}
            </p>
            <p className="text-zinc-500 text-xs">
              {worstTradePct < 0 ? `${worstTradePct.toFixed(0)}% loss` : 'No losses yet'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Tokens Caught</p>
            <p className="text-2xl font-bold text-green-400">{tokensCaught}</p>
            <p className="text-zinc-500 text-xs">Successfully sniped</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Tokens Avoided</p>
            <p className="text-2xl font-bold text-yellow-400">{tokensAvoided}</p>
            <p className="text-zinc-500 text-xs">Filtered out by rules</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-zinc-500 text-sm mb-1">Biggest Miss</p>
            {biggestMiss ? (
              <>
                <p className="text-2xl font-bold text-orange-400">${biggestMiss.ticker}</p>
                <p className="text-zinc-500 text-xs">ATH: {formatMcap(biggestMiss.athMcap)}</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-zinc-400">—</p>
                <p className="text-zinc-500 text-xs">No data yet</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 hover:border-green-800/50 transition-colors cursor-pointer group" onClick={onShare}>
          <CardContent className="p-4 flex flex-col items-center justify-center h-full">
            <div className="w-10 h-10 rounded-full bg-green-900/30 flex items-center justify-center mb-2 group-hover:bg-green-900/50 transition-colors">
              <Share2 className="w-5 h-5 text-green-400" />
            </div>
            <p className="text-sm font-medium text-green-400">Share Results</p>
            <p className="text-zinc-500 text-xs">Show off your gains</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
