'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Logo, LogoText } from '@/components/logo';
import { cn } from '@/lib/utils';
import {
  Crosshair,
  TrendingUp,
  Zap,
  Shield,
  Check,
  Radio,
  Wallet,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Copy,
  ExternalLink,
} from 'lucide-react';

// Mock data for promotional screenshots - Real tokens that hit $1M+ ATH
const MOCK_POSITIONS = [
  {
    id: '1',
    tokenSymbol: 'FARTCOIN',
    tokenMint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
    entrySol: 0.25,
    entryMarketCap: 68000,
    currentMarketCap: 2400000,
    pnlPct: 3429.4,
    pnlSol: 8.57,
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
  },
  {
    id: '2',
    tokenSymbol: 'GOAT',
    tokenMint: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump',
    entrySol: 0.2,
    entryMarketCap: 72000,
    currentMarketCap: 1850000,
    pnlPct: 2469.4,
    pnlSol: 4.94,
    createdAt: new Date(Date.now() - 1000 * 60 * 23).toISOString(),
  },
  {
    id: '3',
    tokenSymbol: 'PNUT',
    tokenMint: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump',
    entrySol: 0.15,
    entryMarketCap: 58000,
    currentMarketCap: 1120000,
    pnlPct: 1831.0,
    pnlSol: 2.75,
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
];

const MOCK_SNIPER = {
  id: '1',
  name: 'Alpha Hunter',
  isActive: true,
  config: {
    snipeAmountSol: 0.15,
    slippageBps: 1000,
    priorityFeeSol: 0.005,
    takeProfitPct: 150,
    stopLossPct: 40,
    mevProtection: true,
  },
  stats: {
    totalSnipes: 47,
    successfulSnipes: 41,
    tokensFiltered: 1284,
  },
};

const MOCK_MIGRATIONS = [
  { symbol: 'AIXBT', time: '2s ago' },
  { symbol: 'AI16Z', time: '18s ago' },
  { symbol: 'ZEREBRO', time: '34s ago' },
  { symbol: 'SWARMS', time: '1m ago' },
  { symbol: 'GRIFFAIN', time: '2m ago' },
];

const MOCK_ACTIVITY = [
  { type: 'buy', token: 'FARTCOIN', amount: '0.25 SOL', time: '8m ago', status: 'success' },
  { type: 'buy', token: 'GOAT', amount: '0.20 SOL', time: '23m ago', status: 'success' },
  { type: 'sell', token: 'POPCAT', amount: '4.12 SOL', time: '1h ago', status: 'success', pnl: '+1,847%' },
  { type: 'buy', token: 'PNUT', amount: '0.15 SOL', time: '45m ago', status: 'success' },
  { type: 'filtered', token: 'RUGPULL', reason: 'Dev holds 67%', time: '1h ago' },
];

export default function PromoPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const formatMcap = (mcap: number) => {
    if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(1)}M`;
    if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
    return `$${mcap.toFixed(0)}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <Logo size="md" />
              <LogoText size="md" />
              <span className="px-2 py-1 bg-green-900/30 text-green-400 text-xs rounded">
                Live
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-zinc-400">Connected</span>
              <code className="text-xs text-zinc-300 font-mono">7xKX...AsU</code>
            </div>
            <Button variant="outline" size="sm">+ New Sniper</Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-sm">Total P&L</span>
                <TrendingUp className="w-4 h-4 text-green-400" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-green-400">+16.26 SOL</span>
                <span className="text-green-400 text-sm ml-2">+2,710%</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-sm">Open Positions</span>
                <Activity className="w-4 h-4 text-blue-400" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-white">3</span>
                <span className="text-zinc-500 text-sm ml-2">active</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-sm">Success Rate</span>
                <Check className="w-4 h-4 text-green-400" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-white">87%</span>
                <span className="text-zinc-500 text-sm ml-2">41/47</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-sm">Tokens Filtered</span>
                <Shield className="w-4 h-4 text-amber-400" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-white">1,284</span>
                <span className="text-zinc-500 text-sm ml-2">saved</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Positions + Sniper */}
          <div className="lg:col-span-2 space-y-4">
            {/* Open Positions */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center justify-between">
                  <span>Open Positions (3)</span>
                  <span className="text-green-400 text-sm font-normal">+16.26 SOL</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border border-zinc-800 rounded-lg overflow-hidden">
                  {/* Table Header */}
                  <div className="grid grid-cols-[2fr_1fr_1.2fr_1.2fr_1fr_80px] gap-3 px-4 py-3 text-xs font-medium text-zinc-400 bg-zinc-800/50 border-b border-zinc-800">
                    <div>Token</div>
                    <div className="text-right">Entry</div>
                    <div className="text-right">Entry MCAP</div>
                    <div className="text-right">Current</div>
                    <div className="text-right">P&L</div>
                    <div className="text-right">Action</div>
                  </div>
                  {/* Rows */}
                  {MOCK_POSITIONS.map((position) => (
                    <div
                      key={position.id}
                      className="grid grid-cols-[2fr_1fr_1.2fr_1.2fr_1fr_80px] gap-3 px-4 py-3 items-center text-sm border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-[10px] font-bold text-black shrink-0">
                          {position.tokenSymbol.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-white">${position.tokenSymbol}</p>
                          <p className="text-[10px] text-zinc-500 font-mono">
                            {position.tokenMint.slice(0, 4)}...{position.tokenMint.slice(-4)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-white">{position.entrySol.toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-zinc-300">{formatMcap(position.entryMarketCap)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-zinc-300">{formatMcap(position.currentMarketCap)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-green-400">
                          +{position.pnlPct.toFixed(1)}%
                        </p>
                      </div>
                      <div className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-3 text-xs border-red-800 text-red-400 hover:bg-red-900/30"
                        >
                          Sell
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Active Sniper */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold">Active Sniper</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-zinc-800/30 rounded-xl border border-green-500/30 p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                        <Crosshair className="w-5 h-5 text-green-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">{MOCK_SNIPER.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full flex items-center gap-1">
                            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                            Active
                          </span>
                          <span className="text-xs text-zinc-500">87% success</span>
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="border-red-800 text-red-400">
                      Pause
                    </Button>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="bg-zinc-900/50 rounded-lg p-3">
                      <p className="text-zinc-500 text-xs mb-1">Buy Amount</p>
                      <p className="font-medium text-white">{MOCK_SNIPER.config.snipeAmountSol} SOL</p>
                    </div>
                    <div className="bg-zinc-900/50 rounded-lg p-3">
                      <p className="text-zinc-500 text-xs mb-1">Take Profit</p>
                      <p className="font-medium text-green-400">+{MOCK_SNIPER.config.takeProfitPct}%</p>
                    </div>
                    <div className="bg-zinc-900/50 rounded-lg p-3">
                      <p className="text-zinc-500 text-xs mb-1">Stop Loss</p>
                      <p className="font-medium text-red-400">-{MOCK_SNIPER.config.stopLossPct}%</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
                    <Shield className="w-3.5 h-3.5 text-green-400" />
                    <span>Jito MEV Protection enabled</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Wallet Balance */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-green-400" />
                  Trading Wallet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white">1.847</span>
                  <span className="text-zinc-400">SOL</span>
                </div>
                <p className="text-xs text-zinc-500 mt-1 font-mono">
                  7xKX...JSDp...AsU
                </p>
              </CardContent>
            </Card>

            {/* Live Migrations */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Radio className="w-4 h-4 text-green-400 animate-pulse" />
                  Live Migrations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {MOCK_MIGRATIONS.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center justify-between py-2 px-3 rounded-lg text-sm",
                      i === 0 ? "bg-green-500/10 border border-green-500/30" : "bg-zinc-800/30"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {i === 0 && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
                      <span className={i === 0 ? "text-green-400 font-medium" : "text-zinc-300"}>
                        ${m.symbol}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-500">{m.time}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Activity */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-400" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {MOCK_ACTIVITY.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-2">
                      {a.type === 'buy' && <ArrowDownRight className="w-4 h-4 text-green-400" />}
                      {a.type === 'sell' && <ArrowUpRight className="w-4 h-4 text-blue-400" />}
                      {a.type === 'filtered' && <Shield className="w-4 h-4 text-amber-400" />}
                      <div>
                        <p className="text-zinc-300">
                          {a.type === 'filtered' ? 'Filtered' : a.type === 'buy' ? 'Bought' : 'Sold'}{' '}
                          <span className="font-medium text-white">${a.token}</span>
                        </p>
                        {a.type === 'filtered' && (
                          <p className="text-[10px] text-amber-400">{a.reason}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      {a.pnl && <p className="text-green-400 font-medium">{a.pnl}</p>}
                      {a.amount && <p className="text-xs text-zinc-400">{a.amount}</p>}
                      <p className="text-[10px] text-zinc-500">{a.time}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Floating badge for screenshots */}
      <div className="fixed bottom-4 right-4 px-4 py-2 bg-zinc-900/90 border border-zinc-700 rounded-full text-sm flex items-center gap-2 backdrop-blur">
        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
        <span className="text-zinc-400">migratorrr.com</span>
      </div>
    </div>
  );
}
