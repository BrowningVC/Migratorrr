'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Zap, Shield, Target, BarChart3, Copy, Check, ChevronRight, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo, LogoText } from '@/components/logo';
import { PreAuthSniperModal } from '@/components/sniper/pre-auth-sniper-modal';
import { useAuthStore } from '@/lib/stores/auth';
import { cn } from '@/lib/utils';

// Mock migration data for the animation
const MOCK_TOKENS = [
  { symbol: '$PEPE', pnl: '+142%', amount: '0.5 SOL' },
  { symbol: '$DOGE', pnl: '+89%', amount: '0.3 SOL' },
  { symbol: '$BONK', pnl: '+256%', amount: '0.8 SOL' },
  { symbol: '$WIF', pnl: '+67%', amount: '0.2 SOL' },
  { symbol: '$POPCAT', pnl: '+198%', amount: '0.4 SOL' },
  { symbol: '$BOME', pnl: '+312%', amount: '1.0 SOL' },
  { symbol: '$MYRO', pnl: '+45%', amount: '0.6 SOL' },
  { symbol: '$SAMO', pnl: '+178%', amount: '0.35 SOL' },
];

function LiveMigrationFeed() {
  const [migrations, setMigrations] = useState<Array<{
    id: number;
    symbol: string;
    pnl: string;
    amount: string;
    timestamp: string;
    status: 'detected' | 'sniped' | 'profit';
  }>>([]);
  const idCounter = useRef(0);

  useEffect(() => {
    // Add initial migrations
    const initial = MOCK_TOKENS.slice(0, 4).map((token, i) => ({
      id: idCounter.current++,
      ...token,
      timestamp: `${i + 1}s ago`,
      status: 'profit' as const,
    }));
    setMigrations(initial);

    // Add new migrations periodically
    const interval = setInterval(() => {
      const randomToken = MOCK_TOKENS[Math.floor(Math.random() * MOCK_TOKENS.length)];
      const newMigration = {
        id: idCounter.current++,
        ...randomToken,
        pnl: `+${Math.floor(Math.random() * 300) + 50}%`,
        timestamp: 'now',
        status: 'detected' as const,
      };

      setMigrations(prev => {
        const updated = [newMigration, ...prev.slice(0, 5)];
        // Update statuses
        return updated.map((m, i) => ({
          ...m,
          status: i === 0 ? 'detected' : i === 1 ? 'sniped' : 'profit',
          timestamp: i === 0 ? 'now' : `${i * 2}s ago`,
        }));
      });
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full max-w-sm">
      {/* Glowing background */}
      <div className="absolute -inset-4 bg-gradient-to-r from-orange-500/20 via-orange-600/10 to-transparent blur-2xl rounded-3xl" />

      {/* Main container */}
      <div className="relative bg-zinc-950/80 border border-zinc-800/50 rounded-2xl backdrop-blur-xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            <span className="text-xs font-medium text-zinc-400">Live Migrations</span>
          </div>
          <span className="text-[10px] text-zinc-600 font-mono">bondshot.xyz</span>
        </div>

        {/* Migration list */}
        <div className="p-2 space-y-1.5">
          {migrations.map((migration, i) => (
            <div
              key={migration.id}
              className={cn(
                "flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-500",
                i === 0 && "bg-orange-500/10 border border-orange-500/20 animate-pulse",
                i === 1 && "bg-zinc-800/50 border border-zinc-700/50",
                i > 1 && "bg-zinc-900/30"
              )}
              style={{
                opacity: 1 - (i * 0.15),
                transform: `translateY(${i === 0 ? 0 : 0}px)`,
              }}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
                  i === 0 ? "bg-orange-500/20 text-orange-400" : "bg-zinc-800 text-zinc-400"
                )}>
                  {migration.symbol.charAt(1)}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{migration.symbol}</p>
                  <p className="text-[10px] text-zinc-500">{migration.amount} • {migration.timestamp}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={cn(
                  "text-sm font-bold font-mono",
                  i === 0 ? "text-orange-400" : "text-orange-400/70"
                )}>
                  {migration.pnl}
                </p>
                <p className={cn(
                  "text-[10px]",
                  i === 0 ? "text-orange-400/70" : "text-zinc-600"
                )}>
                  {i === 0 ? '⚡ Sniped' : i === 1 ? '✓ Filled' : '$ Profit'}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom stats bar */}
        <div className="px-4 py-2.5 border-t border-zinc-800/50 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-orange-400" />
            <span className="text-xs text-orange-400 font-medium">+2.4 SOL</span>
            <span className="text-[10px] text-zinc-600">today</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500">12 snipes</span>
            <span className="text-[10px] text-zinc-700">•</span>
            <span className="text-[10px] text-zinc-500">83% win</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const BOND_TOKEN_ADDRESS = 'BnbvSDF8zUjWAvkD6eyxbrTNtkRwG4i3oDNRumFRpump';

const STATS = [
  { value: '<50ms', label: 'Detection' },
  { value: 'Jito', label: 'MEV Shield' },
  { value: '24/7', label: 'Automated' },
  { value: '100%', label: 'Non-Custodial' },
];

const FEATURES = [
  {
    icon: Zap,
    title: 'Instant Detection',
    description: 'WebSocket-powered migration detection with triple-redundant monitoring.',
    highlight: true,
  },
  {
    icon: Shield,
    title: 'MEV Protection',
    description: 'All transactions bundled through Jito with anti-sandwich protection.',
  },
  {
    icon: Target,
    title: 'Smart Filters',
    description: 'Filter by volume, holders, dev allocation, socials, and token patterns.',
  },
  {
    icon: BarChart3,
    title: 'Auto Take Profit',
    description: 'Set targets, stop losses, and trailing stops. Automated position management.',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isSniperModalOpen, setIsSniperModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const heroRef = useRef<HTMLDivElement>(null);
  const { isAuthenticated, hasCompletedOnboarding, _hasHydrated: authHydrated } = useAuthStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Subtle mouse follow effect for hero gradient
  useEffect(() => {
    if (!mounted) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!heroRef.current) return;
      const rect = heroRef.current.getBoundingClientRect();
      setMousePosition({
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mounted]);

  const handleDashboardClick = () => {
    if (!authHydrated) {
      setTimeout(() => {
        const state = useAuthStore.getState();
        if (state._hasHydrated && state.isAuthenticated && state.hasCompletedOnboarding) {
          router.push('/dashboard');
        } else {
          setIsSniperModalOpen(true);
        }
      }, 100);
      return;
    }

    if (isAuthenticated && hasCompletedOnboarding) {
      router.push('/dashboard');
    } else {
      setIsSniperModalOpen(true);
    }
  };

  const handleCopyCA = () => {
    navigator.clipboard.writeText(BOND_TOKEN_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {/* Floating Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between rounded-2xl border border-zinc-800/50 bg-zinc-950/80 backdrop-blur-xl px-6 py-3">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="sm" />
              <LogoText size="sm" />
            </Link>

            <div className="hidden md:flex items-center gap-1">
              <Link href="/how-it-works">
                <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white text-sm">
                  How it Works
                </Button>
              </Link>
              <Link href="/buybacks">
                <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white text-sm">
                  $BOND
                </Button>
              </Link>
              <a
                href="https://x.com/bondshotxyz"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-zinc-400 hover:text-white text-sm transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>

            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-black font-semibold px-4"
              onClick={handleDashboardClick}
            >
              Launch App
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section
        ref={heroRef}
        className="relative min-h-screen flex items-center justify-center pt-24"
      >
        {/* Dynamic gradient background */}
        <div
          className="absolute inset-0 transition-all duration-1000 ease-out"
          style={{
            background: `
              radial-gradient(
                ellipse 80% 50% at ${mousePosition.x}% ${mousePosition.y}%,
                rgba(249, 115, 22, 0.15) 0%,
                transparent 50%
              ),
              radial-gradient(
                ellipse 60% 40% at 20% 80%,
                rgba(251, 146, 60, 0.08) 0%,
                transparent 50%
              ),
              linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 100%)
            `,
          }}
        />

        {/* Subtle grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

        <div className="relative z-10 max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Left side - Text content */}
            <div className="flex-1 text-center lg:text-left">
              {/* Main headline */}
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
                <span className="block text-white">Profit From Every</span>
                <span className="block bg-gradient-to-r from-orange-400 via-orange-500 to-amber-500 bg-clip-text text-transparent">
                  Migration
                </span>
              </h1>

              {/* Subheadline */}
              <p className="text-lg md:text-xl text-zinc-400 max-w-xl mb-10 leading-relaxed">
                Automated sniping on PumpFun Migrations.
                Sub-50ms detection, MEV protection, and intelligent position management.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row items-center lg:items-start gap-4 mb-12">
                <Button
                  size="lg"
                  className="h-14 px-8 bg-orange-500 hover:bg-orange-600 text-black font-semibold text-lg gap-2 rounded-xl"
                  onClick={() => setIsSniperModalOpen(true)}
                >
                  Start Sniping
                  <ArrowRight className="w-5 h-5" />
                </Button>
                <Link href="/how-it-works">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-14 px-8 border-zinc-700 hover:bg-zinc-900 text-white font-medium text-lg rounded-xl"
                  >
                    Learn More
                  </Button>
                </Link>
              </div>

              {/* Stats Bar */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-8">
                {STATS.map((stat, i) => (
                  <div key={i} className="text-center lg:text-left">
                    <div className="text-2xl font-bold text-white font-mono">
                      {stat.value}
                    </div>
                    <div className="text-xs text-zinc-500 uppercase tracking-wider mt-1">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right side - Live animation */}
            <div className="flex-shrink-0 hidden lg:block">
              <LiveMigrationFeed />
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-zinc-600">
          <span className="text-xs uppercase tracking-widest">Scroll</span>
          <div className="w-px h-8 bg-gradient-to-b from-zinc-600 to-transparent" />
        </div>
      </section>

      {/* Features Section - Bento Grid */}
      <section className="relative py-32 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Built for <span className="text-orange-500">Speed</span>
            </h2>
            <p className="text-zinc-400 text-lg max-w-xl mx-auto">
              Every millisecond counts. Our infrastructure is optimized for one thing: getting you in first.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FEATURES.map((feature, i) => (
              <div
                key={i}
                className={cn(
                  "group relative p-8 rounded-2xl border transition-all duration-300",
                  feature.highlight
                    ? "border-orange-500/30 bg-gradient-to-br from-orange-500/10 to-transparent hover:border-orange-500/50"
                    : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/50"
                )}
              >
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center mb-5",
                  feature.highlight ? "bg-orange-500/20" : "bg-zinc-800"
                )}>
                  <feature.icon className={cn(
                    "w-6 h-6",
                    feature.highlight ? "text-orange-400" : "text-zinc-400"
                  )} />
                </div>
                <h3 className="text-xl font-semibold mb-2 text-white">{feature.title}</h3>
                <p className="text-zinc-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works - Minimal */}
      <section className="py-32 px-6 border-t border-zinc-900">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Three Steps to <span className="text-orange-500">Automate</span>
            </h2>
          </div>

          <div className="space-y-0">
            {[
              { num: '01', title: 'Configure', desc: 'Set buy amount, slippage, TP/SL, and optional filters' },
              { num: '02', title: 'Fund', desc: 'Deposit SOL to your generated trading wallet' },
              { num: '03', title: 'Automate', desc: 'Sniper runs 24/7 catching every migration that matches' },
            ].map((step, i) => (
              <div
                key={i}
                className="flex items-center gap-8 py-8 border-b border-zinc-900 last:border-0 group"
              >
                <span className="text-5xl font-bold text-zinc-800 group-hover:text-orange-500/30 transition-colors font-mono">
                  {step.num}
                </span>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-white mb-1">{step.title}</h3>
                  <p className="text-zinc-500">{step.desc}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-orange-500 transition-colors" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Token Section */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="relative p-8 md:p-12 rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900/50 to-zinc-950">
            <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl" />

            <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 mb-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  <span className="text-sm text-orange-400 font-medium">$BOND</span>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold mb-2">Platform Token</h3>
                <p className="text-zinc-400 max-w-md">
                  50% of platform fees buy back and burn $BOND.
                  Hold for reduced fees and exclusive features.
                </p>
              </div>

              <div className="flex-shrink-0">
                <button
                  onClick={handleCopyCA}
                  className="flex items-center gap-3 px-5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors group"
                >
                  <code className="text-sm text-zinc-300 font-mono">
                    {BOND_TOKEN_ADDRESS.slice(0, 6)}...{BOND_TOKEN_ADDRESS.slice(-6)}
                  </code>
                  {copied ? (
                    <Check className="w-4 h-4 text-orange-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-32 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Ready to <span className="text-orange-500">Snipe</span>?
          </h2>
          <p className="text-zinc-400 text-lg mb-10">
            Deploy your first sniper in under 60 seconds. No wallet connection required to start.
          </p>
          <Button
            size="lg"
            className="h-14 px-10 bg-orange-500 hover:bg-orange-600 text-black font-semibold text-lg gap-2 rounded-xl"
            onClick={() => setIsSniperModalOpen(true)}
          >
            Deploy Sniper
            <ArrowRight className="w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Logo size="sm" />
            <LogoText size="sm" />
          </div>

          <div className="flex items-center gap-6 text-sm text-zinc-500">
            <Link href="/dashboard" className="hover:text-white transition-colors">
              Dashboard
            </Link>
            <Link href="/how-it-works" className="hover:text-white transition-colors">
              How it Works
            </Link>
            <Link href="/buybacks" className="hover:text-white transition-colors">
              Buybacks
            </Link>
            <a
              href="https://x.com/bondshotxyz"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Twitter
            </a>
          </div>

          <p className="text-xs text-zinc-600">
            Trade at your own risk
          </p>
        </div>
      </footer>

      {/* Sniper Modal */}
      <PreAuthSniperModal
        isOpen={isSniperModalOpen}
        onClose={() => setIsSniperModalOpen(false)}
      />
    </div>
  );
}
