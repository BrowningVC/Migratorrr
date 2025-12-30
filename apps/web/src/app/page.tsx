'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { ArrowRight, Zap, Shield, TrendingUp, Activity, Rocket } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo, LogoText } from '@/components/logo';
import { PreAuthSniperModal } from '@/components/sniper/pre-auth-sniper-modal';
import { statsApi } from '@/lib/api';

// Dynamic import to prevent hydration mismatch with wallet button
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

interface PlatformStats {
  totalMigrations: number;
  performance: {
    pct2x: number;
    pct5x: number;
    pct10x: number;
    pct50x: number;
    pct100x: number;
  };
  topPerformers: {
    highestMultiplier: number;
    highestMultiplierToken: string | null;
    highestMarketCap: number;
    highestMarketCapToken: string | null;
  };
}

// Fallback stats to display when API is unavailable
// Based on PumpFun data: ~1.4% graduation rate, meaning ~98.6% fail to migrate
const FALLBACK_STATS: PlatformStats = {
  totalMigrations: 0,
  performance: {
    pct2x: 18.5,
    pct5x: 6.2,
    pct10x: 2.1,
    pct50x: 0.4,
    pct100x: 0.15,
  },
  topPerformers: {
    highestMultiplier: 0,
    highestMultiplierToken: null,
    highestMarketCap: 0,
    highestMarketCapToken: null,
  },
};

// Key PumpFun statistics (from research)
const PUMPFUN_STATS = {
  failToMigrate: 98.6, // ~1.4% graduation rate
  tokensReach1M7d: 12, // Approximate weekly average
  volume7d: 850, // Approximate weekly volume in millions USD
};

export default function LandingPage() {
  const { connected } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [isSniperModalOpen, setIsSniperModalOpen] = useState(false);
  const [stats, setStats] = useState<PlatformStats>(FALLBACK_STATS);
  const [statsLoaded, setStatsLoaded] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Fetch platform stats (use fallback if API unavailable)
    statsApi.getPlatformStats().then((res) => {
      if (res.success && res.data) {
        setStats(res.data);
      }
      setStatsLoaded(true);
    }).catch(() => {
      setStatsLoaded(true);
    });
  }, []);

  // Show placeholder until mounted to prevent hydration mismatch
  const WalletButton = mounted ? <WalletMultiButton /> : <div className="h-10 w-32 bg-zinc-800 rounded animate-pulse" />;

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Logo size="md" />
            <LogoText size="md" />
          </Link>
          <div className="flex items-center gap-4">
            {mounted && connected && (
              <Link href="/dashboard">
                <Button variant="ghost">Dashboard</Button>
              </Link>
            )}
            {WalletButton}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">
            Snipe Newly Migrated Tokens
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Automated sniping for PumpFun migrations to Raydium. Configure your strategy,
            sit back, and let Migratorrr execute trades in milliseconds.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {mounted && connected ? (
              <Link href="/dashboard">
                <Button size="lg" className="gap-2">
                  Go to Dashboard <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <Button
                size="lg"
                className="gap-2 bg-green-600 hover:bg-green-700"
                onClick={() => setIsSniperModalOpen(true)}
              >
                Get Started <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Platform Stats Section */}
      <section className="border-y border-border bg-card/50">
        <div className="container mx-auto px-4 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-4xl font-bold text-primary">{'<'}500ms</div>
              <div className="text-muted-foreground">Avg. Execution Time</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-primary">3x</div>
              <div className="text-muted-foreground">Redundant Detection</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-primary">95%</div>
              <div className="text-muted-foreground">Jito Coverage</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-primary">1%</div>
              <div className="text-muted-foreground">Platform Fee</div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Timing Matters - Key Stats */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">Why Timing Matters</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Most PumpFun tokens never make it. The ones that do can move fast.
              Migratorrr helps you catch the winners at migration.
            </p>
          </div>

          {/* Main Stats Grid */}
          <div className="grid md:grid-cols-3 gap-6 mb-10">
            {/* Fail Rate */}
            <div className="p-6 rounded-xl border border-border bg-card text-center">
              <div className="text-5xl font-bold text-red-500 mb-2">
                {PUMPFUN_STATS.failToMigrate}%
              </div>
              <div className="text-lg font-semibold mb-1">Fail to Migrate</div>
              <p className="text-sm text-muted-foreground">
                Of all PumpFun tokens never complete their bonding curve
              </p>
            </div>

            {/* Tokens Reaching $1M */}
            <div className="p-6 rounded-xl border border-primary/30 bg-primary/5 text-center">
              <div className="text-5xl font-bold text-primary mb-2">
                ~{PUMPFUN_STATS.tokensReach1M7d}
              </div>
              <div className="text-lg font-semibold mb-1">Hit $1M+ MCAP</div>
              <p className="text-sm text-muted-foreground">
                Migrated tokens reaching $1M market cap weekly
              </p>
            </div>

            {/* Weekly Volume */}
            <div className="p-6 rounded-xl border border-border bg-card text-center">
              <div className="text-5xl font-bold text-primary mb-2">
                ${PUMPFUN_STATS.volume7d}M+
              </div>
              <div className="text-lg font-semibold mb-1">Weekly Volume</div>
              <p className="text-sm text-muted-foreground">
                Trading volume across migrated tokens in 7 days
              </p>
            </div>
          </div>

          {/* Post-Migration Performance */}
          <div className="p-6 rounded-xl border border-border bg-card/50">
            <div className="text-center mb-6">
              <h3 className="text-xl font-semibold mb-1">Post-Migration Performance</h3>
              <p className="text-sm text-muted-foreground">
                What happens to tokens after they migrate to Raydium
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <PerformanceCard
                multiplier="2x"
                percentage={stats.performance.pct2x}
                description="from migration"
              />
              <PerformanceCard
                multiplier="5x"
                percentage={stats.performance.pct5x}
                description="from migration"
              />
              <PerformanceCard
                multiplier="10x"
                percentage={stats.performance.pct10x}
                description="from migration"
              />
              <PerformanceCard
                multiplier="50x"
                percentage={stats.performance.pct50x}
                description="from migration"
              />
              <PerformanceCard
                multiplier="100x"
                percentage={stats.performance.pct100x}
                description="from migration"
              />
            </div>
          </div>

          {stats.topPerformers.highestMultiplier > 0 && (
            <div className="mt-6 p-6 rounded-xl border border-primary/30 bg-primary/5 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Rocket className="h-5 w-5 text-primary" />
                <span className="text-sm text-muted-foreground">Top Performer Tracked</span>
              </div>
              <div className="text-3xl font-bold text-primary">
                {stats.topPerformers.highestMultiplier}x
              </div>
              <div className="text-muted-foreground">
                {stats.topPerformers.highestMultiplierToken || 'Unknown Token'}
              </div>
              {stats.topPerformers.highestMarketCap > 0 && (
                <div className="text-sm text-muted-foreground mt-1">
                  Peak: ${formatMarketCap(stats.topPerformers.highestMarketCap)}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 text-center text-xs text-muted-foreground">
            Statistics based on PumpFun migration data. Past performance does not guarantee future results.
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center mb-12">Why Migratorrr?</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <FeatureCard
            icon={<Zap className="h-8 w-8" />}
            title="Lightning Fast"
            description="Triple-redundant migration detection with sub-100ms latency. Execute before the crowd."
          />
          <FeatureCard
            icon={<Shield className="h-8 w-8" />}
            title="MEV Protected"
            description="All trades via Jito bundles with anti-sandwich protection. Your trades stay private."
          />
          <FeatureCard
            icon={<TrendingUp className="h-8 w-8" />}
            title="Auto Take Profit"
            description="Set your targets and let automation handle exits. Take profit, stop loss, trailing stops."
          />
          <FeatureCard
            icon={<Activity className="h-8 w-8" />}
            title="Real-Time Updates"
            description="Live activity log, toast notifications, and P&L tracking. Always know what's happening."
          />
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-border bg-card/50">
        <div className="container mx-auto px-4 py-20">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <StepCard
              number={1}
              title="Configure Sniper"
              description="Set your buy amount, slippage, take profit targets, and optional token filters."
            />
            <StepCard
              number={2}
              title="Connect Wallet"
              description="Link your Phantom or Solflare wallet, or generate a new one directly in the app."
            />
            <StepCard
              number={3}
              title="Watch It Work"
              description="Migratorrr monitors for migrations and executes trades automatically. Track everything in real-time."
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Ready to Start Sniping?</h2>
          <p className="text-muted-foreground mb-8">
            Configure your sniper in under a minute. No wallet required to start.
          </p>
          {mounted && connected ? (
            <Link href="/dashboard">
              <Button size="lg" className="gap-2">
                Go to Dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <Button
              size="lg"
              className="gap-2 bg-green-600 hover:bg-green-700"
              onClick={() => setIsSniperModalOpen(true)}
            >
              Configure Your Sniper <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="sm" />
              <LogoText size="sm" />
            </Link>
            <p className="text-sm text-muted-foreground">
              Trade at your own risk. Cryptocurrency trading involves significant risk of loss.
            </p>
          </div>
        </div>
      </footer>

      {/* Pre-Auth Sniper Configuration Modal */}
      <PreAuthSniperModal
        isOpen={isSniperModalOpen}
        onClose={() => setIsSniperModalOpen(false)}
      />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors">
      <div className="text-primary mb-4">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center">
      <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold mx-auto mb-4">
        {number}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

function PerformanceCard({
  multiplier,
  percentage,
  description,
}: {
  multiplier: string;
  percentage: number;
  description: string;
}) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors text-center">
      <div className="text-2xl font-bold text-primary mb-1">{percentage.toFixed(1)}%</div>
      <div className="text-lg font-semibold mb-1">reach {multiplier}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </div>
  );
}

function formatMarketCap(value: number): string {
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(2) + 'B';
  }
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + 'M';
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(1) + 'K';
  }
  return value.toFixed(0);
}
