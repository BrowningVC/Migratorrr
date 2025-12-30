'use client';

import { useState, useEffect, useCallback } from 'react';
import { Copy, Check, RefreshCw, Wallet, ExternalLink } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth';
import { useWalletsStore } from '@/lib/stores/wallets';
import { walletApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import toast from 'react-hot-toast';

interface WalletBalance {
  walletId: string;
  publicKey: string;
  label: string | null;
  walletType: string;
  balanceSol: number;
  error?: string;
}

export function WalletBalanceCard() {
  const { token } = useAuthStore();
  const { wallets } = useWalletsStore();
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const fetchBalances = useCallback(async (showToast = false) => {
    if (!token) return;

    try {
      setIsRefreshing(true);
      const res = await walletApi.getBalances(token);
      if (res.success && res.data) {
        setBalances(res.data);
        if (showToast) {
          toast.success('Balances refreshed');
        }
      }
    } catch (error) {
      console.error('Failed to fetch balances:', error);
      if (showToast) {
        toast.error('Failed to refresh balances');
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token]);

  // Initial fetch
  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchBalances();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchBalances]);

  const handleCopyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      toast.success('Address copied!');
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (error) {
      toast.error('Failed to copy address');
    }
  };

  const handleRefresh = () => {
    fetchBalances(true);
  };

  const openSolscan = (address: string) => {
    window.open(`https://solscan.io/account/${address}`, '_blank');
  };

  // Filter to show only generated (trading) wallets
  const tradingWallets = balances.filter(b => b.walletType === 'generated');
  const totalBalance = tradingWallets.reduce((sum, w) => sum + w.balanceSol, 0);

  if (isLoading) {
    return (
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Wallet className="h-5 w-5 text-green-400" />
            Trading Wallets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-16 bg-zinc-800 rounded-lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (tradingWallets.length === 0) {
    return (
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Wallet className="h-5 w-5 text-green-400" />
            Trading Wallets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-zinc-500 text-sm text-center py-4">
            No trading wallets found. Generate one to start sniping.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Wallet className="h-5 w-5 text-green-400" />
            Trading Wallets
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        {tradingWallets.length > 1 && (
          <p className="text-xs text-zinc-500 mt-1">
            Total: {totalBalance.toFixed(4)} SOL
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {tradingWallets.map((wallet) => (
          <div
            key={wallet.walletId}
            className="bg-zinc-800/50 rounded-lg p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">
                {wallet.label || 'Trading Wallet'}
              </span>
              <span className={`text-lg font-bold ${
                wallet.balanceSol > 0 ? 'text-green-400' : 'text-zinc-400'
              }`}>
                {wallet.balanceSol.toFixed(4)} SOL
              </span>
            </div>

            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-zinc-500 truncate">
                {wallet.publicKey}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopyAddress(wallet.publicKey)}
                className="h-7 w-7 p-0 hover:bg-zinc-700"
                title="Copy address"
              >
                {copiedAddress === wallet.publicKey ? (
                  <Check className="h-3.5 w-3.5 text-green-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openSolscan(wallet.publicKey)}
                className="h-7 w-7 p-0 hover:bg-zinc-700"
                title="View on Solscan"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>

            {wallet.balanceSol === 0 && (
              <div className="bg-yellow-900/20 border border-yellow-800/50 rounded px-2 py-1">
                <p className="text-yellow-400 text-xs">
                  Fund this wallet with SOL to start sniping
                </p>
              </div>
            )}

            {wallet.error && (
              <p className="text-red-400 text-xs">{wallet.error}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
