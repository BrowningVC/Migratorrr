'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { useSocket } from '@/lib/hooks/useSocket';
import { useAuthStore } from '@/lib/stores/auth';
import { usePendingSniperStore } from '@/lib/stores/pending-sniper';
import { useWalletsStore } from '@/lib/stores/wallets';
import { usePositionsStore } from '@/lib/stores/positions';
import { useSnipersStore } from '@/lib/stores/snipers';
import { sniperApi, positionApi, walletApi } from '@/lib/api';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { ActivityLog } from '@/components/dashboard/activity-log';
import { PositionCard } from '@/components/dashboard/position-card';
import { SniperCard } from '@/components/dashboard/sniper-card';
import { WalletBalanceCard } from '@/components/dashboard/wallet-balance-card';
import { PreAuthSniperModal } from '@/components/sniper/pre-auth-sniper-modal';
import { DashboardSkeleton } from '@/components/dashboard/loading-skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo, LogoText } from '@/components/logo';
import { Copy, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// Wallet balance type for tracking
interface WalletBalance {
  walletId: string;
  publicKey: string;
  balanceSol: number;
  walletType: 'connected' | 'generated';
}

// Dynamic import to prevent hydration mismatch with wallet button
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

export default function DashboardPage() {
  const router = useRouter();
  const { publicKey, connected } = useWallet();
  const { token, isAuthenticated, hasCompletedOnboarding, _hasHydrated, clearAuth } = useAuthStore();
  const { hasPendingSniper } = usePendingSniperStore();
  const { setWallets, wallets } = useWalletsStore();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
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
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    sniperId: string;
    sniperName: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize socket connection
  useSocket(token);

  // Stores
  const positions = usePositionsStore((state) => state.positions);
  const snipers = useSnipersStore((state) => state.snipers);
  const snipersHydrated = useSnipersStore((state) => state._hasHydrated);
  const setSnipers = useSnipersStore((state) => state.setSnipers);
  const setPositions = usePositionsStore((state) => state.setPositions);
  const toggleSniper = useSnipersStore((state) => state.toggleSniper);
  const removeSniper = useSnipersStore((state) => state.removeSniper);
  const walletsHydrated = useWalletsStore((state) => state._hasHydrated);

  // Memoized stats calculations - prevents recalculation on every render
  const openPositions = useMemo(
    () => positions.filter((p) => p.status === 'open'),
    [positions]
  );

  const activeSnipers = useMemo(
    () => snipers.filter((s) => s.isActive),
    [snipers]
  );

  // Trading wallet - the server-generated wallet used for sniping transactions
  // This is NOT the connected/auth wallet - snipers can only use generated wallets
  const tradingWallet = useMemo(() => {
    if (walletBalances.length === 0) return null;
    // Find the generated wallet (server-controlled) - this is the ONLY wallet snipers can use
    const generated = walletBalances.find(b => b.walletType === 'generated');
    return generated || null;
  }, [walletBalances]);

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

  // CRITICAL: Redirect unauthenticated users to home page
  // Dashboard is ONLY accessible to authenticated users with snipers
  useEffect(() => {
    // Wait for ALL stores to hydrate before making redirect decisions
    const allHydrated = _hasHydrated && snipersHydrated && walletsHydrated;
    if (!allHydrated || !mounted) return;

    // If not authenticated, redirect to home page
    if (!isAuthenticated || !token) {
      router.push('/');
      return;
    }

    // If authenticated but hasn't completed onboarding, redirect to onboarding
    if (!hasCompletedOnboarding) {
      router.push('/onboarding');
      return;
    }
  }, [_hasHydrated, snipersHydrated, walletsHydrated, mounted, isAuthenticated, token, hasCompletedOnboarding, router]);

  // Fetch initial data - wait for all stores to hydrate first
  // Use stores as source of truth if they already have data (from onboarding)
  useEffect(() => {
    // Wait for ALL stores to hydrate from localStorage
    const allHydrated = _hasHydrated && snipersHydrated && walletsHydrated;
    if (!allHydrated || !mounted) {
      return;
    }

    // Must be authenticated to fetch data
    if (!isAuthenticated || !token) {
      setIsLoading(false);
      return;
    }

    const authToken = token;

    async function fetchData() {
      setLoadError(null); // Clear any previous error

      try {
        // Always fetch fresh data from API to ensure sync
        // The stores already have data from onboarding, but we refresh for latest state
        const [walletsRes, snipersRes, positionsRes, balancesRes] = await Promise.all([
          walletApi.getAll(authToken),
          sniperApi.getAll(authToken),
          positionApi.getAll(authToken),
          walletApi.getBalances(authToken),
        ]);

        // Check for API errors
        const errors: string[] = [];
        if (!walletsRes.success) errors.push(`Wallets: ${walletsRes.error}`);
        if (!snipersRes.success) errors.push(`Snipers: ${snipersRes.error}`);
        if (!positionsRes.success) errors.push(`Positions: ${positionsRes.error}`);
        if (!balancesRes.success) errors.push(`Balances: ${balancesRes.error}`);

        // Check for auth errors (401 - invalid/expired token)
        const hasAuthError = errors.some(e =>
          e.toLowerCase().includes('invalid') ||
          e.toLowerCase().includes('expired') ||
          e.toLowerCase().includes('unauthorized') ||
          e.includes('401')
        );

        // If we have auth errors, clear the invalid token and redirect
        if (hasAuthError && errors.length >= 3) {
          console.warn('Auth token invalid/expired, clearing auth state');
          clearAuth();
          toast.error('Session expired. Please sign in again.');
          // Redirect to onboarding if there's a pending sniper, otherwise home
          router.push(hasPendingSniper() ? '/onboarding' : '/');
          return;
        }

        // If all API calls failed and we have no store data, show error state
        if (errors.length === 4 && snipers.length === 0) {
          setLoadError(errors[0]); // Show first error
          setIsLoading(false);
          return;
        }

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
            walletType: b.walletType as 'connected' | 'generated',
          })));
        }

        // Process snipers - merge with existing store data if API returns less
        if (snipersRes.success && snipersRes.data) {
          const snipersList = Array.isArray(snipersRes.data)
            ? snipersRes.data
            : (snipersRes.data as any).snipers || [];

          // If API returns snipers, use them; otherwise keep existing store state
          if (snipersList.length > 0) {
            setSnipers(snipersList.map((s: any) => ({
              id: s.id,
              name: s.name,
              isActive: s.isActive,
              walletId: s.walletId || s.wallet?.id,
              config: s.config,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
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
          // If no snipers from API but store has snipers (from onboarding), keep them
        }

        // Process positions
        if (positionsRes.success && positionsRes.data) {
          const positionsList = Array.isArray(positionsRes.data)
            ? positionsRes.data
            : (positionsRes.data as any).positions || [];
          setPositions(positionsList);
        }
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
        // Only set error state if we have no data from stores
        if (snipers.length === 0) {
          setLoadError(error instanceof Error ? error.message : 'Network error');
        }
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [_hasHydrated, snipersHydrated, walletsHydrated, mounted, isAuthenticated, token, setSnipers, setPositions, setWallets, snipers.length, retryCount, clearAuth, hasPendingSniper, router]);

  // Retry handler for failed data loading
  const handleRetryLoad = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    setRetryCount(prev => prev + 1);
  }, []);

  // Memoized handlers to prevent unnecessary re-renders
  const handleToggleSniper = useCallback(async (sniperId: string, hasInsufficientFunds?: boolean) => {
    if (!token) return;

    const sniper = snipers.find((s) => s.id === sniperId);
    if (!sniper) return;

    // If trying to activate with insufficient funds, show deposit modal
    // Use primary wallet (ONE wallet for all snipers)
    if (hasInsufficientFunds && !sniper.isActive) {
      const requiredAmount = sniper.config.snipeAmountSol + sniper.config.priorityFeeSol + 0.002;

      setDepositModalData({
        isOpen: true,
        walletAddress: tradingWallet?.publicKey || '',
        walletId: tradingWallet?.walletId || sniper.walletId,
        sniperName: sniper.name,
        sniperId: sniperId,
        requiredAmount,
        currentBalance: tradingWallet?.balanceSol || 0,
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
  }, [token, snipers, tradingWallet, toggleSniper]);

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

  // Open delete confirmation dialog
  const handleDeleteSniper = useCallback((sniperId: string) => {
    const sniper = snipers.find((s) => s.id === sniperId);
    if (!sniper) return;

    setDeleteDialog({
      isOpen: true,
      sniperId,
      sniperName: sniper.name,
    });
  }, [snipers]);

  // Confirm deletion
  const confirmDeleteSniper = useCallback(async () => {
    if (!token || !deleteDialog) return;

    setIsDeleting(true);

    try {
      const res = await sniperApi.delete(token, deleteDialog.sniperId);

      if (res.success) {
        removeSniper(deleteDialog.sniperId);
        toast.success(`Sniper "${deleteDialog.sniperName}" deleted`);
        setDeleteDialog(null);
      } else {
        throw new Error(res.error);
      }
    } catch (error) {
      toast.error('Failed to delete sniper');
      console.error('Delete sniper error:', error);
    } finally {
      setIsDeleting(false);
    }
  }, [token, deleteDialog, removeSniper]);

  // Show skeleton until all stores are hydrated
  // IMPORTANT: No preview mode - dashboard requires authentication
  const allStoresHydrated = _hasHydrated && snipersHydrated && walletsHydrated;

  if (!mounted || !allStoresHydrated) {
    return <DashboardSkeleton />;
  }

  // If not authenticated or loading, show skeleton (redirect will happen via useEffect)
  if (!isAuthenticated || !token || isLoading) {
    return <DashboardSkeleton />;
  }

  // Show error state with retry button if data loading failed
  if (loadError && snipers.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <Card className="bg-zinc-900 border-zinc-800 max-w-md w-full">
          <CardHeader className="text-center">
            <div className="w-14 h-14 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            <CardTitle className="text-xl text-white">Failed to load dashboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-zinc-400 text-sm text-center">
              Unable to connect to the server. Please check your connection and try again.
            </p>

            <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700">
              <p className="text-xs text-zinc-500 font-mono truncate">
                {loadError}
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => router.push('/')}
              >
                Go Home
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleRetryLoad}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white relative">
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
                <Button variant="ghost" size="sm" className="text-green-400 bg-green-900/20">
                  Dashboard
                </Button>
              </Link>
              <Link href="/migrator">
                <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
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
            {/* Auth indicator - shows which wallet you're signed in with */}
            {connected && publicKey && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-zinc-400">Signed in:</span>
                <code className="text-xs text-zinc-300 font-mono">
                  {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
                </code>
              </div>
            )}
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
                  <div className="space-y-4">
                    {/* Empty State Table with Column Headers */}
                    <div className="border border-zinc-800 rounded-lg overflow-hidden">
                      {/* Table Header */}
                      <div className="grid grid-cols-[2fr_1fr_1.2fr_1.2fr_1fr_1.2fr_80px] gap-3 px-4 py-3 text-xs font-medium text-zinc-400 bg-zinc-800/50 border-b border-zinc-800">
                        <div>Token</div>
                        <div className="text-right">Amount (SOL)</div>
                        <div className="text-right">Entry MCAP</div>
                        <div className="text-right">Current MCAP</div>
                        <div className="text-right">P&L (%)</div>
                        <div className="text-right">Entry Time</div>
                        <div className="text-right">Action</div>
                      </div>
                      {/* Single Empty Placeholder Row */}
                      <div className="grid grid-cols-[2fr_1fr_1.2fr_1.2fr_1fr_1.2fr_80px] gap-3 px-4 py-4 items-center">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-zinc-800 border border-dashed border-zinc-700" />
                          <div className="space-y-1">
                            <div className="h-3.5 w-16 bg-zinc-800 rounded border border-dashed border-zinc-700" />
                            <div className="h-2.5 w-12 bg-zinc-800/50 rounded border border-dashed border-zinc-700/50" />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <div className="h-3.5 w-10 bg-zinc-800 rounded border border-dashed border-zinc-700" />
                        </div>
                        <div className="flex justify-end">
                          <div className="h-3.5 w-12 bg-zinc-800 rounded border border-dashed border-zinc-700" />
                        </div>
                        <div className="flex justify-end">
                          <div className="h-3.5 w-12 bg-zinc-800 rounded border border-dashed border-zinc-700" />
                        </div>
                        <div className="flex justify-end">
                          <div className="h-3.5 w-10 bg-zinc-800 rounded border border-dashed border-zinc-700" />
                        </div>
                        <div className="flex justify-end">
                          <div className="h-3.5 w-14 bg-zinc-800 rounded border border-dashed border-zinc-700" />
                        </div>
                        <div className="flex justify-end">
                          <div className="h-7 w-16 bg-zinc-800 rounded border border-dashed border-zinc-700" />
                        </div>
                      </div>
                    </div>
                    <p className="text-zinc-500 text-center text-sm">
                      Positions will appear here when your snipers catch migrations.
                    </p>
                  </div>
                ) : (
                  <div className="border border-zinc-800 rounded-lg overflow-hidden">
                    {/* Table Header */}
                    <div className="grid grid-cols-[2fr_1fr_1.2fr_1.2fr_1fr_1.2fr_80px] gap-3 px-4 py-3 text-xs font-medium text-zinc-400 bg-zinc-800/50 border-b border-zinc-800">
                      <div>Token</div>
                      <div className="text-right">Amount (SOL)</div>
                      <div className="text-right">Entry MCAP</div>
                      <div className="text-right">Current MCAP</div>
                      <div className="text-right">P&L (%)</div>
                      <div className="text-right">Entry Time</div>
                      <div className="text-right">Action</div>
                    </div>
                    {/* Scrollable positions - max 4 visible */}
                    <div className="max-h-[280px] overflow-y-auto">
                      {openPositions.map((position) => {
                        const pnlPct = position.pnlPct ?? 0;
                        const isProfitable = pnlPct > 0;
                        const isLoss = pnlPct < 0;

                        // Format market cap display
                        const formatMcap = (mcap: number | null | undefined) => {
                          if (!mcap) return '—';
                          if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(1)}M`;
                          if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
                          return `$${mcap.toFixed(0)}`;
                        };

                        return (
                          <div
                            key={position.id}
                            className="grid grid-cols-[2fr_1fr_1.2fr_1.2fr_1fr_1.2fr_80px] gap-3 px-4 py-3 items-center text-sm border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/30 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-[10px] font-bold text-black shrink-0">
                                {position.tokenSymbol?.charAt(0) || '?'}
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-white truncate">{position.tokenSymbol || 'Unknown'}</p>
                                <p className="text-[10px] text-zinc-500 font-mono">
                                  {position.tokenMint?.slice(0, 4)}...{position.tokenMint?.slice(-4)}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-medium text-white">{position.entrySol?.toFixed(3) || '0.00'}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-medium text-zinc-300">
                                {formatMcap(position.entryMarketCap)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-medium text-zinc-300">
                                {formatMcap(position.currentMarketCap)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={cn(
                                'font-bold',
                                isProfitable && 'text-green-400',
                                isLoss && 'text-red-400',
                                !isProfitable && !isLoss && 'text-zinc-400'
                              )}>
                                {position.pnlPct !== undefined ? (
                                  `${isProfitable ? '+' : ''}${pnlPct.toFixed(1)}%`
                                ) : '—'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-zinc-400 text-xs">
                                {position.createdAt ? new Date(position.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                              </p>
                            </div>
                            <div className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-3 text-xs border-red-800 text-red-400 hover:bg-red-900/30 hover:text-red-300"
                                onClick={() => handleSellPosition(position.id)}
                              >
                                Sell All
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
                  <div className="space-y-4">
                    <p className="text-zinc-500 text-center text-sm">
                      Create your first sniper to start catching migrations.
                    </p>
                    <div className="text-center">
                      <Button onClick={() => setIsCreateModalOpen(true)}>
                        Create Sniper
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {snipers.map((sniper) => (
                      <SniperCard
                        key={sniper.id}
                        sniper={sniper}
                        walletBalance={tradingWallet?.balanceSol}
                        walletAddress={tradingWallet?.publicKey}
                        onToggle={handleToggleSniper}
                        onDelete={handleDeleteSniper}
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

      {/* Pre-Auth Sniper Modal - handles full flow including wallet generation */}
      <PreAuthSniperModal
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

      {/* Delete Sniper Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialog?.isOpen ?? false}
        onClose={() => setDeleteDialog(null)}
        onConfirm={confirmDeleteSniper}
        title={`Delete "${deleteDialog?.sniperName}"?`}
        description="This will permanently remove this sniper and all its settings. Any open positions will remain but won't be automatically managed."
        confirmText="Delete Sniper"
        cancelText="Keep It"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
