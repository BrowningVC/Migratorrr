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
  TrendingUp,
  TrendingDown,
  Crosshair,
  Wallet,
  Radio,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  Target,
  Activity,
  BarChart3,
  Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface WalletBalance {
  walletId: string;
  publicKey: string;
  balanceSol: number;
  walletType: 'connected' | 'generated';
}

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
  const [sellingPositions, setSellingPositions] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  useSocket(token);

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

  const openPositions = useMemo(
    () => positions
      .filter((p) => p.status === 'open' || p.status === 'selling')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [positions]
  );

  const activeSnipers = useMemo(() => snipers.filter((s) => s.isActive), [snipers]);

  const tradingWallet = useMemo(() => {
    if (walletBalances.length === 0) return null;
    return walletBalances.find(b => b.walletType === 'generated') || null;
  }, [walletBalances]);

  const stats = useMemo(() => {
    const openPnlSol = openPositions.reduce((sum, p) => sum + (p.pnlSol || 0), 0);
    const openEntrySol = openPositions.reduce((sum, p) => sum + p.entrySol, 0);
    const closedPositions = positions.filter((p) => p.status === 'closed');
    const closedPnlSol = closedPositions.reduce((sum, p) => {
      if (p.exitSol !== undefined && p.entrySol > 0) return sum + (p.exitSol - p.entrySol);
      return sum;
    }, 0);
    const closedEntrySol = closedPositions.reduce((sum, p) => sum + p.entrySol, 0);
    const totalPnlSol = openPnlSol + closedPnlSol;
    const totalEntrySol = openEntrySol + closedEntrySol;
    const totalPnlPct = totalEntrySol > 0 ? (totalPnlSol / totalEntrySol) * 100 : 0;
    const snipesToday = snipers.reduce((sum, s) => sum + s.stats.totalSnipes, 0);
    const successfulSnipes = snipers.reduce((sum, s) => sum + s.stats.successfulSnipes, 0);
    const successRate = snipesToday > 0 ? Math.round((successfulSnipes / snipesToday) * 100) : 0;
    return { totalPnlSol, totalPnlPct, snipesToday, successRate };
  }, [openPositions, positions, snipers]);

  useEffect(() => {
    const allHydrated = _hasHydrated && snipersHydrated && walletsHydrated;
    if (!allHydrated || !mounted) return;
    if (!isAuthenticated || !token) { router.push('/'); return; }
    if (!hasCompletedOnboarding) { router.push('/onboarding'); return; }
  }, [_hasHydrated, snipersHydrated, walletsHydrated, mounted, isAuthenticated, token, hasCompletedOnboarding, router]);

  useEffect(() => {
    const allHydrated = _hasHydrated && snipersHydrated && walletsHydrated && positionsHydrated;
    if (!allHydrated || !mounted) return;
    if (!isAuthenticated || !token) { setIsLoading(false); return; }

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
          e.toLowerCase().includes('invalid') || e.toLowerCase().includes('expired') ||
          e.toLowerCase().includes('unauthorized') || e.includes('401')
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
          setWallets(walletsList.map(w => ({ ...w, walletType: w.walletType as 'connected' | 'generated', isActive: true })));
        }
        if (balancesRes.success && balancesRes.data) {
          setWalletBalances(balancesRes.data.map(b => ({
            walletId: b.walletId, publicKey: b.publicKey, balanceSol: b.balanceSol, walletType: b.walletType as 'connected' | 'generated',
          })));
        }
        if (snipersRes.success && snipersRes.data) {
          const snipersList = Array.isArray(snipersRes.data) ? snipersRes.data : (snipersRes.data as any).snipers || [];
          if (snipersList.length > 0) {
            setSnipers(snipersList.map((s: any) => ({
              id: s.id, name: s.name, isActive: s.isActive, walletId: s.walletId || s.wallet?.id, config: s.config,
              createdAt: s.createdAt, updatedAt: s.updatedAt,
              stats: { totalSnipes: s.totalSnipes || 0, successfulSnipes: s.successfulSnipes || 0, failedSnipes: s.failedSnipes || 0, totalSolSpent: s.totalSolSpent || 0, totalSolProfit: 0, tokensFiltered: s.tokensFiltered || 0 },
            })));
          }
        }
        if (positionsRes.success && positionsRes.data) {
          const positionsList = Array.isArray(positionsRes.data) ? positionsRes.data : (positionsRes.data as any).items || (positionsRes.data as any).positions || [];
          mergePositions(positionsList);
        }
      } catch (error) {
        if (snipers.length === 0) setLoadError(error instanceof Error ? error.message : 'Network error');
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [_hasHydrated, snipersHydrated, walletsHydrated, positionsHydrated, mounted, isAuthenticated, token, setSnipers, mergePositions, setWallets, snipers.length, retryCount, clearAuth, hasPendingSniper, router]);

  useEffect(() => {
    const positionsToEnrich = openPositions.filter((p) => p.tokenMint && (!p.tokenSymbol || !p.entryMarketCap || !p.currentMarketCap));
    if (positionsToEnrich.length === 0 || !token) return;
    const toFetch = positionsToEnrich.slice(0, 5);
    toFetch.forEach(async (position) => {
      try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${position.tokenMint}`);
        if (!response.ok) return;
        const data = await response.json();
        if (data.pairs && data.pairs.length > 0) {
          const pair = data.pairs.find((p: any) => p.chainId === 'solana');
          if (pair) {
            const tokenInfo = pair.baseToken?.address === position.tokenMint ? pair.baseToken : pair.quoteToken;
            const currentMarketCap = pair.marketCap || pair.fdv || null;
            const updates: Partial<typeof position> = { currentMarketCap };
            const dbUpdates: { tokenSymbol?: string; tokenName?: string; entryMarketCap?: number } = {};
            if (!position.tokenSymbol && tokenInfo?.symbol) { updates.tokenSymbol = tokenInfo.symbol; dbUpdates.tokenSymbol = tokenInfo.symbol; }
            if (!position.tokenName && tokenInfo?.name) { updates.tokenName = tokenInfo.name; dbUpdates.tokenName = tokenInfo.name; }
            if (!position.entryMarketCap && currentMarketCap) { updates.entryMarketCap = currentMarketCap; dbUpdates.entryMarketCap = currentMarketCap; }
            const entryMcap = position.entryMarketCap || updates.entryMarketCap;
            if (entryMcap && currentMarketCap) {
              const pnlPct = ((currentMarketCap / entryMcap) - 1) * 100;
              updates.pnlPct = pnlPct;
              updates.pnlSol = position.entrySol * (pnlPct / 100);
            }
            updatePosition(position.id, updates);
            if (Object.keys(dbUpdates).length > 0) positionApi.updateMetadata(token, position.id, dbUpdates).catch(() => {});
          }
        }
      } catch {}
    });
  }, [openPositions, updatePosition, token]);

  const handleRetryLoad = useCallback(() => { setIsLoading(true); setLoadError(null); setRetryCount(prev => prev + 1); }, []);

  const handleToggleSniper = useCallback(async (sniperId: string, hasInsufficientFunds?: boolean) => {
    if (!token) return;
    const sniper = snipers.find((s) => s.id === sniperId);
    if (!sniper) return;
    if (hasInsufficientFunds && !sniper.isActive) {
      const requiredAmount = sniper.config.snipeAmountSol + sniper.config.priorityFeeSol + 0.002;
      setDepositModalData({ isOpen: true, walletAddress: tradingWallet?.publicKey || '', walletId: tradingWallet?.walletId || sniper.walletId, sniperName: sniper.name, sniperId: sniperId, requiredAmount, currentBalance: tradingWallet?.balanceSol || 0 });
      return;
    }
    try {
      const res = await sniperApi.toggle(token, sniperId);
      if (res.success) { toggleSniper(sniperId); toast.success(`Sniper "${sniper?.name}" ${sniper?.isActive ? 'paused' : 'activated'}`); }
      else throw new Error(res.error);
    } catch { toast.error('Failed to toggle sniper'); }
  }, [token, snipers, tradingWallet, toggleSniper]);

  const handleSellPosition = useCallback(async (positionId: string) => {
    if (!token || sellingPositions.has(positionId)) return;
    setSellingPositions(prev => new Set(Array.from(prev).concat(positionId)));
    try {
      const res = await positionApi.close(token, positionId);
      if (res.success) toast.loading('Selling position...', { id: positionId });
      else throw new Error(res.error);
    } catch {
      toast.error('Failed to sell position');
      setSellingPositions(prev => { const next = new Set(prev); next.delete(positionId); return next; });
    }
  }, [token, sellingPositions]);

  const handleDeleteSniper = useCallback((sniperId: string) => {
    const sniper = snipers.find((s) => s.id === sniperId);
    if (!sniper) return;
    setDeleteDialog({ isOpen: true, sniperId, sniperName: sniper.name });
  }, [snipers]);

  const confirmDeleteSniper = useCallback(async () => {
    if (!token || !deleteDialog) return;
    setIsDeleting(true);
    try {
      const res = await sniperApi.delete(token, deleteDialog.sniperId);
      if (res.success) { removeSniper(deleteDialog.sniperId); toast.success(`Sniper "${deleteDialog.sniperName}" deleted`); setDeleteDialog(null); }
      else throw new Error(res.error);
    } catch { toast.error('Failed to delete sniper'); }
    finally { setIsDeleting(false); }
  }, [token, deleteDialog, removeSniper]);

  const formatMcap = (mcap: number | null | undefined) => {
    if (!mcap) return '—';
    if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(1)}M`;
    if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
    return `$${mcap.toFixed(0)}`;
  };

  const allStoresHydrated = _hasHydrated && snipersHydrated && walletsHydrated;
  if (!mounted || !allStoresHydrated || !isAuthenticated || !token || isLoading) return <DashboardSkeleton />;

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
            <p className="text-zinc-400 text-sm text-center">Unable to connect. Please try again.</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => router.push('/')}>Go Home</Button>
              <Button className="flex-1 bg-orange-500 hover:bg-orange-600 text-black" onClick={handleRetryLoad}><RefreshCw className="w-4 h-4 mr-2" />Retry</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isProfitable = stats.totalPnlSol >= 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Gradient Background Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-orange-500/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[150px]" />
      </div>

      {/* Minimal Top Bar */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-white/5 bg-black/50 backdrop-blur-2xl">
        <div className="h-full max-w-[1600px] mx-auto px-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo size="sm" />
            <span className="font-semibold text-white/90">Bondshot</span>
          </Link>

          <div className="flex items-center gap-2">
            <Link href="/buybacks">
              <Button variant="ghost" size="sm" className="text-white/50 hover:text-white text-xs">$BOND</Button>
            </Link>
            <Link href="/how-it-works">
              <Button variant="ghost" size="sm" className="text-white/50 hover:text-white text-xs">Docs</Button>
            </Link>
            <div className="w-px h-6 bg-white/10 mx-2" />
            <WalletMultiButton />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-14 pb-20 relative z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-6">
          {/* Hero Stats Section - Compact */}
          <div className="mb-6">
            <div className="flex flex-col lg:flex-row gap-4 items-start">
              {/* Main P&L Card - Smaller */}
              <div className={cn(
                "relative rounded-2xl px-6 py-5 border overflow-hidden",
                isProfitable
                  ? "bg-gradient-to-br from-green-950/40 via-green-900/20 to-transparent border-green-500/20"
                  : "bg-gradient-to-br from-red-950/40 via-red-900/20 to-transparent border-red-500/20"
              )}>
                <div className="absolute top-3 right-3">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 border border-white/10">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[10px] text-white/70">Live</span>
                  </div>
                </div>

                <p className="text-xs text-white/50 mb-1">Total P&L</p>
                <div className="flex items-end gap-2">
                  <h1 className={cn(
                    "text-4xl font-bold tracking-tight",
                    isProfitable ? "text-green-400" : "text-red-400"
                  )}>
                    {isProfitable ? '+' : ''}{stats.totalPnlSol.toFixed(3)}
                  </h1>
                  <span className="text-lg text-white/30 mb-1">SOL</span>
                </div>
                <p className={cn(
                  "text-sm mt-1",
                  isProfitable ? "text-green-400/70" : "text-red-400/70"
                )}>
                  {isProfitable ? '+' : ''}{stats.totalPnlPct.toFixed(1)}%
                </p>
              </div>

              {/* Stats Grid - Compact */}
              <div className="flex flex-wrap gap-2 lg:gap-3">
                <div className="bg-white/[0.02] rounded-xl px-4 py-2.5 border border-white/5 backdrop-blur-sm flex items-center gap-3">
                  <Activity className="w-4 h-4 text-orange-400" />
                  <div>
                    <p className="text-lg font-semibold text-white">{openPositions.length}</p>
                    <p className="text-[10px] text-white/40 -mt-0.5">Positions</p>
                  </div>
                </div>
                <div className="bg-white/[0.02] rounded-xl px-4 py-2.5 border border-white/5 backdrop-blur-sm flex items-center gap-3">
                  <Target className="w-4 h-4 text-blue-400" />
                  <div>
                    <p className="text-lg font-semibold text-white">{activeSnipers.length}</p>
                    <p className="text-[10px] text-white/40 -mt-0.5">Active Snipers</p>
                  </div>
                </div>
                <div className="bg-white/[0.02] rounded-xl px-4 py-2.5 border border-white/5 backdrop-blur-sm flex items-center gap-3">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <div>
                    <p className="text-lg font-semibold text-white">{stats.snipesToday}</p>
                    <p className="text-[10px] text-white/40 -mt-0.5">Total Snipes</p>
                  </div>
                </div>
                <div className="bg-white/[0.02] rounded-xl px-4 py-2.5 border border-white/5 backdrop-blur-sm flex items-center gap-3">
                  <BarChart3 className="w-4 h-4 text-purple-400" />
                  <div>
                    <p className="text-lg font-semibold text-white">{stats.successRate}%</p>
                    <p className="text-[10px] text-white/40 -mt-0.5">Success Rate</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Three Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Positions Column */}
            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                  Positions
                </h2>
              </div>

              {openPositions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-12 text-center">
                  <TrendingUp className="w-10 h-10 text-white/20 mx-auto mb-4" />
                  <p className="text-white/40 mb-1">No open positions</p>
                  <p className="text-sm text-white/20">Trades appear when snipers fire</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {openPositions.map((position) => {
                    const pnlPct = position.pnlPct ?? 0;
                    const isProfit = pnlPct > 0;
                    const isLoss = pnlPct < 0;

                    return (
                      <div
                        key={position.id}
                        className={cn(
                          "group relative rounded-2xl border bg-white/[0.02] backdrop-blur-sm p-4 transition-all hover:bg-white/[0.04]",
                          isProfit && "border-green-500/20 hover:border-green-500/30",
                          isLoss && "border-red-500/20 hover:border-red-500/30",
                          !isProfit && !isLoss && "border-white/5"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-sm font-bold text-black shadow-lg shadow-orange-500/20">
                              {position.tokenSymbol?.charAt(0) || '?'}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white">{position.tokenSymbol || position.tokenMint?.slice(0, 6)}</span>
                                <button onClick={() => { navigator.clipboard.writeText(position.tokenMint || ''); toast.success('Copied!'); }} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all">
                                  <Copy className="w-3 h-3 text-white/50" />
                                </button>
                                <a href={`https://dexscreener.com/solana/${position.tokenMint}`} target="_blank" rel="noopener noreferrer" className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all">
                                  <ExternalLink className="w-3 h-3 text-white/50" />
                                </a>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-white/40">
                                <span>{position.entrySol?.toFixed(3)} SOL</span>
                                <span>•</span>
                                <span>{formatMcap(position.currentMarketCap)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className={cn(
                                "text-xl font-bold font-mono",
                                isProfit && "text-green-400",
                                isLoss && "text-red-400",
                                !isProfit && !isLoss && "text-white/40"
                              )}>
                                {isProfit ? '+' : ''}{pnlPct.toFixed(1)}%
                              </p>
                              {position.pnlSol !== undefined && (
                                <p className={cn("text-xs font-mono", isProfit ? "text-green-400/60" : isLoss ? "text-red-400/60" : "text-white/30")}>
                                  {isProfit ? '+' : ''}{position.pnlSol.toFixed(4)}
                                </p>
                              )}
                            </div>
                            <Button
                              size="sm"
                              className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border-0 h-9"
                              onClick={() => handleSellPosition(position.id)}
                              disabled={sellingPositions.has(position.id) || position.status === 'selling'}
                            >
                              {sellingPositions.has(position.id) || position.status === 'selling' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sell'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Snipers Column */}
            <div className="lg:col-span-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Crosshair className="w-5 h-5 text-orange-400" />
                  Snipers
                </h2>
                <Button
                  size="sm"
                  className="bg-orange-500 hover:bg-orange-600 text-black font-semibold h-8"
                  onClick={() => setIsCreateModalOpen(true)}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  New
                </Button>
              </div>

              {snipers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-8 text-center">
                  <Crosshair className="w-10 h-10 text-orange-400/30 mx-auto mb-4" />
                  <p className="text-white/40 mb-1">No snipers yet</p>
                  <p className="text-sm text-white/20 mb-4">Create your first sniper to start</p>
                  <Button className="bg-orange-500 hover:bg-orange-600 text-black" onClick={() => setIsCreateModalOpen(true)}>
                    Create Sniper
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
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

              {/* Wallet Card */}
              <div className="mt-6">
                <WalletBalanceCard />
              </div>
            </div>

            {/* Activity Column */}
            <div className="lg:col-span-3 space-y-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Radio className="w-5 h-5 text-orange-400" />
                Live Feed
              </h2>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm overflow-hidden">
                <ActivityLog />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      <PreAuthSniperModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />

      {depositModalData?.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="bg-zinc-900 border-zinc-700 max-w-md w-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-5 h-5" />
                Deposit Required
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-zinc-300 text-sm">Your sniper &quot;<span className="text-white font-medium">{depositModalData.sniperName}</span>&quot; needs funds.</p>
              <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between text-sm"><span className="text-zinc-400">Current</span><span className="text-red-400 font-medium">{depositModalData.currentBalance.toFixed(4)} SOL</span></div>
                <div className="flex justify-between text-sm"><span className="text-zinc-400">Required</span><span className="text-white font-medium">{depositModalData.requiredAmount.toFixed(4)} SOL</span></div>
                <div className="border-t border-zinc-700 pt-3 flex justify-between text-sm"><span className="text-zinc-400">Need</span><span className="text-amber-400 font-medium">{Math.max(0, depositModalData.requiredAmount - depositModalData.currentBalance).toFixed(4)} SOL</span></div>
              </div>
              <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700">
                <p className="text-xs text-zinc-500 mb-2">Deposit Address</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-orange-400 font-mono flex-1 truncate">{depositModalData.walletAddress}</code>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={async () => { await navigator.clipboard.writeText(depositModalData.walletAddress); toast.success('Copied!'); }}><Copy className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setDepositModalData(null)}>Close</Button>
                <Button className="flex-1 bg-amber-600 hover:bg-amber-700" onClick={async () => { await navigator.clipboard.writeText(depositModalData.walletAddress); toast.success('Address copied!'); setDepositModalData(null); }}><Copy className="w-4 h-4 mr-2" />Copy</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog isOpen={deleteDialog?.isOpen ?? false} onClose={() => setDeleteDialog(null)} onConfirm={confirmDeleteSniper} title={`Delete "${deleteDialog?.sniperName}"?`} description="This will permanently remove this sniper." confirmText="Delete" cancelText="Keep" variant="danger" isLoading={isDeleting} />
    </div>
  );
}
