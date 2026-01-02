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
import { SniperCard } from '@/components/dashboard/sniper-card';
import { WalletBalanceCard } from '@/components/dashboard/wallet-balance-card';
import { PreAuthSniperModal } from '@/components/sniper/pre-auth-sniper-modal';
import { DashboardSkeleton } from '@/components/dashboard/loading-skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo, LogoText } from '@/components/logo';
import {
  Copy,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Loader2,
  Plus,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Menu,
  X,
  Home,
  Crosshair,
  Wallet,
  History,
  Settings
} from 'lucide-react';
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'positions' | 'snipers' | 'activity'>('positions');
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
  const [sellingPositions, setSellingPositions] = useState<Set<string>>(new Set());

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize socket connection
  useSocket(token);

  // Stores
  const positions = usePositionsStore((state) => state.positions);
  const positionsHydrated = usePositionsStore((state) => state._hasHydrated);
  const snipers = useSnipersStore((state) => state.snipers);
  const snipersHydrated = useSnipersStore((state) => state._hasHydrated);
  const setSnipers = useSnipersStore((state) => state.setSnipers);
  const mergePositions = usePositionsStore((state) => state.mergePositions);
  const updatePosition = usePositionsStore((state) => state.updatePosition);
  const toggleSniper = useSnipersStore((state) => state.toggleSniper);
  const removeSniper = useSnipersStore((state) => state.removeSniper);
  const walletsHydrated = useWalletsStore((state) => state._hasHydrated);

  // Memoized stats calculations
  const openPositions = useMemo(
    () => positions
      .filter((p) => p.status === 'open' || p.status === 'selling')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [positions]
  );

  const activeSnipers = useMemo(
    () => snipers.filter((s) => s.isActive),
    [snipers]
  );

  // Trading wallet
  const tradingWallet = useMemo(() => {
    if (walletBalances.length === 0) return null;
    const generated = walletBalances.find(b => b.walletType === 'generated');
    return generated || null;
  }, [walletBalances]);

  const stats = useMemo(() => {
    const openPnlSol = openPositions.reduce((sum, p) => sum + (p.pnlSol || 0), 0);
    const openEntrySol = openPositions.reduce((sum, p) => sum + p.entrySol, 0);

    const closedPositions = positions.filter((p) => p.status === 'closed');
    const closedPnlSol = closedPositions.reduce((sum, p) => {
      if (p.exitSol !== undefined && p.entrySol > 0) {
        return sum + (p.exitSol - p.entrySol);
      }
      return sum;
    }, 0);
    const closedEntrySol = closedPositions.reduce((sum, p) => sum + p.entrySol, 0);

    const totalPnlSol = openPnlSol + closedPnlSol;
    const totalEntrySol = openEntrySol + closedEntrySol;
    const totalPnlPct = totalEntrySol > 0 ? (totalPnlSol / totalEntrySol) * 100 : 0;

    const snipesToday = snipers.reduce((sum, s) => sum + s.stats.totalSnipes, 0);
    const successfulSnipes = snipers.reduce((sum, s) => sum + s.stats.successfulSnipes, 0);
    const successRate = snipesToday > 0 ? Math.round((successfulSnipes / snipesToday) * 100) : 0;

    let bestTradeSol = 0;
    let bestTradePct = 0;
    let worstTradeSol = 0;
    let worstTradePct = 0;

    closedPositions.forEach((p) => {
      const pnl = p.exitSol !== undefined ? p.exitSol - p.entrySol : 0;
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

  // Redirect unauthenticated users
  useEffect(() => {
    const allHydrated = _hasHydrated && snipersHydrated && walletsHydrated;
    if (!allHydrated || !mounted) return;

    if (!isAuthenticated || !token) {
      router.push('/');
      return;
    }

    if (!hasCompletedOnboarding) {
      router.push('/onboarding');
      return;
    }
  }, [_hasHydrated, snipersHydrated, walletsHydrated, mounted, isAuthenticated, token, hasCompletedOnboarding, router]);

  // Fetch initial data
  useEffect(() => {
    const allHydrated = _hasHydrated && snipersHydrated && walletsHydrated && positionsHydrated;
    if (!allHydrated || !mounted) return;

    if (!isAuthenticated || !token) {
      setIsLoading(false);
      return;
    }

    const authToken = token;

    async function fetchData() {
      setLoadError(null);

      try {
        const [walletsRes, snipersRes, positionsRes, balancesRes] = await Promise.all([
          walletApi.getAll(authToken),
          sniperApi.getAll(authToken),
          positionApi.getAll(authToken),
          walletApi.getBalances(authToken),
        ]);

        const errors: string[] = [];
        if (!walletsRes.success) errors.push(`Wallets: ${walletsRes.error}`);
        if (!snipersRes.success) errors.push(`Snipers: ${snipersRes.error}`);
        if (!positionsRes.success) errors.push(`Positions: ${positionsRes.error}`);
        if (!balancesRes.success) errors.push(`Balances: ${balancesRes.error}`);

        const hasAuthError = errors.some(e =>
          e.toLowerCase().includes('invalid') ||
          e.toLowerCase().includes('expired') ||
          e.toLowerCase().includes('unauthorized') ||
          e.includes('401')
        );

        if (hasAuthError && errors.length >= 3) {
          clearAuth();
          toast.error('Session expired. Please sign in again.');
          router.push(hasPendingSniper() ? '/onboarding' : '/');
          return;
        }

        if (errors.length === 4 && snipers.length === 0) {
          setLoadError(errors[0]);
          setIsLoading(false);
          return;
        }

        if (walletsRes.success && walletsRes.data) {
          const walletsList = Array.isArray(walletsRes.data) ? walletsRes.data : [];
          setWallets(walletsList.map(w => ({
            ...w,
            walletType: w.walletType as 'connected' | 'generated',
            isActive: true,
          })));
        }

        if (balancesRes.success && balancesRes.data) {
          setWalletBalances(balancesRes.data.map(b => ({
            walletId: b.walletId,
            publicKey: b.publicKey,
            balanceSol: b.balanceSol,
            walletType: b.walletType as 'connected' | 'generated',
          })));
        }

        if (snipersRes.success && snipersRes.data) {
          const snipersList = Array.isArray(snipersRes.data)
            ? snipersRes.data
            : (snipersRes.data as any).snipers || [];

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
        }

        if (positionsRes.success && positionsRes.data) {
          const positionsList = Array.isArray(positionsRes.data)
            ? positionsRes.data
            : (positionsRes.data as any).items || (positionsRes.data as any).positions || [];
          mergePositions(positionsList);
        }
      } catch (error) {
        if (snipers.length === 0) {
          setLoadError(error instanceof Error ? error.message : 'Network error');
        }
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [_hasHydrated, snipersHydrated, walletsHydrated, positionsHydrated, mounted, isAuthenticated, token, setSnipers, mergePositions, setWallets, snipers.length, retryCount, clearAuth, hasPendingSniper, router]);

  // Enrich positions
  useEffect(() => {
    const positionsToEnrich = openPositions.filter(
      (p) => p.tokenMint && (!p.tokenSymbol || !p.entryMarketCap || !p.currentMarketCap)
    );

    if (positionsToEnrich.length === 0 || !token) return;

    const toFetch = positionsToEnrich.slice(0, 5);

    toFetch.forEach(async (position) => {
      try {
        const response = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${position.tokenMint}`
        );
        if (!response.ok) return;

        const data = await response.json();
        if (data.pairs && data.pairs.length > 0) {
          const pair = data.pairs.find((p: any) => p.chainId === 'solana');
          if (pair) {
            const tokenInfo =
              pair.baseToken?.address === position.tokenMint
                ? pair.baseToken
                : pair.quoteToken;
            const currentMarketCap = pair.marketCap || pair.fdv || null;

            const updates: Partial<typeof position> = { currentMarketCap };
            const dbUpdates: { tokenSymbol?: string; tokenName?: string; entryMarketCap?: number } = {};

            if (!position.tokenSymbol && tokenInfo?.symbol) {
              updates.tokenSymbol = tokenInfo.symbol;
              dbUpdates.tokenSymbol = tokenInfo.symbol;
            }
            if (!position.tokenName && tokenInfo?.name) {
              updates.tokenName = tokenInfo.name;
              dbUpdates.tokenName = tokenInfo.name;
            }

            if (!position.entryMarketCap && currentMarketCap) {
              updates.entryMarketCap = currentMarketCap;
              dbUpdates.entryMarketCap = currentMarketCap;
            }

            const entryMcap = position.entryMarketCap || updates.entryMarketCap;
            if (entryMcap && currentMarketCap) {
              const pnlPct = ((currentMarketCap / entryMcap) - 1) * 100;
              const pnlSol = position.entrySol * (pnlPct / 100);
              updates.pnlPct = pnlPct;
              updates.pnlSol = pnlSol;
            }

            updatePosition(position.id, updates);

            if (Object.keys(dbUpdates).length > 0) {
              positionApi.updateMetadata(token, position.id, dbUpdates).catch(() => {});
            }
          }
        }
      } catch {}
    });
  }, [openPositions, updatePosition, token]);

  const handleRetryLoad = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    setRetryCount(prev => prev + 1);
  }, []);

  const handleToggleSniper = useCallback(async (sniperId: string, hasInsufficientFunds?: boolean) => {
    if (!token) return;

    const sniper = snipers.find((s) => s.id === sniperId);
    if (!sniper) return;

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

    if (sellingPositions.has(positionId)) return;

    setSellingPositions(prev => new Set(Array.from(prev).concat(positionId)));

    try {
      const res = await positionApi.close(token, positionId);

      if (res.success) {
        toast.loading('Selling position...', { id: positionId });
      } else {
        throw new Error(res.error);
      }
    } catch {
      toast.error('Failed to sell position');
      setSellingPositions(prev => {
        const next = new Set(prev);
        next.delete(positionId);
        return next;
      });
    }
  }, [token, sellingPositions]);

  const handleDeleteSniper = useCallback((sniperId: string) => {
    const sniper = snipers.find((s) => s.id === sniperId);
    if (!sniper) return;

    setDeleteDialog({
      isOpen: true,
      sniperId,
      sniperName: sniper.name,
    });
  }, [snipers]);

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
    } finally {
      setIsDeleting(false);
    }
  }, [token, deleteDialog, removeSniper]);

  const allStoresHydrated = _hasHydrated && snipersHydrated && walletsHydrated;

  if (!mounted || !allStoresHydrated) {
    return <DashboardSkeleton />;
  }

  if (!isAuthenticated || !token || isLoading) {
    return <DashboardSkeleton />;
  }

  if (loadError && snipers.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
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
              <p className="text-xs text-zinc-500 font-mono truncate">{loadError}</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => router.push('/')}>
                Go Home
              </Button>
              <Button className="flex-1 bg-orange-500 hover:bg-orange-600 text-black" onClick={handleRetryLoad}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatMcap = (mcap: number | null | undefined) => {
    if (!mcap) return '—';
    if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(1)}M`;
    if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
    return `$${mcap.toFixed(0)}`;
  };

  const isProfitable = stats.totalPnlSol >= 0;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top Bar */}
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-zinc-800/50 bg-black/80 backdrop-blur-xl">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="sm" />
              <LogoText size="sm" />
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Stats */}
            <div className="hidden md:flex items-center gap-6 mr-4">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  isProfitable ? "bg-green-500/10" : "bg-red-500/10"
                )}>
                  {isProfitable ? (
                    <TrendingUp className="w-4 h-4 text-green-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-400" />
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase">P&L</p>
                  <p className={cn(
                    "text-sm font-bold font-mono",
                    isProfitable ? "text-green-400" : "text-red-400"
                  )}>
                    {isProfitable ? '+' : ''}{stats.totalPnlSol.toFixed(3)}
                  </p>
                </div>
              </div>

              <div className="w-px h-8 bg-zinc-800" />

              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Crosshair className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase">Active</p>
                  <p className="text-sm font-bold font-mono text-white">
                    {activeSnipers.length}/{snipers.length}
                  </p>
                </div>
              </div>
            </div>

            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-black font-semibold gap-1"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Sniper</span>
            </Button>

            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={cn(
        "fixed top-14 left-0 bottom-0 w-64 border-r border-zinc-800/50 bg-black/90 backdrop-blur-xl z-30 transition-transform duration-300",
        "lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 space-y-2">
          <Link href="/">
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors text-sm">
              <Home className="w-4 h-4" />
              Home
            </button>
          </Link>

          <button
            onClick={() => setActiveTab('positions')}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm",
              activeTab === 'positions'
                ? "bg-orange-500/10 text-orange-400 border border-orange-500/20"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            )}
          >
            <TrendingUp className="w-4 h-4" />
            Positions
            {openPositions.length > 0 && (
              <span className="ml-auto text-xs bg-zinc-800 px-1.5 py-0.5 rounded">
                {openPositions.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('snipers')}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm",
              activeTab === 'snipers'
                ? "bg-orange-500/10 text-orange-400 border border-orange-500/20"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            )}
          >
            <Crosshair className="w-4 h-4" />
            Snipers
            {activeSnipers.length > 0 && (
              <span className="ml-auto text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">
                {activeSnipers.length} live
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('activity')}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm",
              activeTab === 'activity'
                ? "bg-orange-500/10 text-orange-400 border border-orange-500/20"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            )}
          >
            <History className="w-4 h-4" />
            Activity
          </button>

          <div className="pt-4 border-t border-zinc-800 mt-4">
            <Link href="/buybacks">
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors text-sm">
                <Wallet className="w-4 h-4" />
                $MIGRATOR
              </button>
            </Link>
            <Link href="/how-it-works">
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors text-sm">
                <Settings className="w-4 h-4" />
                How it Works
              </button>
            </Link>
          </div>
        </div>

        {/* Wallet Card in Sidebar */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-zinc-800/50">
          <WalletBalanceCard />
        </div>
      </aside>

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="pt-14 lg:pl-64">
        <div className="p-6 space-y-6">
          {/* Stats Row - Compact */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Total P&L</p>
              <p className={cn(
                "text-xl font-bold font-mono",
                isProfitable ? "text-green-400" : "text-red-400"
              )}>
                {isProfitable ? '+' : ''}{stats.totalPnlSol.toFixed(3)}
              </p>
              <p className="text-[10px] text-zinc-500">
                {isProfitable ? '+' : ''}{stats.totalPnlPct.toFixed(1)}%
              </p>
            </div>

            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Positions</p>
              <p className="text-xl font-bold font-mono text-white">{openPositions.length}</p>
              <p className="text-[10px] text-zinc-500">open</p>
            </div>

            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Snipers</p>
              <p className="text-xl font-bold font-mono text-orange-400">{activeSnipers.length}</p>
              <p className="text-[10px] text-zinc-500">active</p>
            </div>

            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Snipes</p>
              <p className="text-xl font-bold font-mono text-white">{stats.snipesToday}</p>
              <p className="text-[10px] text-zinc-500">total</p>
            </div>

            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Success</p>
              <p className="text-xl font-bold font-mono text-white">{stats.successRate}%</p>
              <p className="text-[10px] text-zinc-500">rate</p>
            </div>

            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Status</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <p className="text-sm font-medium text-green-400">Live</p>
              </div>
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'positions' && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <h2 className="font-semibold">Open Positions</h2>
                <span className="text-sm text-zinc-500">{openPositions.length} position{openPositions.length !== 1 ? 's' : ''}</span>
              </div>

              {openPositions.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
                    <TrendingUp className="w-6 h-6 text-zinc-600" />
                  </div>
                  <p className="text-zinc-400 mb-2">No open positions</p>
                  <p className="text-sm text-zinc-600">Positions appear here when snipers catch migrations</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-zinc-800/50">
                      <tr className="text-left text-xs text-zinc-500 uppercase">
                        <th className="px-4 py-3 font-medium">Token</th>
                        <th className="px-4 py-3 font-medium text-right">Entry</th>
                        <th className="px-4 py-3 font-medium text-right">Entry MCAP</th>
                        <th className="px-4 py-3 font-medium text-right">Current MCAP</th>
                        <th className="px-4 py-3 font-medium text-right">P&L</th>
                        <th className="px-4 py-3 font-medium text-right">Time</th>
                        <th className="px-4 py-3 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {openPositions.map((position) => {
                        const pnlPct = position.pnlPct ?? 0;
                        const isProfit = pnlPct > 0;
                        const isLoss = pnlPct < 0;

                        return (
                          <tr key={position.id} className="hover:bg-zinc-800/20 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-xs font-bold text-black">
                                  {position.tokenSymbol?.charAt(0) || '?'}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{position.tokenSymbol || position.tokenMint?.slice(0, 6)}</span>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(position.tokenMint || '');
                                        toast.success('Copied!');
                                      }}
                                      className="p-1 hover:bg-zinc-700 rounded transition-colors"
                                    >
                                      <Copy className="w-3 h-3 text-zinc-500" />
                                    </button>
                                    <a
                                      href={`https://dexscreener.com/solana/${position.tokenMint}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1 hover:bg-zinc-700 rounded transition-colors"
                                    >
                                      <ExternalLink className="w-3 h-3 text-zinc-500" />
                                    </a>
                                  </div>
                                  <p className="text-[10px] text-zinc-600 font-mono">
                                    {position.tokenMint?.slice(0, 4)}...{position.tokenMint?.slice(-4)}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono">
                              {position.entrySol?.toFixed(3)} SOL
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-zinc-400">
                              {formatMcap(position.entryMarketCap)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-zinc-400">
                              {formatMcap(position.currentMarketCap)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={cn(
                                "font-bold font-mono",
                                isProfit && "text-green-400",
                                isLoss && "text-red-400",
                                !isProfit && !isLoss && "text-zinc-400"
                              )}>
                                {isProfit ? '+' : ''}{pnlPct.toFixed(1)}%
                              </span>
                              {position.pnlSol !== undefined && (
                                <p className={cn(
                                  "text-[10px] font-mono",
                                  isProfit ? "text-green-400/70" : isLoss ? "text-red-400/70" : "text-zinc-500"
                                )}>
                                  {isProfit ? '+' : ''}{position.pnlSol.toFixed(4)}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-500 text-xs">
                              {position.createdAt
                                ? new Date(position.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3 text-xs border-red-800/50 text-red-400 hover:bg-red-900/30 hover:text-red-300"
                                onClick={() => handleSellPosition(position.id)}
                                disabled={sellingPositions.has(position.id) || position.status === 'selling'}
                              >
                                {sellingPositions.has(position.id) || position.status === 'selling' ? (
                                  <>
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    Selling
                                  </>
                                ) : (
                                  'Sell'
                                )}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'snipers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Your Snipers</h2>
                <Button
                  size="sm"
                  className="bg-orange-500 hover:bg-orange-600 text-black"
                  onClick={() => setIsCreateModalOpen(true)}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Create Sniper
                </Button>
              </div>

              {snipers.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center mx-auto mb-4">
                    <Crosshair className="w-6 h-6 text-orange-400" />
                  </div>
                  <p className="text-zinc-400 mb-2">No snipers yet</p>
                  <p className="text-sm text-zinc-600 mb-4">Create your first sniper to start catching migrations</p>
                  <Button
                    className="bg-orange-500 hover:bg-orange-600 text-black"
                    onClick={() => setIsCreateModalOpen(true)}
                  >
                    Create Sniper
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="max-w-2xl">
              <ActivityLog />
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
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
                  <code className="text-xs text-orange-400 font-mono flex-1 truncate">
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
