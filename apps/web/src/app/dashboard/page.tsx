'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
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
import { Logo, LogoText } from '@/components/logo';
import { usePendingSniperStore } from '@/lib/stores/pending-sniper';
import { Wallet, Copy, Check, ArrowRight, AlertTriangle, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

// Wallet balance type for tracking
interface WalletBalance {
  walletId: string;
  publicKey: string;
  balanceSol: number;
}

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
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [walletBalances, setWalletBalances] = useState<WalletBalance[]>([]);
  const [depositModalData, setDepositModalData] = useState<{
    isOpen: boolean;
    walletAddress: string;
    walletId: string;
    sniperName: string;
    sniperId: string;
    requiredAmount: number;
    currentBalance: number;
  } | null>(null);

  // Get pending sniper to show generated wallet address
  const pendingSniper = usePendingSniperStore((state) => state.pendingSniper);
  const generatedWalletAddress = pendingSniper?.generatedWallet?.publicKey;

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

  // Memoized stats calculations - prevents recalculation on every render
  const openPositions = useMemo(
    () => positions.filter((p) => p.status === 'open'),
    [positions]
  );

  const activeSnipers = useMemo(
    () => snipers.filter((s) => s.isActive),
    [snipers]
  );

  const stats = useMemo(() => {
    const totalPnlSol = openPositions.reduce((sum, p) => sum + (p.pnlSol || 0), 0);
    const totalEntrySol = openPositions.reduce((sum, p) => sum + p.entrySol, 0);
    const totalPnlPct = totalEntrySol > 0 ? (totalPnlSol / totalEntrySol) * 100 : 0;
    const snipesToday = snipers.reduce((sum, s) => sum + s.stats.totalSnipes, 0);
    const successfulSnipes = snipers.reduce((sum, s) => sum + s.stats.successfulSnipes, 0);
    const successRate = snipesToday > 0 ? Math.round((successfulSnipes / snipesToday) * 100) : 0;

    // Extended stats - calculate best/worst trades from all positions
    const closedPositions = positions.filter((p) => p.status === 'closed' && p.pnlSol !== undefined);

    let bestTradeSol = 0;
    let bestTradePct = 0;
    let worstTradeSol = 0;
    let worstTradePct = 0;

    closedPositions.forEach((p) => {
      const pnl = p.pnlSol || 0;
      const pnlPct = p.entrySol > 0 ? (pnl / p.entrySol) * 100 : 0;

      if (pnl > bestTradeSol) {
        bestTradeSol = pnl;
        bestTradePct = pnlPct;
      }
      if (pnl < worstTradeSol) {
        worstTradeSol = pnl;
        worstTradePct = pnlPct;
      }
    });

    const tokensCaught = successfulSnipes;
    const tokensAvoided = snipers.reduce((sum, s) => sum + (s.stats.tokensFiltered || 0), 0);

    // Biggest miss would come from backend tracking - placeholder for now
    const biggestMiss = null;

    return {
      totalPnlSol,
      totalPnlPct,
      snipesToday,
      successRate,
      bestTradeSol,
      bestTradePct,
      worstTradeSol,
      worstTradePct,
      tokensCaught,
      tokensAvoided,
      biggestMiss,
    };
  }, [openPositions, positions, snipers]);

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

    const authToken = token; // Capture token for use in async function

    async function fetchData() {
      try {
        // Parallel fetch for faster loading
        const [walletsRes, snipersRes, positionsRes, balancesRes] = await Promise.all([
          walletApi.getAll(authToken),
          sniperApi.getAll(authToken),
          positionApi.getAll(authToken),
          walletApi.getBalances(authToken),
        ]);

        // Process wallets
        if (walletsRes.success && walletsRes.data) {
          const walletsList = Array.isArray(walletsRes.data) ? walletsRes.data : [];
          setWallets(walletsList.map(w => ({
            ...w,
            walletType: w.walletType as 'connected' | 'generated',
            isActive: true,
          })));
        }

        // Process balances
        if (balancesRes.success && balancesRes.data) {
          setWalletBalances(balancesRes.data.map(b => ({
            walletId: b.walletId,
            publicKey: b.publicKey,
            balanceSol: b.balanceSol,
          })));
        }

        // Process snipers
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
              tokensFiltered: s.tokensFiltered || 0,
            },
          })));
        }

        // Process positions
        if (positionsRes.success && positionsRes.data) {
          const positionsList = Array.isArray(positionsRes.data)
            ? positionsRes.data
            : (positionsRes.data as any).positions || [];
          setPositions(positionsList);
        }
      } catch {
        toast.error('Failed to load dashboard data');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [connected, publicKey, token, setSnipers, setPositions, setWallets]);

  // Memoized handlers to prevent unnecessary re-renders
  const handleToggleSniper = useCallback(async (sniperId: string, hasInsufficientFunds?: boolean) => {
    if (!token) return;

    const sniper = snipers.find((s) => s.id === sniperId);
    if (!sniper) return;

    // If trying to activate with insufficient funds, show deposit modal
    if (hasInsufficientFunds && !sniper.isActive) {
      const walletBalance = walletBalances.find(b => b.walletId === sniper.walletId);
      const requiredAmount = sniper.config.snipeAmountSol + sniper.config.priorityFeeSol + 0.002;

      setDepositModalData({
        isOpen: true,
        walletAddress: walletBalance?.publicKey || '',
        walletId: sniper.walletId,
        sniperName: sniper.name,
        sniperId: sniperId,
        requiredAmount,
        currentBalance: walletBalance?.balanceSol || 0,
      });
      return;
    }

    try {
      const res = await sniperApi.toggle(token, sniperId);

      if (res.success) {
        toggleSniper(sniperId);
        toast.success(
          `Sniper "${sniper?.name}" ${sniper?.isActive ? 'paused' : 'activated'}`
        );
      } else {
        throw new Error(res.error);
      }
    } catch {
      toast.error('Failed to toggle sniper');
    }
  }, [token, snipers, walletBalances, toggleSniper]);

  const handleSellPosition = useCallback(async (positionId: string) => {
    if (!token) return;

    try {
      const res = await positionApi.close(token, positionId);

      if (res.success) {
        toast.loading('Selling position...', { id: positionId });
      } else {
        throw new Error(res.error);
      }
    } catch {
      toast.error('Failed to sell position');
    }
  }, [token]);

  const handleShareResults = useCallback(() => {
    const shareText = `My Migratorrr Stats 🎯

📊 Total P&L: ${stats.totalPnlSol >= 0 ? '+' : ''}${stats.totalPnlSol.toFixed(4)} SOL (${stats.totalPnlPct >= 0 ? '+' : ''}${stats.totalPnlPct.toFixed(1)}%)
✅ Tokens Caught: ${stats.tokensCaught}
🎯 Success Rate: ${stats.successRate}%
${stats.bestTradeSol > 0 ? `🏆 Best Trade: +${stats.bestTradeSol.toFixed(2)} SOL (+${stats.bestTradePct.toFixed(0)}%)` : ''}

Catch PumpFun migrations at migratorrr.xyz`;

    if (navigator.share) {
      navigator.share({
        title: 'My Migratorrr Stats',
        text: shareText,
      }).catch(() => {
        // User cancelled or share failed, copy to clipboard instead
        navigator.clipboard.writeText(shareText);
        toast.success('Stats copied to clipboard!');
      });
    } else {
      navigator.clipboard.writeText(shareText);
      toast.success('Stats copied to clipboard!');
    }
  }, [stats]);

  // Show skeleton until mounted to prevent hydration mismatch
  if (!mounted || isLoading) {
    return <DashboardSkeleton />;
  }

  if (!connected) {
    const handleCopyAddress = async () => {
      if (generatedWalletAddress) {
        await navigator.clipboard.writeText(generatedWalletAddress);
        setCopiedAddress(true);
        toast.success('Address copied!');
        setTimeout(() => setCopiedAddress(false), 2000);
      }
    };

    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <Card className="bg-zinc-900/50 border-zinc-800 p-8 text-center max-w-md w-full">
          <CardContent className="space-y-6">
            {/* Header with wallet icon */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-green-900/30 flex items-center justify-center">
                <Wallet className="w-8 h-8 text-green-400" />
              </div>
              <h1 className="text-2xl font-bold">Final Step</h1>
              <p className="text-zinc-400">
                Connect your wallet to access the Sniper Dashboard
              </p>
            </div>

            {/* Generated wallet info */}
            {generatedWalletAddress && (
              <div className="space-y-3">
                <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                  <p className="text-xs text-zinc-500 mb-2">Your Generated Wallet</p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-green-400 font-mono flex-1 truncate">
                      {generatedWalletAddress}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyAddress}
                      className="shrink-0"
                    >
                      {copiedAddress ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-zinc-500">
                  Import this wallet into Phantom or Solflare using your private key, then connect below
                </p>

                {/* Sniper ready indicator */}
                {pendingSniper && (
                  <div className="flex items-center gap-2 text-sm text-zinc-300 justify-center">
                    <ArrowRight className="w-4 h-4 text-green-400" />
                    <span>Your Migration Sniper "<span className="text-green-400 font-medium">{pendingSniper.name}</span>" is ready to deploy live & track results.</span>
                  </div>
                )}
              </div>
            )}

            {/* Connect button */}
            <div className="pt-2">
              <WalletMultiButton />
            </div>

            {/* Security note */}
            {generatedWalletAddress && (
              <p className="text-xs text-amber-500/80">
                For security, connect with the wallet shown above
              </p>
            )}
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
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="md" />
              <LogoText size="md" />
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
            ...stats,
            openPositions: openPositions.length,
            activeSnipers: activeSnipers.length,
          }}
          onShare={handleShareResults}
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
                    {snipers.map((sniper) => {
                      const balance = walletBalances.find(b => b.walletId === sniper.walletId);
                      return (
                        <SniperCard
                          key={sniper.id}
                          sniper={sniper}
                          walletBalance={balance?.balanceSol}
                          onToggle={handleToggleSniper}
                        />
                      );
                    })}
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

      {/* Deposit Required Modal */}
      {depositModalData?.isOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="bg-zinc-900 border-zinc-700 max-w-md w-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-5 h-5" />
                Deposit Required
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-zinc-300 text-sm">
                Your sniper &quot;<span className="text-white font-medium">{depositModalData.sniperName}</span>&quot; needs funds to execute trades.
              </p>

              <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Current Balance</span>
                  <span className="text-red-400 font-medium">{depositModalData.currentBalance.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Required for Snipe</span>
                  <span className="text-white font-medium">{depositModalData.requiredAmount.toFixed(4)} SOL</span>
                </div>
                <div className="border-t border-zinc-700 pt-3 flex justify-between text-sm">
                  <span className="text-zinc-400">Minimum Deposit</span>
                  <span className="text-amber-400 font-medium">
                    {Math.max(0, depositModalData.requiredAmount - depositModalData.currentBalance).toFixed(4)} SOL
                  </span>
                </div>
              </div>

              <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700">
                <p className="text-xs text-zinc-500 mb-2">Deposit Address</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-green-400 font-mono flex-1 truncate">
                    {depositModalData.walletAddress}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={async () => {
                      await navigator.clipboard.writeText(depositModalData.walletAddress);
                      toast.success('Address copied!');
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      window.open(`https://solscan.io/account/${depositModalData.walletAddress}`, '_blank');
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <p className="text-xs text-zinc-500">
                Send SOL to the address above. Your sniper will activate automatically once funds are available.
              </p>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setDepositModalData(null)}
                >
                  Close
                </Button>
                <Button
                  className="flex-1 bg-amber-600 hover:bg-amber-700"
                  onClick={async () => {
                    await navigator.clipboard.writeText(depositModalData.walletAddress);
                    toast.success('Address copied! Send SOL to activate your sniper.');
                    setDepositModalData(null);
                  }}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Address
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
