'use client';

import { useEffect, useState } from 'react';
import { Trophy, TrendingUp, Calendar, ExternalLink } from 'lucide-react';
import { statsApi } from '@/lib/api';

interface TopPerformer {
  tokenSymbol: string;
  tokenName: string | null;
  tokenMint: string;
  multiplier: number;
  highestMarketCap: number | null;
  reached10x: boolean;
  reached100x: boolean;
  migrationDate: string;
}

// Generate dates within the last 30 days for fallback data
function getRecentDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

// Fallback data to show when API is unavailable (recent 30-day examples)
const FALLBACK_PERFORMERS: TopPerformer[] = [
  { tokenSymbol: 'STONKS', tokenName: 'Stonks Only Go Up', tokenMint: '7xKXt...pump', multiplier: 156, highestMarketCap: 45000000, reached10x: true, reached100x: true, migrationDate: getRecentDate(3) },
  { tokenSymbol: 'DOGE2', tokenName: 'Doge 2.0', tokenMint: 'CzLSu...pump', multiplier: 89, highestMarketCap: 28000000, reached10x: true, reached100x: false, migrationDate: getRecentDate(5) },
  { tokenSymbol: 'MOON', tokenName: 'To The Moon', tokenMint: 'A8C3x...pump', multiplier: 67, highestMarketCap: 18500000, reached10x: true, reached100x: false, migrationDate: getRecentDate(8) },
  { tokenSymbol: 'PEPE3', tokenName: 'Pepe Season 3', tokenMint: 'ED5nf...pump', multiplier: 54, highestMarketCap: 15200000, reached10x: true, reached100x: false, migrationDate: getRecentDate(12) },
  { tokenSymbol: 'WOJAK', tokenName: 'Wojak Finance', tokenMint: 'Df6yf...pump', multiplier: 43, highestMarketCap: 12800000, reached10x: true, reached100x: false, migrationDate: getRecentDate(15) },
  { tokenSymbol: 'SMOL', tokenName: 'Smol Brain', tokenMint: '7GCih...pump', multiplier: 38, highestMarketCap: 9500000, reached10x: true, reached100x: false, migrationDate: getRecentDate(18) },
  { tokenSymbol: 'RUGG', tokenName: 'Anti Rug', tokenMint: '63LfD...pump', multiplier: 31, highestMarketCap: 7200000, reached10x: true, reached100x: false, migrationDate: getRecentDate(21) },
  { tokenSymbol: 'FOMO', tokenName: 'FOMO Token', tokenMint: 'BDLi2...pump', multiplier: 26, highestMarketCap: 5800000, reached10x: true, reached100x: false, migrationDate: getRecentDate(24) },
  { tokenSymbol: 'BASED', tokenName: 'Based Chad', tokenMint: 'EKpQG...pump', multiplier: 19, highestMarketCap: 4200000, reached10x: true, reached100x: false, migrationDate: getRecentDate(27) },
  { tokenSymbol: 'NGMI', tokenName: 'Not Gonna Make It', tokenMint: 'DezXA...pump', multiplier: 14, highestMarketCap: 2800000, reached10x: true, reached100x: false, migrationDate: getRecentDate(29) },
];

function formatMarketCap(value: number): string {
  if (value >= 1_000_000_000) {
    return '$' + (value / 1_000_000_000).toFixed(2) + 'B';
  }
  if (value >= 1_000_000) {
    return '$' + (value / 1_000_000).toFixed(1) + 'M';
  }
  if (value >= 1_000) {
    return '$' + (value / 1_000).toFixed(0) + 'K';
  }
  return '$' + value.toFixed(0);
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getMultiplierColor(multiplier: number): string {
  if (multiplier >= 1000) return 'text-yellow-400';
  if (multiplier >= 100) return 'text-orange-400';
  if (multiplier >= 10) return 'text-emerald-400';
  return 'text-primary';
}

function getRankBadge(rank: number): React.ReactNode {
  if (rank === 1) {
    return (
      <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center">
        <Trophy className="w-3.5 h-3.5 text-yellow-400" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="w-6 h-6 rounded-full bg-zinc-400/20 flex items-center justify-center">
        <span className="text-xs font-bold text-zinc-300">2</span>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="w-6 h-6 rounded-full bg-orange-600/20 flex items-center justify-center">
        <span className="text-xs font-bold text-orange-400">3</span>
      </div>
    );
  }
  return (
    <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center">
      <span className="text-xs font-medium text-zinc-500">{rank}</span>
    </div>
  );
}

export function TopPerformers() {
  const [performers, setPerformers] = useState<TopPerformer[]>(FALLBACK_PERFORMERS);
  const [isLoading, setIsLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    statsApi.getTopPerformers().then((res) => {
      if (res.success && res.data && res.data.length > 0) {
        setPerformers(res.data);
        setUsingFallback(false);
      } else {
        setUsingFallback(true);
      }
      setIsLoading(false);
    }).catch(() => {
      setUsingFallback(true);
      setIsLoading(false);
    });
  }, []);

  return (
    <section className="container mx-auto px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <TrendingUp className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold">Top Performers — Last 30 Days</h2>
          </div>
          <p className="text-muted-foreground text-sm">
            Best performing tokens that migrated from PumpFun to Raydium in the last month
            {usingFallback && ' (example data)'}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr] md:grid-cols-[auto_1.5fr_1fr_1fr_1fr] gap-4 px-4 py-3 bg-muted/30 border-b border-border text-sm font-medium text-muted-foreground">
            <div className="w-6">#</div>
            <div>Token</div>
            <div className="text-right">ATH MCAP</div>
            <div className="text-right">Multiplier</div>
            <div className="text-right hidden sm:block">Migration Date</div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-border">
            {isLoading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[auto_1fr_1fr_1fr_1fr] md:grid-cols-[auto_1.5fr_1fr_1fr_1fr] gap-4 px-4 py-3 items-center">
                  <div className="w-6 h-6 rounded-full bg-zinc-800 animate-pulse" />
                  <div className="h-5 bg-zinc-800 rounded animate-pulse w-24" />
                  <div className="h-5 bg-zinc-800 rounded animate-pulse w-16 ml-auto" />
                  <div className="h-5 bg-zinc-800 rounded animate-pulse w-14 ml-auto" />
                  <div className="h-5 bg-zinc-800 rounded animate-pulse w-20 ml-auto hidden sm:block" />
                </div>
              ))
            ) : (
              performers.map((performer, index) => (
                <div
                  key={performer.tokenMint}
                  className="grid grid-cols-[auto_1fr_1fr_1fr_1fr] md:grid-cols-[auto_1.5fr_1fr_1fr_1fr] gap-4 px-4 py-3 items-center hover:bg-muted/20 transition-colors"
                >
                  {/* Rank */}
                  {getRankBadge(index + 1)}

                  {/* Token */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/60 to-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                      {performer.tokenSymbol.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold truncate">${performer.tokenSymbol}</span>
                        {performer.reached100x && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/20 text-yellow-400 rounded">
                            100x+
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {performer.tokenName || performer.tokenMint}
                      </p>
                    </div>
                  </div>

                  {/* ATH Market Cap */}
                  <div className="text-right">
                    <span className="font-medium">
                      {performer.highestMarketCap
                        ? formatMarketCap(performer.highestMarketCap)
                        : '—'}
                    </span>
                  </div>

                  {/* Multiplier */}
                  <div className="text-right">
                    <span className={`font-bold ${getMultiplierColor(performer.multiplier)}`}>
                      {performer.multiplier >= 1000
                        ? `${(performer.multiplier / 1000).toFixed(1)}K`
                        : performer.multiplier.toFixed(0)}x
                    </span>
                  </div>

                  {/* Migration Date */}
                  <div className="text-right hidden sm:flex items-center justify-end gap-1.5 text-sm text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDate(performer.migrationDate)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Data based on tracked PumpFun migrations. Past performance does not guarantee future results.
        </p>
      </div>
    </section>
  );
}
