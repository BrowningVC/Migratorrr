'use client';

import { useActivityStore } from '@/lib/stores/activity';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const eventIcons: Record<string, string> = {
  'sniper:created': '✨',
  'sniper:activated': '▶️',
  'sniper:paused': '⏸️',
  'migration:detected': '🔔',
  'migration:matched': '🎯',
  'snipe:started': '🚀',
  'snipe:submitted': '📤',
  'snipe:success': '✅',
  'snipe:failed': '❌',
  'snipe:retrying': '🔄',
  'position:take_profit': '💰',
  'position:stop_loss': '🛑',
  'position:trailing_stop': '📉',
  'position:closed': '🔒',
  'price:update': '💵',
};

const eventColors: Record<string, string> = {
  'snipe:success': 'text-green-400',
  'snipe:failed': 'text-red-400',
  'position:take_profit': 'text-green-400',
  'position:stop_loss': 'text-red-400',
  'position:trailing_stop': 'text-yellow-400',
  'migration:detected': 'text-blue-400',
  'migration:matched': 'text-emerald-400',
};

function formatEventMessage(eventType: string, data: Record<string, unknown>): string {
  switch (eventType) {
    case 'sniper:created':
      return `Sniper "${data.sniperName}" created`;
    case 'sniper:activated':
      return `Sniper "${data.sniperName}" activated`;
    case 'sniper:paused':
      return `Sniper "${data.sniperName}" paused`;
    case 'migration:detected':
      return `Migration detected: $${data.tokenSymbol || (data.tokenMint as string)?.slice(0, 8)}`;
    case 'migration:matched':
      return `Matched sniper "${data.sniperName}" for $${data.tokenSymbol}`;
    case 'snipe:started':
      return `Executing snipe for $${data.tokenSymbol}`;
    case 'snipe:submitted':
      return `Transaction submitted via ${data.path}`;
    case 'snipe:success':
      return `Bought ${(data.tokenAmount as number)?.toLocaleString()} $${data.tokenSymbol}`;
    case 'snipe:failed':
      return `Snipe failed: ${data.error}`;
    case 'snipe:retrying':
      return `Retrying (${data.attempt}/${data.maxAttempts})`;
    case 'position:take_profit':
      return `Take profit triggered for $${data.tokenSymbol}`;
    case 'position:stop_loss':
      return `Stop loss triggered for $${data.tokenSymbol}`;
    case 'position:trailing_stop':
      return `Trailing stop triggered for $${data.tokenSymbol}`;
    case 'position:closed':
      return `Position closed: $${data.tokenSymbol}`;
    case 'price:update':
      return `$${data.tokenSymbol}: ${(data.pnlPct as number)?.toFixed(2)}%`;
    default:
      return eventType;
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function ActivityLog() {
  const entries = useActivityStore((state) => state.entries);

  // Filter out price updates for display (too noisy)
  const displayEntries = entries.filter((e) => e.eventType !== 'price:update');

  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold">Activity Log</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-800">
          {displayEntries.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-8">
              No activity yet. Create a sniper to get started.
            </p>
          ) : (
            displayEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 text-sm py-2 px-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
              >
                <span className="text-base flex-shrink-0">
                  {eventIcons[entry.eventType] || '📋'}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-zinc-300 truncate',
                      eventColors[entry.eventType]
                    )}
                  >
                    {formatEventMessage(entry.eventType, entry.eventData)}
                  </p>
                </div>
                <span className="text-zinc-500 text-xs flex-shrink-0">
                  {formatTime(entry.timestamp)}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
