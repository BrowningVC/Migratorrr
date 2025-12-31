'use client';

import { useMemo, memo, useState, useEffect, useRef } from 'react';
import { useActivityStore, ActivityEntry } from '@/lib/stores/activity';
import { useMigrationsStore, Migration } from '@/lib/stores/migrations';
import { useAuthStore } from '@/lib/stores/auth';
import { sniperApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Check, X, Copy, ExternalLink, Radio } from 'lucide-react';
import toast from 'react-hot-toast';

type TabType = 'activity' | 'migrations';

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

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);

  if (diffSecs < 60) {
    return `${diffSecs}s ago`;
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Memoized activity entry row to prevent re-renders
const ActivityRow = memo(function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="flex items-start gap-3 text-sm py-2 px-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors">
      <span className="text-base flex-shrink-0">
        {eventIcons[entry.eventType] || '📋'}
      </span>
      <div className="flex-1 min-w-0">
        <p className={cn('text-zinc-300 truncate', eventColors[entry.eventType])}>
          {formatEventMessage(entry.eventType, entry.eventData)}
        </p>
      </div>
      <span className="text-zinc-500 text-xs flex-shrink-0">
        {formatTime(entry.timestamp)}
      </span>
    </div>
  );
});

// Simplified migration row component - shows ticker, time ago, and sniped status
const MigrationRow = memo(function MigrationRow({
  migration,
  isNew,
  copiedId,
  onCopy
}: {
  migration: Migration;
  isNew?: boolean;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg transition-all',
        isNew ? 'bg-green-900/20' : 'bg-zinc-800/50 hover:bg-zinc-800'
      )}
    >
      {/* Ticker with copy + Solscan */}
      <div className="flex items-center gap-2 min-w-0">
        {isNew && (
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse flex-shrink-0" title="New" />
        )}
        <code className="text-sm font-medium text-zinc-200 truncate">
          ${migration.tokenSymbol || migration.tokenMint.slice(0, 6)}
        </code>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => onCopy(migration.tokenMint, `token-${migration.id}`)}
            className="p-1 hover:bg-zinc-700 rounded transition-colors"
            title="Copy token address"
          >
            {copiedId === `token-${migration.id}` ? (
              <Check className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
            )}
          </button>
          <a
            href={`https://solscan.io/token/${migration.tokenMint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-zinc-700 rounded transition-colors"
            title="View on Solscan"
          >
            <ExternalLink className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
          </a>
        </div>
      </div>

      {/* Time ago + Sniped status */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-zinc-500">
          {formatRelativeTime(migration.timestamp)}
        </span>
        {migration.sniped ? (
          migration.snipeSuccess ? (
            <div className="w-5 h-5 rounded-full bg-green-900/50 flex items-center justify-center" title="Sniped successfully">
              <Check className="w-3 h-3 text-green-400" />
            </div>
          ) : migration.snipeSuccess === false ? (
            <div className="w-5 h-5 rounded-full bg-red-900/50 flex items-center justify-center" title={migration.snipeError || 'Failed'}>
              <X className="w-3 h-3 text-red-400" />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full bg-yellow-900/50 flex items-center justify-center animate-pulse" title="In progress">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
            </div>
          )
        ) : (
          <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center" title="Not sniped">
            <span className="text-zinc-600 text-xs">—</span>
          </div>
        )}
      </div>
    </div>
  );
});

export function ActivityLog() {
  const [activeTab, setActiveTab] = useState<TabType>('migrations');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newMigrationIds, setNewMigrationIds] = useState<Set<string>>(new Set());
  const hasFetchedActivity = useRef(false);

  const token = useAuthStore((state) => state.token);
  const entries = useActivityStore((state) => state.entries);
  const mergeEntries = useActivityStore((state) => state.mergeEntries);
  const activityHydrated = useActivityStore((state) => state._hasHydrated);
  const migrations = useMigrationsStore((state) => state.migrations);
  const clearMigrations = useMigrationsStore((state) => state.clearMigrations);
  const migrationsHydrated = useMigrationsStore((state) => state._hasHydrated);

  // Fetch historical activity from API on mount (once)
  useEffect(() => {
    if (!activityHydrated || !token || hasFetchedActivity.current) return;
    hasFetchedActivity.current = true;

    sniperApi.getActivity(token, 50)
      .then((res) => {
        if (res.success && res.data) {
          mergeEntries(res.data);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch activity:', err);
      });
  }, [activityHydrated, token, mergeEntries]);

  // Clear migrations on mount - only show migrations from "right now onwards"
  useEffect(() => {
    if (migrationsHydrated) {
      clearMigrations();
    }
  }, [migrationsHydrated, clearMigrations]);

  // Track new migrations for highlighting
  useEffect(() => {
    if (migrations.length > 0) {
      const latestId = migrations[0]?.id;
      if (latestId && !newMigrationIds.has(latestId)) {
        setNewMigrationIds((prev) => new Set([latestId, ...Array.from(prev)]));
        // Remove highlight after 10 seconds
        setTimeout(() => {
          setNewMigrationIds((prev) => {
            const next = new Set(Array.from(prev));
            next.delete(latestId);
            return next;
          });
        }, 10000);
      }
    }
  }, [migrations, newMigrationIds]);

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('Copied!');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Memoize filtered entries to prevent recalculation
  // Filter out migration:detected since those are shown in migrations tab
  const displayEntries = useMemo(
    () => entries.filter((e) => e.eventType !== 'price:update' && e.eventType !== 'migration:detected'),
    [entries]
  );

  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Radio className="w-5 h-5 text-green-400" />
          Activity Log
        </CardTitle>
        {/* Tabs */}
        <div className="flex gap-1 mt-2">
          <button
            onClick={() => setActiveTab('migrations')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'migrations'
                ? 'bg-green-900/30 text-green-400 border border-green-700/50'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            )}
          >
            PumpFun Migrations
            {migrations.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-zinc-700 rounded-full text-[10px]">
                {migrations.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'activity'
                ? 'bg-green-900/30 text-green-400 border border-green-700/50'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            )}
          >
            Sniper Activity
            {displayEntries.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-zinc-700 rounded-full text-[10px]">
                {displayEntries.length}
              </span>
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-800">
          {activeTab === 'activity' ? (
            // Sniper Activity Tab
            displayEntries.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-zinc-500 text-sm">
                  No sniper activity yet.
                </p>
                <p className="text-zinc-600 text-xs mt-1">
                  Transactions will appear here when your snipers execute trades.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {displayEntries.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} />
                ))}
              </div>
            )
          ) : (
            // Live Migrations Tab - Simple list showing ticker, time ago, sniped status
            migrations.length === 0 ? (
              <div className="text-center py-8">
                <Radio className="w-8 h-8 mx-auto mb-3 opacity-50 text-zinc-500" />
                <p className="text-zinc-500 text-sm">
                  No PumpFun migrations yet.
                </p>
                <p className="text-zinc-600 text-xs mt-1">
                  Migrations will appear here in real-time.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {migrations.map((migration) => (
                  <MigrationRow
                    key={migration.id}
                    migration={migration}
                    isNew={newMigrationIds.has(migration.id)}
                    copiedId={copiedId}
                    onCopy={copyToClipboard}
                  />
                ))}
              </div>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}
