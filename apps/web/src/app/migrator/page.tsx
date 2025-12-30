'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Logo, LogoText } from '@/components/logo';
import { Coins } from 'lucide-react';

// Dynamic import to prevent hydration mismatch with wallet button
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

export default function MigratorPage() {
  const { connected } = useWallet();
  const { hasCompletedOnboarding } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Logo size="md" />
                <LogoText size="md" />
              </Link>
              <span className="px-2 py-1 bg-green-900/30 text-green-400 text-xs rounded">
                Beta
              </span>
            </div>
            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1">
              <Link href="/dashboard">
                <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
                  Dashboard
                </Button>
              </Link>
              <Link href="/migrator">
                <Button variant="ghost" size="sm" className="text-green-400 bg-green-900/20">
                  $MIGRATOR
                </Button>
              </Link>
              <Link href="/how-it-works">
                <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
                  How it Works
                </Button>
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {connected && hasCompletedOnboarding && (
              <Link href="/dashboard">
                <Button variant="outline" size="sm">
                  Go to Dashboard
                </Button>
              </Link>
            )}
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center space-y-8">
          {/* Hero */}
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-700/50 rounded-full">
              <Coins className="w-5 h-5 text-green-400" />
              <span className="text-green-400 font-semibold">$MIGRATOR Token</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold">
              Coming Soon
            </h1>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
              The native token powering the Migratorrr ecosystem.
              Stake, earn rewards, and unlock premium features.
            </p>
          </div>

          {/* CTA */}
          <div className="mt-12 p-8 bg-zinc-900/30 border border-zinc-800 rounded-2xl">
            <h2 className="text-2xl font-bold mb-2">Stay Updated</h2>
            <p className="text-zinc-400 mb-6">
              Follow us on Twitter for token launch announcements and early access opportunities.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="lg"
                onClick={() => window.open('https://twitter.com/migratorrr', '_blank')}
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Follow @migratorrr
              </Button>
              <Link href="/dashboard">
                <Button size="lg" className="bg-green-600 hover:bg-green-700">
                  Start Sniping Now
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-16">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="sm" />
              <LogoText size="sm" />
            </Link>
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-white transition-colors">
                Dashboard
              </Link>
              <Link href="/migrator" className="text-sm text-zinc-500 hover:text-white transition-colors">
                $MIGRATOR
              </Link>
              <Link href="/how-it-works" className="text-sm text-zinc-500 hover:text-white transition-colors">
                How it Works
              </Link>
            </div>
            <p className="text-sm text-zinc-500">
              Trade at your own risk. Cryptocurrency trading involves significant risk of loss.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
