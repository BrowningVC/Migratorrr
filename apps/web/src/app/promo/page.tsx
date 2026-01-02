'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Logo, LogoText } from '@/components/logo';
import { cn } from '@/lib/utils';
import {
  Crosshair,
  Shield,
  Check,
  X,
  Radio,
  Copy,
  ExternalLink,
  Bot,
  Info,
  RefreshCw,
  ImageIcon,
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

const MOCK_SNIPERS = [
  {
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
      totalSolSpent: 7.05,
    },
  },
  {
    id: '2',
    name: 'Degen Mode',
    isActive: true,
    config: {
      snipeAmountSol: 0.25,
      slippageBps: 1500,
      priorityFeeSol: 0.008,
      takeProfitPct: 200,
      stopLossPct: 50,
      mevProtection: true,
    },
    stats: {
      totalSnipes: 23,
      successfulSnipes: 19,
      tokensFiltered: 847,
      totalSolSpent: 4.75,
    },
  },
];

const MOCK_MIGRATIONS = [
  { id: '1', symbol: 'AIXBT', time: '2s ago', sniped: true, success: true, tokenMint: 'AIXBT1234...' },
  { id: '2', symbol: 'AI16Z', time: '18s ago', sniped: true, success: true, tokenMint: 'AI16Z5678...' },
  { id: '3', symbol: 'ZEREBRO', time: '34s ago', sniped: false, success: null, tokenMint: 'ZERB9012...' },
  { id: '4', symbol: 'SWARMS', time: '1m ago', sniped: true, success: false, tokenMint: 'SWRM3456...' },
  { id: '5', symbol: 'GRIFFAIN', time: '2m ago', sniped: false, success: null, tokenMint: 'GRIF7890...' },
  { id: '6', symbol: 'MOODENG', time: '3m ago', sniped: true, success: true, tokenMint: 'MOOD1234...' },
  { id: '7', symbol: 'BONK2', time: '4m ago', sniped: false, success: null, tokenMint: 'BONK5678...' },
  { id: '8', symbol: 'POPCAT', time: '5m ago', sniped: true, success: true, tokenMint: 'POPC9012...' },
];

const MOCK_TRADES = [
  { id: '1', sniperName: 'Alpha Hunter', action: 'Bought', token: 'FARTCOIN', time: '14:32:18' },
  { id: '2', sniperName: 'Degen Mode', action: 'Bought', token: 'GOAT', time: '14:09:42' },
  { id: '3', sniperName: 'Alpha Hunter', action: 'TP Hit', token: 'POPCAT', time: '13:47:51' },
  { id: '4', sniperName: 'Degen Mode', action: 'Bought', token: 'PNUT', time: '13:22:08' },
  { id: '5', sniperName: 'Alpha Hunter', action: 'Sold', token: 'MOODENG', time: '12:55:33' },
];

// Mock stats matching the real dashboard structure
const MOCK_STATS = {
  totalPnlSol: 16.26,
  totalPnlPct: 270.4,
  openPositions: 3,
  activeSnipers: 2,
  snipesToday: 70,
  successRate: 86,
  bestTradeSol: 4.12,
  bestTradePct: 1847,
  worstTradeSol: -0.08,
  worstTradePct: -32,
  tokensCaught: 60,
  tokensAvoided: 2131,
  biggestMiss: { ticker: 'TRUMP', athMcap: 14200000000 },
};

export default function PromoPage() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'migrations' | 'trades'>('migrations');
  const [showComingSoon, setShowComingSoon] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const formatMcap = (mcap: number) => {
    if (mcap >= 1_000_000_000) return `$${(mcap / 1_000_000_000).toFixed(1)}B`;
    if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(1)}M`;
    if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
    return `$${mcap.toFixed(0)}`;
  };

  const isProfitable = MOCK_STATS.totalPnlSol >= 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header - matches real dashboard */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Logo size="md" />
                <LogoText size="md" />
              </Link>
              <span className="px-2 py-1 bg-orange-900/30 text-orange-400 text-xs rounded">
                Beta
              </span>
            </div>
            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="text-orange-400 bg-orange-900/20">
                Sniper Dashboard
              </Button>
              <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
                $MIGRATOR Buybacks
              </Button>
              <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
                How it Works
              </Button>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {/* Auth indicator */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-xs text-zinc-400">Signed in:</span>
              <code className="text-xs text-zinc-300 font-mono">7xKX...AsU</code>
            </div>
            <Button variant="outline" size="sm">+ New Sniper</Button>
            <Button className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4">
              Select Wallet
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats - Row 1: Core Stats (matches StatsCards exactly) */}
        <div className="space-y-2">
          <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2">
            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Total P&L</p>
                <p className={cn('text-lg font-bold', isProfitable ? 'text-orange-400' : 'text-red-400')}>
                  +{MOCK_STATS.totalPnlSol.toFixed(4)}
                </p>
                <p className="text-zinc-500 text-[10px]">
                  (+{MOCK_STATS.totalPnlPct.toFixed(2)}%)
                </p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Open Positions</p>
                <p className="text-lg font-bold text-white">{MOCK_STATS.openPositions}</p>
                <p className="text-zinc-500 text-[10px]">Active trades</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Active Snipers</p>
                <p className="text-lg font-bold text-orange-400">{MOCK_STATS.activeSnipers}</p>
                <p className="text-zinc-500 text-[10px]">Watching</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Snipes Today</p>
                <p className="text-lg font-bold text-white">{MOCK_STATS.snipesToday}</p>
                <p className="text-zinc-500 text-[10px]">Last 24h</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Success Rate</p>
                <p className="text-lg font-bold text-white">{MOCK_STATS.successRate}%</p>
                <p className="text-zinc-500 text-[10px]">Tx success</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Status</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
                  <p className="text-sm font-medium text-orange-400">Connected</p>
                </div>
                <p className="text-zinc-500 text-[10px]">Real-time</p>
              </CardContent>
            </Card>
          </div>

          {/* Stats - Row 2: Extended Stats */}
          <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2">
            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Best Trade</p>
                <p className="text-lg font-bold text-orange-400">+{MOCK_STATS.bestTradeSol.toFixed(2)}</p>
                <p className="text-zinc-500 text-[10px]">+{MOCK_STATS.bestTradePct}%</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Worst Trade</p>
                <p className="text-lg font-bold text-red-400">{MOCK_STATS.worstTradeSol.toFixed(2)}</p>
                <p className="text-zinc-500 text-[10px]">{MOCK_STATS.worstTradePct}%</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Tokens Caught</p>
                <p className="text-lg font-bold text-orange-400">{MOCK_STATS.tokensCaught}</p>
                <p className="text-zinc-500 text-[10px]">Sniped</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Tokens Avoided</p>
                <p className="text-lg font-bold text-yellow-400">{MOCK_STATS.tokensAvoided}</p>
                <p className="text-zinc-500 text-[10px]">Filtered</p>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 col-span-2">
              <CardContent className="p-3">
                <p className="text-zinc-500 text-xs mb-0.5">Biggest Miss</p>
                <p className="text-lg font-bold text-orange-400">${MOCK_STATS.biggestMiss.ticker}</p>
                <p className="text-zinc-500 text-[10px]">{formatMcap(MOCK_STATS.biggestMiss.athMcap)}</p>
              </CardContent>
            </Card>

            <Card
              className="bg-zinc-900/50 border-zinc-800 hover:border-orange-800/50 transition-colors cursor-pointer group col-span-2"
              onClick={() => setShowComingSoon(true)}
            >
              <CardContent className="p-3 flex flex-col items-center justify-center h-full">
                <div className="w-8 h-8 rounded-full bg-orange-900/30 flex items-center justify-center mb-1 group-hover:bg-orange-900/50 transition-colors">
                  <ImageIcon className="w-4 h-4 text-orange-400" />
                </div>
                <p className="text-xs font-medium text-orange-400">Share Results</p>
                <p className="text-zinc-500 text-[10px]">Show off gains</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Positions + Snipers */}
          <div className="lg:col-span-2 space-y-4">
            {/* Open Positions - matches real dashboard table */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold">
                  Open Positions ({MOCK_POSITIONS.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border border-zinc-800 rounded-lg overflow-hidden">
                  {/* Table Header - 7 columns like real dashboard */}
                  <div className="grid grid-cols-[2fr_1fr_1.2fr_1.2fr_1fr_1.2fr_80px] gap-3 px-4 py-3 text-xs font-medium text-zinc-400 bg-zinc-800/50 border-b border-zinc-800">
                    <div>Token</div>
                    <div className="text-right">Amount (SOL)</div>
                    <div className="text-right">Entry MCAP</div>
                    <div className="text-right">Current MCAP</div>
                    <div className="text-right">P&L (%)</div>
                    <div className="text-right">Entry Time</div>
                    <div className="text-right">Action</div>
                  </div>
                  {/* Rows */}
                  {MOCK_POSITIONS.map((position) => (
                    <div
                      key={position.id}
                      className="grid grid-cols-[2fr_1fr_1.2fr_1.2fr_1fr_1.2fr_80px] gap-3 px-4 py-3 items-center text-sm border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-[10px] font-bold text-black shrink-0">
                          {position.tokenSymbol.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-white truncate">${position.tokenSymbol}</p>
                            <button className="p-1 hover:bg-zinc-700 rounded transition-colors">
                              <Copy className="w-3 h-3 text-zinc-500 hover:text-zinc-300" />
                            </button>
                            <button className="p-1 hover:bg-zinc-700 rounded transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500 hover:text-zinc-300">
                                <path d="M3 3v18h18"/>
                                <path d="m19 9-5 5-4-4-3 3"/>
                              </svg>
                            </button>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-mono">
                            {position.tokenMint.slice(0, 4)}...{position.tokenMint.slice(-4)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-white">{position.entrySol.toFixed(3)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-zinc-300">{formatMcap(position.entryMarketCap)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-zinc-300">{formatMcap(position.currentMarketCap)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-orange-400">+{position.pnlPct.toFixed(1)}%</p>
                        <p className="text-[10px] text-orange-400/70">+{position.pnlSol.toFixed(4)} SOL</p>
                      </div>
                      <div className="text-right">
                        <p className="text-zinc-400 text-xs">
                          {new Date(position.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-3 text-xs border-red-800 text-red-400 hover:bg-red-900/30"
                        >
                          Sell All
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Snipers - matches real dashboard grid layout */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center justify-between">
                  <span>
                    Snipers ({MOCK_SNIPERS.filter(s => s.isActive).length}/{MOCK_SNIPERS.length} active)
                  </span>
                  <Button variant="ghost" size="sm">+ New</Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {MOCK_SNIPERS.map((sniper) => (
                    <div
                      key={sniper.id}
                      className={cn(
                        'bg-zinc-800/30 rounded-xl border p-4',
                        sniper.isActive ? 'border-orange-500/30' : 'border-zinc-700/50'
                      )}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'w-10 h-10 rounded-lg flex items-center justify-center',
                            sniper.isActive ? 'bg-orange-500/20' : 'bg-zinc-700/30'
                          )}>
                            <Crosshair className={cn('w-5 h-5', sniper.isActive ? 'text-orange-400' : 'text-zinc-500')} />
                          </div>
                          <div>
                            <h3 className="font-semibold text-white">{sniper.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={cn(
                                'px-2 py-0.5 text-xs rounded-full flex items-center gap-1',
                                sniper.isActive
                                  ? 'bg-orange-500/20 text-orange-400'
                                  : 'bg-zinc-700/50 text-zinc-400'
                              )}>
                                {sniper.isActive && <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />}
                                {sniper.isActive ? 'Active' : 'Paused'}
                              </span>
                              <span className="text-xs text-zinc-500">
                                {Math.round((sniper.stats.successfulSnipes / sniper.stats.totalSnipes) * 100)}% success
                              </span>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className={sniper.isActive ? 'border-red-800 text-red-400' : 'border-orange-800 text-orange-400'}
                        >
                          {sniper.isActive ? 'Pause' : 'Start'}
                        </Button>
                      </div>

                      {/* Stats Grid */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-zinc-900/50 rounded-lg p-2.5 text-center">
                          <p className="text-zinc-500 text-[10px] mb-0.5">Snipes</p>
                          <p className="font-medium text-white text-sm">{sniper.stats.totalSnipes}</p>
                        </div>
                        <div className="bg-zinc-900/50 rounded-lg p-2.5 text-center">
                          <p className="text-zinc-500 text-[10px] mb-0.5">Win Rate</p>
                          <p className="font-medium text-orange-400 text-sm">
                            {Math.round((sniper.stats.successfulSnipes / sniper.stats.totalSnipes) * 100)}%
                          </p>
                        </div>
                        <div className="bg-zinc-900/50 rounded-lg p-2.5 text-center">
                          <p className="text-zinc-500 text-[10px] mb-0.5">SOL Spent</p>
                          <p className="font-medium text-white text-sm">{sniper.stats.totalSolSpent.toFixed(2)}</p>
                        </div>
                      </div>

                      {/* Config Display */}
                      <div className="flex flex-wrap gap-1.5 text-[10px]">
                        <span className="px-2 py-1 bg-zinc-800 rounded text-zinc-400">
                          {sniper.config.snipeAmountSol} SOL
                        </span>
                        <span className="px-2 py-1 bg-zinc-800 rounded text-zinc-400">
                          {(sniper.config.slippageBps / 100)}% slip
                        </span>
                        <span className="px-2 py-1 bg-zinc-800 rounded text-orange-400">
                          TP: +{sniper.config.takeProfitPct}%
                        </span>
                        <span className="px-2 py-1 bg-zinc-800 rounded text-red-400">
                          SL: -{sniper.config.stopLossPct}%
                        </span>
                        {sniper.config.mevProtection && (
                          <span className="px-2 py-1 bg-orange-900/30 rounded text-orange-400 flex items-center gap-1">
                            <Shield className="w-2.5 h-2.5" /> Jito
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            {/* Trading Wallets - matches WalletBalanceCard */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <Bot className="h-5 w-5 text-orange-400" />
                    Trading Wallets
                    <Info className="h-3.5 w-3.5 text-zinc-500 cursor-help" />
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-300">Trading Wallet</span>
                    <span className="text-lg font-bold text-orange-400">1.847 SOL</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono text-zinc-500 truncate">
                      7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
                    </code>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:bg-zinc-700">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:bg-zinc-700">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Activity Log - matches ActivityLog component */}
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Radio className="w-5 h-5 text-orange-400" />
                  Activity Log
                </CardTitle>
                {/* Tabs */}
                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => setActiveTab('migrations')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                      activeTab === 'migrations'
                        ? 'bg-orange-900/30 text-orange-400 border border-orange-700/50'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    )}
                  >
                    PumpFun Migrations
                    <span className="ml-1.5 px-1.5 py-0.5 bg-zinc-700 rounded-full text-[10px]">
                      {MOCK_MIGRATIONS.length}
                    </span>
                  </button>
                  <button
                    onClick={() => setActiveTab('trades')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                      activeTab === 'trades'
                        ? 'bg-orange-900/30 text-orange-400 border border-orange-700/50'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    )}
                  >
                    Trades
                    <span className="ml-1.5 px-1.5 py-0.5 bg-zinc-700 rounded-full text-[10px]">
                      {MOCK_TRADES.length}
                    </span>
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[400px] overflow-y-auto space-y-2">
                  {activeTab === 'migrations' ? (
                    // Migrations Tab
                    MOCK_MIGRATIONS.map((m, i) => (
                      <div
                        key={m.id}
                        className={cn(
                          'flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg transition-all',
                          i === 0 ? 'bg-orange-900/20' : 'bg-zinc-800/50 hover:bg-zinc-800'
                        )}
                      >
                        {/* Ticker with copy + Solscan */}
                        <div className="flex items-center gap-2 min-w-0">
                          {i === 0 && (
                            <span className="w-2 h-2 bg-orange-400 rounded-full animate-pulse flex-shrink-0" />
                          )}
                          <code className="text-sm font-medium text-zinc-200 truncate">
                            ${m.symbol}
                          </code>
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button className="p-1 hover:bg-zinc-700 rounded transition-colors">
                              <Copy className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
                            </button>
                            <button className="p-1 hover:bg-zinc-700 rounded transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-zinc-500 hover:stroke-zinc-300">
                                <path d="M3 3v18h18"/>
                                <path d="m19 9-5 5-4-4-3 3"/>
                              </svg>
                            </button>
                            <button className="p-1 hover:bg-zinc-700 rounded transition-colors">
                              <ExternalLink className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
                            </button>
                          </div>
                        </div>

                        {/* Time + Sniped status */}
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-xs text-zinc-500">{m.time}</span>
                          {m.sniped ? (
                            m.success ? (
                              <div className="w-5 h-5 rounded-full bg-orange-900/50 flex items-center justify-center">
                                <Check className="w-3 h-3 text-orange-400" />
                              </div>
                            ) : m.success === false ? (
                              <div className="w-5 h-5 rounded-full bg-red-900/50 flex items-center justify-center">
                                <X className="w-3 h-3 text-red-400" />
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-yellow-900/50 flex items-center justify-center animate-pulse">
                                <div className="w-2 h-2 rounded-full bg-yellow-400" />
                              </div>
                            )
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center">
                              <span className="text-zinc-600 text-xs">—</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    // Trades Tab
                    MOCK_TRADES.map((trade) => (
                      <div
                        key={trade.id}
                        className="flex items-center gap-3 text-sm py-2.5 px-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
                      >
                        <Crosshair className={cn(
                          'w-4 h-4 flex-shrink-0',
                          trade.action === 'Bought' ? 'text-orange-400' :
                          trade.action === 'TP Hit' ? 'text-orange-400' :
                          trade.action === 'SL Hit' ? 'text-red-400' : 'text-red-400'
                        )} />
                        <div className="flex-1 min-w-0 flex items-center gap-1.5">
                          <span className="text-zinc-200 font-medium truncate">{trade.sniperName}</span>
                          <span className={cn(
                            'font-medium',
                            trade.action === 'Bought' ? 'text-orange-400' :
                            trade.action === 'TP Hit' ? 'text-orange-400' :
                            trade.action === 'SL Hit' ? 'text-red-400' : 'text-red-400'
                          )}>{trade.action}</span>
                          <span className="text-zinc-300">${trade.token}</span>
                        </div>
                        <span className="text-zinc-500 text-xs flex-shrink-0">{trade.time}</span>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Floating badge for screenshots */}
      <div className="fixed bottom-4 right-4 px-4 py-2 bg-zinc-900/90 border border-zinc-700 rounded-full text-sm flex items-center gap-2 backdrop-blur">
        <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse" />
        <span className="text-zinc-400">migratorrr.xyz</span>
      </div>

      {/* Coming Soon Modal */}
      {showComingSoon && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowComingSoon(false)}>
          <Card className="bg-zinc-900 border-zinc-700 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <CardContent className="p-6 text-center">
              <button
                onClick={() => setShowComingSoon(false)}
                className="absolute top-3 right-3 text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-16 h-16 rounded-full bg-orange-900/30 flex items-center justify-center mx-auto mb-4">
                <ImageIcon className="w-8 h-8 text-orange-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Coming Soon</h3>
              <p className="text-zinc-400 text-sm">
                Share your trading results with a beautiful card image. This feature is under development.
              </p>
              <Button
                className="mt-4 bg-orange-600 hover:bg-orange-700"
                onClick={() => setShowComingSoon(false)}
              >
                Got it
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
