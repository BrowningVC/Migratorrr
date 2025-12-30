'use client';

import { memo } from 'react';
import { Position } from '@/lib/stores/positions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PositionCardProps {
  position: Position;
  onSell?: (positionId: string) => void;
}

export const PositionCard = memo(function PositionCard({ position, onSell }: PositionCardProps) {
  const {
    id,
    tokenSymbol,
    tokenMint,
    entrySol,
    entryPrice,
    currentPrice,
    currentTokenAmount,
    pnlPct,
    pnlSol,
    takeProfitPrice,
    stopLossPrice,
    trailingStopPct,
    highestPrice,
    status,
  } = position;

  const displaySymbol = tokenSymbol || tokenMint.slice(0, 6);
  const isProfitable = (pnlPct || 0) > 0;
  const currentValue = currentPrice
    ? currentPrice * currentTokenAmount
    : entrySol;

  return (
    <Card
      className={cn(
        'bg-zinc-900/50 border-zinc-800 transition-[border-color,opacity] duration-200',
        status === 'selling' && 'opacity-60',
        isProfitable && 'border-green-900/50',
        !isProfitable && pnlPct !== undefined && 'border-red-900/50'
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-lg">${displaySymbol}</h3>
            <p className="text-zinc-500 text-xs font-mono">
              {tokenMint.slice(0, 8)}...{tokenMint.slice(-8)}
            </p>
          </div>
          <div className="text-right">
            <p
              className={cn(
                'text-xl font-bold',
                isProfitable ? 'text-green-400' : 'text-red-400',
                pnlPct === undefined && 'text-zinc-400'
              )}
            >
              {pnlPct !== undefined ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` : '--'}
            </p>
            {pnlSol !== undefined && (
              <p
                className={cn(
                  'text-sm',
                  isProfitable ? 'text-green-500/70' : 'text-red-500/70'
                )}
              >
                {pnlSol >= 0 ? '+' : ''}{pnlSol.toFixed(4)} SOL
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div>
            <p className="text-zinc-500">Entry</p>
            <p className="font-medium">{entrySol.toFixed(4)} SOL</p>
          </div>
          <div>
            <p className="text-zinc-500">Current Value</p>
            <p className="font-medium">{currentValue.toFixed(4)} SOL</p>
          </div>
          <div>
            <p className="text-zinc-500">Entry Price</p>
            <p className="font-medium">{entryPrice.toExponential(2)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Current Price</p>
            <p className="font-medium">
              {currentPrice ? currentPrice.toExponential(2) : '--'}
            </p>
          </div>
          <div>
            <p className="text-zinc-500">Amount</p>
            <p className="font-medium">{currentTokenAmount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-zinc-500">Highest</p>
            <p className="font-medium">
              {highestPrice ? highestPrice.toExponential(2) : '--'}
            </p>
          </div>
        </div>

        {/* Automation indicators */}
        <div className="flex flex-wrap gap-2 mb-4">
          {takeProfitPrice && (
            <span className="px-2 py-1 bg-green-900/30 text-green-400 text-xs rounded">
              TP: {((takeProfitPrice / entryPrice - 1) * 100).toFixed(0)}%
            </span>
          )}
          {stopLossPrice && (
            <span className="px-2 py-1 bg-red-900/30 text-red-400 text-xs rounded">
              SL: {((stopLossPrice / entryPrice - 1) * 100).toFixed(0)}%
            </span>
          )}
          {trailingStopPct && (
            <span className="px-2 py-1 bg-yellow-900/30 text-yellow-400 text-xs rounded">
              Trail: {trailingStopPct}%
            </span>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={status === 'selling'}
          onClick={() => onSell?.(id)}
        >
          {status === 'selling' ? 'Selling...' : 'Sell'}
        </Button>
      </CardContent>
    </Card>
  );
});
