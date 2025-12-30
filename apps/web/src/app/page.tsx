'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { ArrowRight, Zap, Shield, TrendingUp, Activity } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';

// Dynamic import to prevent hydration mismatch with wallet button
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

export default function LandingPage() {
  const { connected } = useWallet();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Show placeholder until mounted to prevent hydration mismatch
  const WalletButton = mounted ? <WalletMultiButton /> : <div className="h-10 w-32 bg-zinc-800 rounded animate-pulse" />;

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size="md" />
            <span className="text-2xl font-bold">Migratorrr</span>
          </div>
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
              WalletButton
            )}
          </div>
        </div>
      </section>

      {/* Stats Section */}
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
              title="Connect Wallet"
              description="Link your Phantom or Solflare wallet, or generate a new one directly in the app."
            />
            <StepCard
              number={2}
              title="Configure Sniper"
              description="Set your buy amount, slippage, take profit targets, and optional token filters."
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
            Connect your wallet and set up your first sniper in minutes.
          </p>
          {mounted && connected ? (
            <Link href="/onboarding">
              <Button size="lg" className="gap-2">
                Set Up Your Sniper <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          ) : (
            WalletButton
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Logo size="sm" />
              <span className="font-bold">Migratorrr</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Trade at your own risk. Cryptocurrency trading involves significant risk of loss.
            </p>
          </div>
        </div>
      </footer>
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
