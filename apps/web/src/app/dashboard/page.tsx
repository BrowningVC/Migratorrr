'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { useSocket } from '@/lib/hooks/useSocket';
import { useAuthStore } from '@/lib/stores/auth';
import { useWalletsStore } from '@/lib/stores/wallets';
import { usePositionsStore } from '@/lib/stores/positions';
import { useSnipersStore } from '@/lib/stores/snipers';
import { sniperApi, positionApi, walletApi } from '@/lib/api';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { ActivityLog } from '@/components/dashboard/activity-log';
import { PositionCard } from '@/components/dashboard/position-card';
import { SniperCard } from '@/components/dashboard/sniper-card';
import { WalletBalanceCard } from '@/components/dashboard/wallet-balance-card';
import { CreateSniperModal } from '@/components/sniper/create-sniper-modal';
import { DashboardSkeleton } from '@/components/dashboard/loading-skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/logo';
import toast from 'react-hot-toast';

// Dynamic import to prevent hydration mismatch with wallet button
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

export default function DashboardPage() {
  const router = useRouter();
  const { publicKey, connected } = useWallet();
  const { token, isAuthenticated, hasCompletedOnboarding } = useAuthStore();
  const { setWallets } = useWalletsStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize socket connection
  useSocket(token);

  // Stores
  const positions = usePositionsStore((state) => state.positions);
  const snipers = useSnipersStore((state) => state.snipers);
  const setSnipers = useSnipersStore((state) => state.setSnipers);
  const setPositions = usePositionsStore((state) => state.setPositions);
  const toggleSniper = useSnipersStore((state) => state.toggleSniper);

  // Calculate stats
  const openPositions = positions.filter((p) => p.status === 'open');
  const activeSnipers = snipers.filter((s) => s.isActive);

  const totalPnlSol = openPositions.reduce(
    (sum, p) => sum + (p.pnlSol || 0),
    0
  );

  const totalEntrySol = openPositions.reduce((sum, p) => sum + p.entrySol, 0);
  const totalPnlPct = totalEntrySol > 0 ? (totalPnlSol / totalEntrySol) * 100 : 0;

  const snipesToday = snipers.reduce((sum, s) => sum + s.stats.totalSnipes, 0);
  const successfulSnipes = snipers.reduce(
    (sum, s) => sum + s.stats.successfulSnipes,
    0
  );
  const successRate =
    snipesToday > 0 ? Math.round((successfulSnipes / snipesToday) * 100) : 0;

  // Redirect to onboarding if not completed
  useEffect(() => {
    if (!hasCompletedOnboarding && connected) {
      router.push('/onboarding');
    }
  }, [hasCompletedOnboarding, connected, router]);

  // Fetch initial data
  useEffect(() => {
    if (!connected || !publicKey || !token) {
      setIsLoading(false);
      return;
    }

    async function fetchData() {
      try {
        // Fetch wallets (data is array directly)
        const walletsRes = await walletApi.getAll(token);
        if (walletsRes.success && walletsRes.data) {
          const walletsList = Array.isArray(walletsRes.data) ? walletsRes.data : [];
          setWallets(walletsList.map(w => ({
            ...w,
            walletType: w.walletType as 'connected' | 'generated',
            isActive: true,
          })));
        }

        // Fetch snipers (data contains snipers array)
        const snipersRes = await sniperApi.getAll(token);
        if (snipersRes.success && snipersRes.data) {
          const snipersList = Array.isArray(snipersRes.data)
            ? snipersRes.data
            : (snipersRes.data as any).snipers || [];
          setSnipers(snipersList.map((s: any) => ({
            ...s,
            stats: {
              totalSnipes: s.totalSnipes || 0,
              successfulSnipes: s.successfulSnipes || 0,
              failedSnipes: s.failedSnipes || 0,
              totalSolSpent: s.totalSolSpent || 0,
              totalSolProfit: 0,
            },
          })));
        }

        // Fetch positions (data may be array or { positions: [...] })
        const positionsRes = await positionApi.getAll(token);
        if (positionsRes.success && positionsRes.data) {
          const positionsList = Array.isArray(positionsRes.data)
            ? positionsRes.data
            : (positionsRes.data as any).positions || [];
          setPositions(positionsList);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
        toast.error('Failed to load dashboard data');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [connected, publicKey, token, setSnipers, setPositions, setWallets]);

  // Handle sniper toggle
  const handleToggleSniper = async (sniperId: string) => {
    if (!token) return;

    try {
      const sniper = snipers.find((s) => s.id === sniperId);
      const res = await sniperApi.toggle(token, sniperId);

      if (res.success) {
        toggleSniper(sniperId);
        toast.success(
          `Sniper "${sniper?.name}" ${sniper?.isActive ? 'paused' : 'activated'}`
        );
      } else {
        throw new Error(res.error);
      }
    } catch (error) {
      toast.error('Failed to toggle sniper');
    }
  };

  // Handle position sell
  const handleSellPosition = async (positionId: string) => {
    if (!token) return;

    try {
      const res = await positionApi.close(token, positionId);

      if (res.success) {
        toast.loading('Selling position...', { id: positionId });
      } else {
        throw new Error(res.error);
      }
    } catch (error) {
      toast.error('Failed to sell position');
    }
  };

  // Show skeleton until mounted to prevent hydration mismatch
  if (!mounted || isLoading) {
    return <DashboardSkeleton />;
  }

  if (!connected) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Card className="bg-zinc-900/50 border-zinc-800 p-8 text-center">
          <CardContent>
            <h1 className="text-2xl font-bold mb-4">Connect Your Wallet</h1>
            <p className="text-zinc-400 mb-6">
              Connect your Solana wallet to access the dashboard
            </p>
            <WalletMultiButton />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <Logo size="md" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent">
                Migratorrr
              </h1>
            </Link>
            <span className="px-2 py-1 bg-green-900/30 text-green-400 text-xs rounded">
              Beta
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
            >
              + New Sniper
            </Button>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        <StatsCards
          stats={{
            totalPnlSol,
            totalPnlPct,
            openPositions: openPositions.length,
            activeSnipers: activeSnipers.length,
            snipesToday,
            successRate,
          }}
        />

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Positions */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center justify-between">
                  <span>Open Positions ({openPositions.length})</span>
                  <Button variant="ghost" size="sm">
                    View All
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {openPositions.length === 0 ? (
                  <p className="text-zinc-500 text-center py-8">
                    No open positions. Your snipers will create positions when
                    they detect matching migrations.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {openPositions.map((position) => (
                      <PositionCard
                        key={position.id}
                        position={position}
                        onSell={handleSellPosition}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Snipers */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center justify-between">
                  <span>
                    Snipers ({activeSnipers.length}/{snipers.length} active)
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsCreateModalOpen(true)}
                  >
                    + New
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {snipers.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-zinc-500 mb-4">
                      No snipers configured yet. Create your first sniper to
                      start catching migrations.
                    </p>
                    <Button onClick={() => setIsCreateModalOpen(true)}>
                      Create Sniper
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {snipers.map((sniper) => (
                      <SniperCard
                        key={sniper.id}
                        sniper={sniper}
                        onToggle={handleToggleSniper}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar: Wallet + Activity Log */}
          <div className="lg:col-span-1 space-y-4">
            <WalletBalanceCard />
            <ActivityLog />
          </div>
        </div>
      </main>

      {/* Create Sniper Modal */}
      <CreateSniperModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
