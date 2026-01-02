'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { X, ImageIcon } from 'lucide-react';

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

export function StatsCards({ stats }: StatsCardsProps) {
  const [showComingSoon, setShowComingSoon] = useState(false);
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
    <div className="space-y-2">
      {/* Row 1: Core Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2">
        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Total P&L</p>
            <p
              className={cn(
                'text-lg font-bold',
                isProfitable ? 'text-orange-400' : 'text-red-400'
              )}
            >
              {totalPnlSol >= 0 ? '+' : ''}{totalPnlSol.toFixed(4)}
            </p>
            <p className="text-zinc-500 text-[10px]">
              ({totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%)
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Open Positions</p>
            <p className="text-lg font-bold text-white">{openPositions}</p>
            <p className="text-zinc-500 text-[10px]">Active trades</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Active Snipers</p>
            <p className="text-lg font-bold text-orange-400">{activeSnipers}</p>
            <p className="text-zinc-500 text-[10px]">Watching</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Snipes Today</p>
            <p className="text-lg font-bold text-white">{snipesToday}</p>
            <p className="text-zinc-500 text-[10px]">Last 24h</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Success Rate</p>
            <p className="text-lg font-bold text-white">{successRate}%</p>
            <p className="text-zinc-500 text-[10px]">Tx success</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Status</p>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
              <p className="text-sm font-medium text-orange-400">Connected</p>
            </div>
            <p className="text-zinc-500 text-[10px]">Real-time</p>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Extended Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2">
        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Best Trade</p>
            <p className={cn(
              'text-lg font-bold',
              bestTradeSol > 0 ? 'text-orange-400' : 'text-zinc-400'
            )}>
              {bestTradeSol > 0 ? `+${bestTradeSol.toFixed(2)}` : '—'}
            </p>
            <p className="text-zinc-500 text-[10px]">
              {bestTradePct > 0 ? `+${bestTradePct.toFixed(0)}%` : 'No trades'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Worst Trade</p>
            <p className={cn(
              'text-lg font-bold',
              worstTradeSol < 0 ? 'text-red-400' : 'text-zinc-400'
            )}>
              {worstTradeSol < 0 ? worstTradeSol.toFixed(2) : '—'}
            </p>
            <p className="text-zinc-500 text-[10px]">
              {worstTradePct < 0 ? `${worstTradePct.toFixed(0)}%` : 'No losses'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Tokens Caught</p>
            <p className="text-lg font-bold text-orange-400">{tokensCaught}</p>
            <p className="text-zinc-500 text-[10px]">Sniped</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Tokens Avoided</p>
            <p className="text-lg font-bold text-yellow-400">{tokensAvoided}</p>
            <p className="text-zinc-500 text-[10px]">Filtered</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
          <CardContent className="p-3">
            <p className="text-zinc-500 text-xs mb-0.5">Biggest Miss</p>
            {biggestMiss ? (
              <>
                <p className="text-lg font-bold text-orange-400">${biggestMiss.ticker}</p>
                <p className="text-zinc-500 text-[10px]">{formatMcap(biggestMiss.athMcap)}</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-zinc-400">—</p>
                <p className="text-zinc-500 text-[10px]">No data</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card
          className="bg-zinc-900/50 border-zinc-800 hover:border-orange-800/50 transition-colors cursor-pointer group col-span-2"
          onClick={() => setShowComingSoon(true)}
        >
          <CardContent className="p-3 flex flex-col items-center justify-center h-full">
            <div className="w-8 h-8 rounded-full bg-orange-900/30 flex items-center justify-center mb-1 group-hover:bg-orange-900/50 transition-colors">
              <ImageIcon className="w-4 h-4 text-orange-400" />
            </div>
            <p className="text-xs font-medium text-orange-400">Share Results</p>
            <p className="text-zinc-500 text-[10px]">Show off gains</p>
          </CardContent>
        </Card>
      </div>

      {/* Coming Soon Modal */}
      {showComingSoon && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowComingSoon(false)}>
          <Card className="bg-zinc-900 border-zinc-700 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <CardContent className="p-6 text-center">
              <button
                onClick={() => setShowComingSoon(false)}
                className="absolute top-3 right-3 text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-16 h-16 rounded-full bg-orange-900/30 flex items-center justify-center mx-auto mb-4">
                <ImageIcon className="w-8 h-8 text-orange-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Coming Soon</h3>
              <p className="text-zinc-400 text-sm">
                Share your trading results with a beautiful card image. This feature is under development.
              </p>
              <Button
                className="mt-4 bg-orange-600 hover:bg-orange-700"
                onClick={() => setShowComingSoon(false)}
              >
                Got it
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
