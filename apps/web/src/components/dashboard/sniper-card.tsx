'use client';

import { Sniper } from '@/lib/stores/snipers';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SniperCardProps {
  sniper: Sniper;
  onToggle?: (sniperId: string) => void;
  onEdit?: (sniperId: string) => void;
  onDelete?: (sniperId: string) => void;
}

export function SniperCard({
  sniper,
  onToggle,
  onEdit,
  onDelete,
}: SniperCardProps) {
  const { id, name, isActive, config, stats } = sniper;

  const winRate =
    stats.totalSnipes > 0
      ? ((stats.successfulSnipes / stats.totalSnipes) * 100).toFixed(0)
      : '--';

  return (
    <Card
      className={cn(
        'bg-zinc-900/50 border-zinc-800 transition-all',
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
            onClick={() => onToggle?.(id)}
            className={cn(
              isActive && 'bg-green-600 hover:bg-green-700'
            )}
          >
            {isActive ? 'Active' : 'Paused'}
          </Button>
        </div>

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
        </div>

        {/* Filters */}
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
}
