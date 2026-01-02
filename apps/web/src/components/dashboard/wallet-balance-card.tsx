'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Copy, Check, RefreshCw, Wallet, ExternalLink, Info, Bot, ArrowUpRight, X, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth';
import { useWalletsStore } from '@/lib/stores/wallets';
import { walletApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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

  // Withdraw state
  const [withdrawWalletId, setWithdrawWalletId] = useState<string | null>(null);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

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
    } catch {
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

  const handleCopyAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      toast.success('Address copied!');
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch {
      toast.error('Failed to copy address');
    }
  }, []);

  const handleRefresh = () => {
    fetchBalances(true);
  };

  const openSolscan = (address: string) => {
    window.open(`https://solscan.io/account/${address}`, '_blank');
  };

  const handleWithdraw = async (walletId: string) => {
    if (!token || !withdrawAddress || !withdrawAmount) return;

    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    // Basic Solana address validation
    if (withdrawAddress.length < 32 || withdrawAddress.length > 44) {
      toast.error('Invalid Solana address');
      return;
    }

    setIsWithdrawing(true);
    try {
      const res = await walletApi.withdraw(token, walletId, withdrawAddress, amount);
      if (res.success && res.data) {
        toast.success(
          <div>
            <p>Withdrew {res.data.amountSol} SOL</p>
            <a
              href={res.data.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-400 underline text-xs"
            >
              View transaction
            </a>
          </div>,
          { duration: 6000 }
        );
        // Reset form and refresh balances
        setWithdrawWalletId(null);
        setWithdrawAddress('');
        setWithdrawAmount('');
        fetchBalances();
      } else {
        toast.error(res.error || 'Withdrawal failed');
      }
    } catch {
      toast.error('Withdrawal failed');
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleMaxAmount = (balance: number) => {
    // Leave a small amount for fees (0.001 SOL)
    const maxAmount = Math.max(0, balance - 0.001);
    setWithdrawAmount(maxAmount.toFixed(6));
  };

  // Memoize filtered wallets and total
  const { tradingWallets, totalBalance } = useMemo(() => {
    const filtered = balances.filter(b => b.walletType === 'generated');
    const total = filtered.reduce((sum, w) => sum + w.balanceSol, 0);
    return { tradingWallets: filtered, totalBalance: total };
  }, [balances]);

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
            <Bot className="h-5 w-5 text-green-400" />
            Trading Wallets
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-zinc-500 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs bg-zinc-800 border-zinc-700">
                  <p className="text-xs text-zinc-300">
                    <span className="font-semibold text-green-400">Server-controlled wallet</span> for automated trading.
                    Fund this wallet with SOL — the server uses it to execute snipes automatically when migrations are detected.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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

            {/* Withdraw Section */}
            {wallet.balanceSol > 0 && (
              <>
                {withdrawWalletId === wallet.walletId ? (
                  <div className="mt-3 pt-3 border-t border-zinc-700/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Withdraw SOL</span>
                      <button
                        onClick={() => {
                          setWithdrawWalletId(null);
                          setWithdrawAddress('');
                          setWithdrawAmount('');
                        }}
                        className="text-zinc-500 hover:text-zinc-300"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Destination address"
                      value={withdrawAddress}
                      onChange={(e) => setWithdrawAddress(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-green-600"
                    />
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type="number"
                          placeholder="Amount"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          step="0.0001"
                          min="0"
                          max={wallet.balanceSol}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-green-600 pr-14"
                        />
                        <button
                          onClick={() => handleMaxAmount(wallet.balanceSol)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-green-400 hover:text-green-300 font-medium"
                        >
                          MAX
                        </button>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleWithdraw(wallet.walletId)}
                        disabled={isWithdrawing || !withdrawAddress || !withdrawAmount}
                        className="h-7 px-3 bg-green-600 hover:bg-green-700 text-xs"
                      >
                        {isWithdrawing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Send'
                        )}
                      </Button>
                    </div>
                    <p className="text-[10px] text-zinc-500">
                      Available: {wallet.balanceSol.toFixed(6)} SOL (fee ~0.000005)
                    </p>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setWithdrawWalletId(wallet.walletId)}
                    className="w-full mt-2 h-7 text-xs text-zinc-400 hover:text-green-400 hover:bg-zinc-700/50 gap-1.5"
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    Withdraw
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
