'use client';

import { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Crosshair, 
  Activity, 
  Target, 
  Zap, 
  BarChart3,
  Radio,
  Copy,
  ExternalLink,
  ArrowUpRight,
  Flame,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { Logo, LogoText } from '@/components/logo';
import { cn } from '@/lib/utils';

// Mock impressive positions for marketing
const MOCK_POSITIONS = [
  { id: 1, symbol: '$GROK', pnlPct: 847.2, pnlSol: 4.236, entrySol: 0.5, mcap: '$2.4M', time: '2m ago', status: 'profit' },
  { id: 2, symbol: '$PEPE2', pnlPct: 312.5, pnlSol: 1.562, entrySol: 0.5, mcap: '$890K', time: '8m ago', status: 'profit' },
  { id: 3, symbol: '$BONK2', pnlPct: 189.3, pnlSol: 0.946, entrySol: 0.5, mcap: '$1.2M', time: '15m ago', status: 'profit' },
  { id: 4, symbol: '$DOGE3', pnlPct: 156.8, pnlSol: 0.784, entrySol: 0.5, mcap: '$650K', time: '23m ago', status: 'profit' },
  { id: 5, symbol: '$WIF2', pnlPct: 94.2, pnlSol: 0.471, entrySol: 0.5, mcap: '$420K', time: '31m ago', status: 'profit' },
];

// Mock snipers
const MOCK_SNIPERS = [
  { id: 1, name: 'Alpha Hunter', isActive: true, snipes: 47, winRate: 89, profit: 12.4 },
  { id: 2, name: 'Degen Mode', isActive: true, snipes: 32, winRate: 78, profit: 8.7 },
  { id: 3, name: 'Safe Plays', isActive: false, snipes: 18, winRate: 94, profit: 5.2 },
];

// Mock activity feed
const MOCK_ACTIVITY = [
  { type: 'snipe', symbol: '$GROK', amount: '0.5 SOL', time: '2m ago', status: 'success' },
  { type: 'tp_hit', symbol: '$MOON', amount: '+2.4 SOL', time: '5m ago', status: 'profit' },
  { type: 'snipe', symbol: '$PEPE2', amount: '0.5 SOL', time: '8m ago', status: 'success' },
  { type: 'tp_hit', symbol: '$CAT', amount: '+1.8 SOL', time: '12m ago', status: 'profit' },
  { type: 'snipe', symbol: '$BONK2', amount: '0.5 SOL', time: '15m ago', status: 'success' },
  { type: 'migration', symbol: '$DOGE3', mcap: '$420K', time: '18m ago', status: 'detected' },
  { type: 'tp_hit', symbol: '$SHIB2', amount: '+3.1 SOL', time: '22m ago', status: 'profit' },
  { type: 'snipe', symbol: '$WIF2', amount: '0.5 SOL', time: '31m ago', status: 'success' },
];

export default function PromoPage() {
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted) return null;

  const stats = {
    totalPnlSol: 26.347,
    totalPnlPct: 438.2,
    openPositions: 5,
    activeSnipers: 2,
    snipesToday: 23,
    successRate: 87,
  };

  return (
    <div className="min-h-screen bg-[#050608] text-white">
      {/* Promo Badge */}
      <div className="fixed top-4 right-4 z-50 bg-orange-500/20 border border-orange-500/30 rounded-full px-4 py-2 backdrop-blur-xl">
        <span className="text-orange-400 text-sm font-medium">Marketing Preview</span>
      </div>

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-black/50 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <LogoText size="sm" />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-white/50">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span>Connected</span>
            </div>
            <div className="bg-zinc-800 rounded-lg px-3 py-1.5 text-sm">
              <span className="text-white/50">Balance:</span>
              <span className="text-white font-semibold ml-2">42.5 SOL</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-14 pb-8 relative">
        {/* Animated background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-20 right-1/4 w-96 h-96 bg-orange-600/5 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        <div className="max-w-[1600px] mx-auto px-4 py-4 relative z-10">
          {/* Hero Stats Section */}
          <div className="mb-6">
            <div className="flex flex-col lg:flex-row gap-3 items-start">
              {/* Main P&L Card */}
              <div className="relative rounded-2xl px-6 py-4 border overflow-hidden bg-gradient-to-br from-orange-950/40 via-orange-900/20 to-transparent border-orange-500/30 shadow-lg shadow-orange-500/10">
                <div className="absolute top-3 right-3">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 border border-orange-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                    <span className="text-[10px] text-orange-400 font-medium">Live</span>
                  </div>
                </div>

                <p className="text-xs text-white/50 mb-1">Total P&L (24h)</p>
                <div className="flex items-end gap-2">
                  <h1 className="text-4xl font-bold tracking-tight text-orange-400">
                    +{stats.totalPnlSol.toFixed(3)}
                  </h1>
                  <span className="text-lg text-white/30 mb-1">SOL</span>
                  <span className="text-sm text-orange-400/80 mb-1 ml-2">
                    (+{stats.totalPnlPct.toFixed(1)}%)
                  </span>
                </div>
                <p className="text-xs text-white/40 mt-2">
                  <span className="text-orange-400">$4,952</span> USD at current prices
                </p>
              </div>

              {/* Stats Grid */}
              <div className="flex flex-wrap gap-2">
                <div className="bg-white/[0.03] rounded-xl px-4 py-3 border border-white/5 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-4 h-4 text-orange-400" />
                    <span className="text-xs text-white/40">Positions</span>
                  </div>
                  <span className="text-2xl font-bold text-white">{stats.openPositions}</span>
                </div>
                <div className="bg-white/[0.03] rounded-xl px-4 py-3 border border-white/5 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="w-4 h-4 text-blue-400" />
                    <span className="text-xs text-white/40">Active</span>
                  </div>
                  <span className="text-2xl font-bold text-white">{stats.activeSnipers}</span>
                </div>
                <div className="bg-white/[0.03] rounded-xl px-4 py-3 border border-white/5 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-white/40">Snipes</span>
                  </div>
                  <span className="text-2xl font-bold text-white">{stats.snipesToday}</span>
                </div>
                <div className="bg-white/[0.03] rounded-xl px-4 py-3 border border-white/5 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-white/40">Win Rate</span>
                  </div>
                  <span className="text-2xl font-bold text-green-400">{stats.successRate}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Three Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Positions Column */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-orange-400" />
                  Open Positions
                  <span className="text-xs text-white/40 font-normal">({MOCK_POSITIONS.length})</span>
                </h2>
              </div>

              <div className="space-y-2">
                {MOCK_POSITIONS.map((position) => (
                  <div
                    key={position.id}
                    className={cn(
                      "group relative rounded-xl border bg-white/[0.02] backdrop-blur-sm px-4 py-3 transition-all hover:bg-white/[0.04]",
                      "border-orange-500/20 hover:border-orange-500/40 hover:shadow-lg hover:shadow-orange-500/5"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-sm font-bold text-black shadow-lg shadow-orange-500/30">
                          {position.symbol.charAt(1)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{position.symbol}</span>
                            <ArrowUpRight className="w-3.5 h-3.5 text-orange-400" />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-white/40">
                            <span>{position.entrySol} SOL</span>
                            <span>•</span>
                            <span>{position.mcap}</span>
                            <span>•</span>
                            <span>{position.time}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-xl font-bold font-mono text-orange-400">
                          +{position.pnlPct.toFixed(1)}%
                        </p>
                        <p className="text-xs font-mono text-orange-400/70">
                          +{position.pnlSol.toFixed(3)} SOL
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Total unrealized */}
              <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">Unrealized P&L</span>
                  <div className="text-right">
                    <span className="text-lg font-bold text-orange-400">+7.999 SOL</span>
                    <span className="text-sm text-white/40 ml-2">($1,504)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Snipers Column */}
            <div className="lg:col-span-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Crosshair className="w-4 h-4 text-orange-400" />
                  Snipers
                </h2>
                <button className="bg-orange-500 hover:bg-orange-600 text-black font-semibold h-7 text-xs px-3 rounded-lg transition-colors">
                  + New
                </button>
              </div>

              <div className="space-y-2">
                {MOCK_SNIPERS.map((sniper) => (
                  <div
                    key={sniper.id}
                    className={cn(
                      "rounded-xl border bg-white/[0.02] backdrop-blur-sm p-4 transition-all",
                      sniper.isActive ? "border-orange-500/30" : "border-white/5"
                    )}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          sniper.isActive ? "bg-orange-500 animate-pulse" : "bg-white/20"
                        )} />
                        <span className="font-medium text-white">{sniper.name}</span>
                      </div>
                      <div className={cn(
                        "px-2 py-0.5 rounded text-xs font-medium",
                        sniper.isActive ? "bg-orange-500/20 text-orange-400" : "bg-white/5 text-white/40"
                      )}>
                        {sniper.isActive ? 'Active' : 'Paused'}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-lg font-bold text-white">{sniper.snipes}</p>
                        <p className="text-[10px] text-white/40">Snipes</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-green-400">{sniper.winRate}%</p>
                        <p className="text-[10px] text-white/40">Win Rate</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-orange-400">+{sniper.profit}</p>
                        <p className="text-[10px] text-white/40">SOL Profit</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Trading Wallet */}
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-white">Trading Wallet</span>
                  <span className="text-xs text-white/40">Auto-generated</span>
                </div>
                <div className="flex items-center justify-between">
                  <code className="text-xs text-white/60 font-mono">7xKX...AsU</code>
                  <div className="text-right">
                    <p className="text-xl font-bold text-white">42.5 SOL</p>
                    <p className="text-xs text-white/40">$7,990 USD</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Activity Column */}
            <div className="lg:col-span-3 space-y-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-orange-400" />
                Live Feed
              </h2>
              
              <div className="rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-sm overflow-hidden">
                <div className="divide-y divide-white/5">
                  {MOCK_ACTIVITY.map((item, i) => (
                    <div key={i} className="px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-2">
                        {item.type === 'snipe' && (
                          <div className="w-6 h-6 rounded-lg bg-blue-500/20 flex items-center justify-center">
                            <Zap className="w-3 h-3 text-blue-400" />
                          </div>
                        )}
                        {item.type === 'tp_hit' && (
                          <div className="w-6 h-6 rounded-lg bg-green-500/20 flex items-center justify-center">
                            <CheckCircle2 className="w-3 h-3 text-green-400" />
                          </div>
                        )}
                        {item.type === 'migration' && (
                          <div className="w-6 h-6 rounded-lg bg-orange-500/20 flex items-center justify-center">
                            <Flame className="w-3 h-3 text-orange-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-white truncate">{item.symbol}</span>
                            {item.type === 'tp_hit' && (
                              <span className="text-xs font-bold text-green-400">{item.amount}</span>
                            )}
                            {item.type === 'snipe' && (
                              <span className="text-xs text-white/40">{item.amount}</span>
                            )}
                            {item.type === 'migration' && (
                              <span className="text-xs text-orange-400">{item.mcap}</span>
                            )}
                          </div>
                          <p className="text-[10px] text-white/30">
                            {item.type === 'snipe' && 'Sniped'}
                            {item.type === 'tp_hit' && 'Take Profit Hit'}
                            {item.type === 'migration' && 'Migration Detected'}
                            {' • '}{item.time}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Performance Summary */}
              <div className="rounded-xl border border-orange-500/20 bg-gradient-to-br from-orange-500/10 to-transparent p-4">
                <h3 className="text-xs font-medium text-white/60 mb-3">Today's Performance</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Total Snipes</span>
                    <span className="text-sm font-bold text-white">23</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Successful</span>
                    <span className="text-sm font-bold text-green-400">20</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Take Profits Hit</span>
                    <span className="text-sm font-bold text-orange-400">18</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <span className="text-xs text-white/60">Net Profit</span>
                    <span className="text-lg font-bold text-orange-400">+26.3 SOL</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom CTA Banner */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/95 to-transparent pt-8 pb-4 px-4 z-30">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-full px-6 py-3 backdrop-blur-xl">
            <Logo size="sm" />
            <span className="text-white font-semibold">Start sniping migrations in under 60 seconds</span>
            <span className="text-orange-400 font-bold">bondshot.xyz</span>
          </div>
        </div>
      </div>
    </div>
  );
}
