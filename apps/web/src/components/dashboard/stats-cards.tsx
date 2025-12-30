'use client';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatsCardsProps {
  stats: {
    totalPnlSol: number;
    totalPnlPct: number;
    openPositions: number;
    activeSnipers: number;
    snipesToday: number;
    successRate: number;
  };
}

export function StatsCards({ stats }: StatsCardsProps) {
  const {
    totalPnlSol,
    totalPnlPct,
    openPositions,
    activeSnipers,
    snipesToday,
    successRate,
  } = stats;

  const isProfitable = totalPnlSol >= 0;

  return (
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
  );
}
