'use client';

import { useMemo, memo, useState, useEffect, useRef, useCallback } from 'react';
import { useActivityStore, ActivityEntry } from '@/lib/stores/activity';
import { useMigrationsStore, Migration } from '@/lib/stores/migrations';
import { useAuthStore } from '@/lib/stores/auth';
import { sniperApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Check, X, Copy, ExternalLink, Radio, Crosshair } from 'lucide-react';
import toast from 'react-hot-toast';

type TabType = 'activity' | 'migrations';

// Cache for fetched token metadata to avoid duplicate requests
const fetchedTokensCache = new Set<string>();
const pendingFetches = new Set<string>();

// Fetch token metadata from DexScreener (client-side)
async function fetchTokenMetadata(tokenMint: string): Promise<{ symbol: string; name: string } | null> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0];
      const tokenInfo = pair.baseToken?.address === tokenMint ? pair.baseToken : pair.quoteToken;
      if (tokenInfo?.symbol) {
        return { symbol: tokenInfo.symbol, name: tokenInfo.name || '' };
      }
    }
    return null;
  } catch {
    return null;
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

// Cache for trade entry token symbols (persists across re-renders)
const tradeTokenSymbolCache = new Map<string, string>();

// Trade activity row - clean format: "Sniper Name" (Bought/Sold) "$TOKEN" (time)
const TradeRow = memo(function TradeRow({ entry }: { entry: ActivityEntry }) {
  const data = entry.eventData;
  const sniperName = (data.sniperName as string) || 'Sniper';
  const tokenMint = data.tokenMint as string;
  const rawSymbol = data.tokenSymbol as string;

  // Check if the tokenSymbol looks like a real symbol (not a truncated address)
  // Real symbols are typically short (< 10 chars) and don't look like base58 addresses
  const looksLikeAddress = rawSymbol && /^[A-HJ-NP-Za-km-z1-9]{6,8}$/.test(rawSymbol);
  const isRealSymbol = rawSymbol && rawSymbol.length <= 10 && !looksLikeAddress;

  // State to track fetched symbol
  const [fetchedSymbol, setFetchedSymbol] = useState<string | null>(
    tokenMint ? tradeTokenSymbolCache.get(tokenMint) || null : null
  );

  // Determine the best symbol to display
  const tokenSymbol = fetchedSymbol || (isRealSymbol ? rawSymbol : null) || rawSymbol || tokenMint?.slice(0, 6) || '???';

  // Fetch symbol from DexScreener if we don't have a real one
  useEffect(() => {
    if (!tokenMint || isRealSymbol || fetchedSymbol) return;
    if (tradeTokenSymbolCache.has(tokenMint)) {
      setFetchedSymbol(tradeTokenSymbolCache.get(tokenMint)!);
      return;
    }
    if (pendingFetches.has(tokenMint) || fetchedTokensCache.has(tokenMint)) return;

    pendingFetches.add(tokenMint);
    fetchTokenMetadata(tokenMint)
      .then((metadata) => {
        pendingFetches.delete(tokenMint);
        fetchedTokensCache.add(tokenMint);
        if (metadata?.symbol) {
          tradeTokenSymbolCache.set(tokenMint, metadata.symbol);
          setFetchedSymbol(metadata.symbol);
        }
      })
      .catch(() => {
        pendingFetches.delete(tokenMint);
        fetchedTokensCache.add(tokenMint);
      });
  }, [tokenMint, isRealSymbol, fetchedSymbol]);

  // Determine if this is a buy or sell, and get specific action label
  const isBuy = entry.eventType === 'snipe:success';

  // Map event types to user-friendly actions
  const getAction = () => {
    switch (entry.eventType) {
      case 'snipe:success':
        return { label: 'Bought', color: 'text-green-400' };
      case 'position:take_profit':
        return { label: 'TP Hit', color: 'text-green-400' };
      case 'position:stop_loss':
        return { label: 'SL Hit', color: 'text-red-400' };
      case 'position:trailing_stop':
        return { label: 'TS Hit', color: 'text-orange-400' };
      case 'position:manual_sell':
        return { label: 'Manual Sell', color: 'text-blue-400' };
      case 'position:closed':
      case 'position:sell':
        return { label: 'Sold', color: 'text-red-400' };
      default:
        return { label: 'Trade', color: 'text-zinc-400' };
    }
  };

  const { label: action, color: actionColor } = getAction();

  return (
    <div className="flex items-center gap-3 text-sm py-2.5 px-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors">
      {/* Sniper icon */}
      <Crosshair className={cn('w-4 h-4 flex-shrink-0', actionColor)} />

      {/* Content */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-zinc-200 font-medium truncate">{sniperName}</span>
        <span className={cn('font-medium', actionColor)}>{action}</span>
        <span className="text-zinc-300">${tokenSymbol}</span>
      </div>

      {/* Time */}
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
          {migration.tokenSymbol
            ? `$${migration.tokenSymbol.replace(/^\$/, '')}`
            : `${migration.tokenMint.slice(0, 8)}...`}
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
            href={`https://dexscreener.com/solana/${migration.tokenMint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-zinc-700 rounded transition-colors group/dex"
            title="View on DexScreener"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-zinc-500 group-hover/dex:stroke-zinc-300">
              <path d="M3 3v18h18"/>
              <path d="m19 9-5 5-4-4-3 3"/>
            </svg>
          </a>
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
  const [hasFetchedActivity, setHasFetchedActivity] = useState(false);

  const token = useAuthStore((state) => state.token);
  const entries = useActivityStore((state) => state.entries);
  const mergeEntries = useActivityStore((state) => state.mergeEntries);
  const activityHydrated = useActivityStore((state) => state._hasHydrated);
  const migrations = useMigrationsStore((state) => state.migrations);
  const updateMigrationMetadata = useMigrationsStore((state) => state.updateMigrationMetadata);
  const migrationsHydrated = useMigrationsStore((state) => state._hasHydrated);

  // Fetch missing token symbols from DexScreener (client-side)
  useEffect(() => {
    if (!migrationsHydrated) return;

    // Find migrations without symbols that we haven't tried to fetch yet
    const migrationsNeedingSymbols = migrations.filter(
      (m) => !m.tokenSymbol && !fetchedTokensCache.has(m.tokenMint) && !pendingFetches.has(m.tokenMint)
    );

    // Limit concurrent fetches to avoid rate limiting
    const toFetch = migrationsNeedingSymbols.slice(0, 5);

    toFetch.forEach((migration) => {
      pendingFetches.add(migration.tokenMint);

      fetchTokenMetadata(migration.tokenMint)
        .then((metadata) => {
          pendingFetches.delete(migration.tokenMint);
          fetchedTokensCache.add(migration.tokenMint);

          if (metadata?.symbol) {
            updateMigrationMetadata(migration.tokenMint, {
              tokenSymbol: metadata.symbol,
              tokenName: metadata.name,
            });
          }
        })
        .catch(() => {
          pendingFetches.delete(migration.tokenMint);
          fetchedTokensCache.add(migration.tokenMint);
        });
    });
  }, [migrations, migrationsHydrated, updateMigrationMetadata]);

  // Fetch historical activity from API on mount (once per session)
  useEffect(() => {
    if (!activityHydrated || !token || hasFetchedActivity) return;
    setHasFetchedActivity(true);

    sniperApi.getActivity(token, 50)
      .then((res) => {
        if (res.success && res.data && Array.isArray(res.data)) {
          mergeEntries(res.data);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch activity:', err);
      });
  }, [activityHydrated, token, mergeEntries, hasFetchedActivity]);

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

  // Only show actual trades (buys and sells) in the activity tab
  // Exclude position:closed entirely since we show the specific events instead
  // (position:take_profit, position:stop_loss, position:trailing_stop, position:manual_sell)
  const tradeEntries = useMemo(() => {
    return entries.filter((e) =>
      e.eventType === 'snipe:success' ||
      e.eventType === 'position:take_profit' ||
      e.eventType === 'position:stop_loss' ||
      e.eventType === 'position:trailing_stop' ||
      e.eventType === 'position:manual_sell' ||
      e.eventType === 'position:sell'
    );
  }, [entries]);

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
            Trades
            {tradeEntries.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-zinc-700 rounded-full text-[10px]">
                {tradeEntries.length}
              </span>
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-800">
          {activeTab === 'activity' ? (
            // Trades Tab - Only shows buys and sells
            tradeEntries.length === 0 ? (
              <div className="text-center py-8">
                <Crosshair className="w-8 h-8 mx-auto mb-3 opacity-50 text-zinc-500" />
                <p className="text-zinc-500 text-sm">
                  No trades yet.
                </p>
                <p className="text-zinc-600 text-xs mt-1">
                  Buys and sells will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {tradeEntries.map((entry) => (
                  <TradeRow key={entry.id} entry={entry} />
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
