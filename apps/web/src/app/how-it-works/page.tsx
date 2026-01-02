'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import {
  ArrowRight,
  Zap,
  Shield,
  TrendingUp,
  Activity,
  Target,
  Wallet,
  Settings,
  Filter,
  Bell,
  Clock,
  Users,
  Globe,
  Lock,
  DollarSign,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Crosshair,
  Eye,
  Layers,
  RefreshCw,
  ChevronRight,
  Flame,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo, LogoText } from '@/components/logo';
import { cn } from '@/lib/utils';

const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

export default function HowItWorksPage() {
  const { connected } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    setMounted(true);
  }, []);

  const WalletButton = mounted ? (
    <WalletMultiButton />
  ) : (
    <div className="h-10 w-32 bg-zinc-800 rounded animate-pulse" />
  );

  const sections = [
    { id: 'overview', label: 'Overview', icon: Eye },
    { id: 'detection', label: 'Migration Detection', icon: Zap },
    { id: 'snipers', label: 'Sniper Configuration', icon: Crosshair },
    { id: 'filters', label: 'Token Filters', icon: Filter },
    { id: 'execution', label: 'Trade Execution', icon: Target },
    { id: 'exit', label: 'Exit Strategies', icon: TrendingUp },
    { id: 'protection', label: 'MEV Protection', icon: Shield },
    { id: 'monitoring', label: 'Monitoring & Alerts', icon: Activity },
    { id: 'buybacks', label: '$BOND Buybacks', icon: Flame },
    { id: 'fees', label: 'Fees & Costs', icon: DollarSign },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Logo size="md" />
            <LogoText size="md" />
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost">Sniper Dashboard</Button>
            </Link>
            <Link href="/buybacks">
              <Button variant="ghost">$BOND Buybacks</Button>
            </Link>
            <Link href="/how-it-works">
              <Button variant="ghost" className="text-primary">How it Works</Button>
            </Link>
            {WalletButton}
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar Navigation */}
          <aside className="lg:w-64 shrink-0">
            <div className="lg:sticky lg:top-24">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Documentation
              </h2>
              <nav className="space-y-1">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                        activeSection === section.id
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {section.label}
                    </a>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 max-w-4xl">
            {/* Page Header */}
            <div className="mb-12">
              <h1 className="text-4xl font-bold mb-4">How Bondshot Works</h1>
              <p className="text-lg text-muted-foreground">
                A comprehensive guide to automated token sniping on Solana. Learn how to configure
                snipers, set filters, and maximize your trading efficiency.
              </p>
            </div>

            {/* Overview Section */}
            <Section id="overview" title="Overview" icon={Eye}>
              <p className="text-muted-foreground mb-6">
                Bondshot is an automated trading platform that monitors PumpFun token migrations
                to Raydium and PumpSwap, executing trades based on your configured strategies. Here&apos;s the
                high-level flow:
              </p>

              <div className="grid md:grid-cols-4 gap-4 mb-8">
                <FlowStep
                  number={1}
                  title="Configure"
                  description="Set up your sniper with buy amounts, exit strategies, and filters"
                  icon={Settings}
                />
                <FlowStep
                  number={2}
                  title="Fund"
                  description="Deposit SOL to your dedicated sniper wallet"
                  icon={Wallet}
                />
                <FlowStep
                  number={3}
                  title="Activate"
                  description="Turn on your sniper to start monitoring migrations"
                  icon={Zap}
                />
                <FlowStep
                  number={4}
                  title="Automate"
                  description="Trades execute automatically based on your rules"
                  icon={RefreshCw}
                />
              </div>

              <InfoBox type="info" title="What is a Migration?">
                When a token on PumpFun completes its bonding curve (reaches ~$69k market cap),
                it &quot;graduates&quot; and migrates to either Raydium or PumpSwap DEX. This is when
                liquidity is added and the token becomes freely tradeable. Only ~1.4% of PumpFun
                tokens ever reach this milestone.
              </InfoBox>
            </Section>

            {/* Migration Detection Section */}
            <Section id="detection" title="Migration Detection" icon={Zap}>
              <p className="text-muted-foreground mb-6">
                Speed is everything in token sniping. Bondshot uses real-time WebSocket streaming
                to catch migrations as fast as possible.
              </p>

              <div className="grid md:grid-cols-3 gap-4 mb-6">
                <FeatureBox
                  icon={Layers}
                  title="WebSocket Streaming"
                  description="Real-time transaction monitoring via Helius WebSocket for instant detection"
                />
                <FeatureBox
                  icon={RefreshCw}
                  title="Multi-DEX Support"
                  description="Monitors both Raydium and PumpSwap migrations automatically"
                />
                <FeatureBox
                  icon={Activity}
                  title="Event Deduplication"
                  description="Smart deduplication prevents duplicate trades on the same token"
                />
              </div>

              <div className="bg-card border border-border rounded-xl p-6 mb-6">
                <h4 className="font-semibold mb-4 flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Detection Timeline
                </h4>
                <div className="space-y-3">
                  <TimelineItem
                    time="0ms"
                    event="Migration transaction detected on Solana"
                    highlight
                  />
                  <TimelineItem
                    time="~50ms"
                    event="Transaction parsed and validated (Raydium or PumpSwap)"
                  />
                  <TimelineItem
                    time="~100ms"
                    event="Token info enriched (name, symbol, liquidity, market cap)"
                  />
                  <TimelineItem
                    time="~150ms"
                    event="Matched against active sniper configurations"
                  />
                  <TimelineItem
                    time="~200ms"
                    event="Buy transaction submitted via Jito"
                    highlight
                  />
                </div>
              </div>

              <InfoBox type="success" title="Sub-500ms Execution">
                From migration detection to trade execution, the entire process typically
                completes in under 500 milliseconds, giving you a significant advantage
                over manual traders.
              </InfoBox>
            </Section>

            {/* Sniper Configuration Section */}
            <Section id="snipers" title="Sniper Configuration" icon={Crosshair}>
              <p className="text-muted-foreground mb-6">
                Each sniper is a self-contained trading bot with its own wallet, settings, and
                strategies. You can run multiple snipers with different configurations.
              </p>

              <h4 className="font-semibold mb-4">Buy Settings</h4>
              <div className="bg-card border border-border rounded-xl overflow-hidden mb-6">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm font-medium">Setting</th>
                      <th className="text-left px-4 py-3 text-sm font-medium">Description</th>
                      <th className="text-left px-4 py-3 text-sm font-medium">Recommended</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="px-4 py-3 font-medium">Snipe Amount</td>
                      <td className="px-4 py-3 text-muted-foreground text-sm">
                        SOL to spend per snipe (excluding fees). Minimum 0.1 SOL.
                      </td>
                      <td className="px-4 py-3 text-sm">0.1 - 1 SOL</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium">Slippage Tolerance</td>
                      <td className="px-4 py-3 text-muted-foreground text-sm">
                        Maximum price difference allowed from quote. Minimum 10%.
                      </td>
                      <td className="px-4 py-3 text-sm">10-20%</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium">Priority Fee</td>
                      <td className="px-4 py-3 text-muted-foreground text-sm">
                        Jito tip for faster transaction inclusion. Minimum 0.003 SOL.
                      </td>
                      <td className="px-4 py-3 text-sm">0.003-0.01 SOL</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <InfoBox type="warning" title="Slippage Considerations">
                Higher slippage increases the chance of your trade executing but may result in
                worse prices. For newly migrated tokens with high volatility, 10-20% is typical.
                Lower slippage may cause failed transactions.
              </InfoBox>
            </Section>

            {/* Token Filters Section */}
            <Section id="filters" title="Token Filters" icon={Filter}>
              <p className="text-muted-foreground mb-6">
                Filters help you avoid low-quality tokens and focus on migrations that match
                your criteria. All filters are optional—tokens pass by default if no filter is set.
              </p>

              <div className="space-y-6">
                {/* Migration Speed Filter */}
                <FilterCard
                  title="Migration Speed"
                  icon={Clock}
                  description="Filter by how quickly the token completed its bonding curve"
                  options={['≤5 min', '≤15 min', '≤1 hour', '≤6 hours']}
                  recommendation="Faster migrations often indicate organic hype. Very fast (≤5 min) may be coordinated."
                />

                {/* Volume Filter */}
                <FilterCard
                  title="Minimum Volume"
                  icon={BarChart3}
                  description="Require a minimum trading volume before migration"
                  options={['$10k+', '$25k+', '$50k+', '$100k+']}
                  recommendation="Higher volume suggests more organic trading activity."
                />

                {/* Holder Count Filter */}
                <FilterCard
                  title="Minimum Holders"
                  icon={Users}
                  description="Require a minimum number of unique wallet holders"
                  options={['25+', '50+', '100+', '250+']}
                  recommendation="More holders = more distributed ownership and less rug risk."
                />

                {/* Dev Holdings Filter */}
                <FilterCard
                  title="Max Dev Holdings"
                  icon={AlertTriangle}
                  description="Maximum percentage of supply the developer can hold"
                  options={['≤5%', '≤15%', '≤30%', '≤50%']}
                  recommendation="Lower dev holdings reduce rug pull risk. ≤15% is a safe threshold."
                />

                {/* Top 10 Concentration */}
                <FilterCard
                  title="Top 10 Concentration"
                  icon={Layers}
                  description="Maximum percentage of supply held by top 10 wallets"
                  options={['≤30%', '≤50%', '≤70%', '≤90%']}
                  recommendation="Lower concentration means better token distribution."
                />

                {/* Social Presence */}
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Globe className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold">Social Presence</h4>
                      <p className="text-sm text-muted-foreground">
                        Require tokens to have verified social links
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <SocialBadge platform="Twitter" />
                    <SocialBadge platform="Telegram" />
                    <SocialBadge platform="Website" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <strong>Tip:</strong> Tokens with active socials are more likely to have
                    engaged communities. However, socials can be faked—use in combination with
                    other filters.
                  </p>
                </div>
              </div>
            </Section>

            {/* Trade Execution Section */}
            <Section id="execution" title="Trade Execution" icon={Target}>
              <p className="text-muted-foreground mb-6">
                When a migration matches your sniper&apos;s criteria, Bondshot automatically
                executes a buy transaction. For Raydium migrations, Jupiter is used for optimal routing.
                For PumpSwap, direct swap instructions are used.
              </p>

              <div className="bg-card border border-border rounded-xl p-6 mb-6">
                <h4 className="font-semibold mb-4">Execution Flow</h4>
                <div className="space-y-4">
                  <ExecutionStep
                    step={1}
                    title="Quote Generation"
                    description="Best swap route calculated (Jupiter for Raydium, direct for PumpSwap)"
                    status="success"
                  />
                  <ExecutionStep
                    step={2}
                    title="Transaction Building"
                    description="Swap transaction is built with your slippage and priority fee settings"
                    status="success"
                  />
                  <ExecutionStep
                    step={3}
                    title="Jito Bundle"
                    description="Transaction is submitted via Jito for MEV protection and faster inclusion"
                    status="success"
                  />
                  <ExecutionStep
                    step={4}
                    title="Confirmation"
                    description="Transaction is confirmed and position is tracked in your dashboard"
                    status="success"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <InfoBox type="success" title="Successful Trade">
                  Position is opened and tracked. Exit strategies begin monitoring market cap.
                  You&apos;ll see the position in your dashboard with real-time P&L.
                </InfoBox>
                <InfoBox type="error" title="Failed Trade">
                  Common causes: slippage exceeded, insufficient balance, or network congestion.
                  Failed trades are logged but do not consume funds (minus gas).
                </InfoBox>
              </div>
            </Section>

            {/* Exit Strategies Section */}
            <Section id="exit" title="Exit Strategies" icon={TrendingUp}>
              <p className="text-muted-foreground mb-6">
                Automated exit strategies ensure you lock in profits and limit losses without
                constant monitoring. Exit triggers are based on market cap changes from your entry point.
              </p>

              <div className="space-y-4 mb-6">
                <ExitStrategyCard
                  title="Take Profit"
                  icon={ArrowUpRight}
                  iconColor="text-orange-500"
                  description="Automatically sell when your position reaches a target profit percentage based on market cap increase"
                  example="Set to 100% = sell when market cap doubles from entry (2x)"
                  required
                />
                <ExitStrategyCard
                  title="Stop Loss"
                  icon={ArrowDownRight}
                  iconColor="text-red-500"
                  description="Automatically sell when market cap drops below a threshold from your entry"
                  example="Set to 50% = sell if market cap drops to half of entry"
                  required
                />
                <ExitStrategyCard
                  title="Trailing Stop"
                  icon={TrendingUp}
                  iconColor="text-yellow-500"
                  description="Sell when market cap drops X% from its highest point (follows price up)"
                  example="Set to 20% = sell if market cap drops 20% from peak"
                />
                <ExitStrategyCard
                  title="Cover Initials"
                  icon={Shield}
                  iconColor="text-blue-500"
                  description="Sell 50% at 2x to recover your initial investment, let the rest ride"
                  example="Reduces risk by securing your principal early"
                />
              </div>

              <InfoBox type="info" title="Strategy Combinations">
                Exit strategies work together. For example: Cover Initials triggers at 2x,
                then Take Profit closes the remaining 50% at your target, while Stop Loss
                protects against sudden drops. The Activity Log shows exactly which exit triggered (TP Hit, SL Hit, TS Hit).
              </InfoBox>
            </Section>

            {/* MEV Protection Section */}
            <Section id="protection" title="MEV Protection" icon={Shield}>
              <p className="text-muted-foreground mb-6">
                MEV (Maximal Extractable Value) attacks like sandwich attacks can significantly
                impact your trade prices. Bondshot uses Jito bundles to protect your transactions.
              </p>

              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <XCircle className="h-5 w-5 text-red-500" />
                    <h4 className="font-semibold text-red-500">Without Protection</h4>
                  </div>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-red-500">•</span>
                      Bots can see your pending transaction
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-red-500">•</span>
                      Sandwich attacks buy before you, sell after
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-red-500">•</span>
                      You get worse prices, bots profit
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-red-500">•</span>
                      Can lose 5-20% to MEV extraction
                    </li>
                  </ul>
                </div>

                <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-5 w-5 text-orange-500" />
                    <h4 className="font-semibold text-orange-500">With Jito Protection</h4>
                  </div>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-orange-500">•</span>
                      Transaction goes directly to block builders
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-500">•</span>
                      Not visible in public mempool
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-500">•</span>
                      Sandwich attacks cannot target you
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-500">•</span>
                      Pay small tip instead of losing to MEV
                    </li>
                  </ul>
                </div>
              </div>

              <InfoBox type="success" title="95% Jito Coverage">
                Jito validators process approximately 95% of Solana blocks. Your transactions
                are protected on the vast majority of blocks, with standard submission as fallback.
              </InfoBox>
            </Section>

            {/* Monitoring Section */}
            <Section id="monitoring" title="Monitoring & Alerts" icon={Activity}>
              <p className="text-muted-foreground mb-6">
                Stay informed about your snipers and positions with real-time monitoring
                and notifications.
              </p>

              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <FeatureBox
                  icon={Activity}
                  title="Live Activity Log"
                  description="Real-time feed of migrations detected, trades executed, and position updates with specific labels (TP Hit, SL Hit, Manual Sell)"
                />
                <FeatureBox
                  icon={Bell}
                  title="Toast Notifications"
                  description="Instant browser notifications for important events like fills and exits"
                />
                <FeatureBox
                  icon={BarChart3}
                  title="P&L Tracking"
                  description="Real-time profit/loss calculations based on entry market cap vs current market cap"
                />
                <FeatureBox
                  icon={Eye}
                  title="Position Dashboard"
                  description="Overview of all positions with current prices, entry market cap, and exit status"
                />
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <h4 className="font-semibold mb-3">Dashboard Stats</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatPreview label="Total P&L" value="+2.45 SOL" positive />
                  <StatPreview label="Open Positions" value="3" />
                  <StatPreview label="Active Snipers" value="2" />
                  <StatPreview label="Success Rate" value="78%" />
                </div>
              </div>
            </Section>

            {/* Buybacks Section */}
            <Section id="buybacks" title="$BOND Buybacks" icon={Flame}>
              <p className="text-muted-foreground mb-6">
                Platform fees are used to buy back and burn $BOND tokens, creating deflationary
                pressure and rewarding holders.
              </p>

              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <FeatureBox
                  icon={Crosshair}
                  title="Sniper Fees"
                  description="1% fee on successful buy transactions funds the buyback pool"
                />
                <FeatureBox
                  icon={BarChart3}
                  title="Volume Fees"
                  description="Trading volume on the platform contributes to buybacks"
                />
              </div>

              <div className="bg-card border border-border rounded-xl p-6 mb-6">
                <h4 className="font-semibold mb-4 flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-primary" />
                  Buyback Flow
                </h4>
                <div className="space-y-3">
                  <TimelineItem
                    time="1"
                    event="Fees collected from sniper trades and volume"
                  />
                  <TimelineItem
                    time="2"
                    event="SOL accumulates in buyback treasury"
                  />
                  <TimelineItem
                    time="3"
                    event="Automatic buybacks executed periodically"
                    highlight
                  />
                  <TimelineItem
                    time="4"
                    event="$BOND tokens burned, reducing supply"
                    highlight
                  />
                </div>
              </div>

              <InfoBox type="success" title="Deflationary Tokenomics">
                Every successful trade on Bondshot contributes to $BOND buybacks.
                Tokens are permanently burned, reducing total supply over time.
                Track buyback stats on the <Link href="/buybacks" className="underline text-primary">$BOND Buybacks</Link> page.
              </InfoBox>
            </Section>

            {/* Fees Section */}
            <Section id="fees" title="Fees & Costs" icon={DollarSign}>
              <p className="text-muted-foreground mb-6">
                Understanding the costs involved helps you plan your trading strategy effectively.
              </p>

              <div className="bg-card border border-border rounded-xl overflow-hidden mb-6">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm font-medium">Fee Type</th>
                      <th className="text-left px-4 py-3 text-sm font-medium">Amount</th>
                      <th className="text-left px-4 py-3 text-sm font-medium">When Charged</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="px-4 py-3 font-medium">Platform Fee</td>
                      <td className="px-4 py-3 text-primary font-semibold">1%</td>
                      <td className="px-4 py-3 text-muted-foreground text-sm">
                        On successful buy transactions only (funds $BOND buybacks)
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium">Priority Fee (Jito Tip)</td>
                      <td className="px-4 py-3 text-sm">0.003-0.01 SOL</td>
                      <td className="px-4 py-3 text-muted-foreground text-sm">
                        Per transaction, configurable (minimum 0.003 SOL)
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium">Network Fee</td>
                      <td className="px-4 py-3 text-sm">~0.000005 SOL</td>
                      <td className="px-4 py-3 text-muted-foreground text-sm">
                        Standard Solana transaction fee
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium">Swap Fee</td>
                      <td className="px-4 py-3 text-sm">0.25-0.3%</td>
                      <td className="px-4 py-3 text-muted-foreground text-sm">
                        AMM fees (Raydium/PumpSwap pool)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <InfoBox type="info" title="No Hidden Fees">
                Failed transactions only cost gas (network fee). The 1% platform fee is only
                charged on successful buys and goes directly to $BOND buybacks. Sells have no platform fee—just network and swap fees.
              </InfoBox>
            </Section>

            {/* CTA Section */}
            <div className="mt-16 p-8 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 text-center">
              <h2 className="text-2xl font-bold mb-3">Ready to Start?</h2>
              <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
                Configure your first sniper in under a minute. No wallet required to start—
                generate a new one directly in the app.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/">
                  <Button size="lg" className="gap-2">
                    Get Started <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button size="lg" variant="outline" className="gap-2">
                    Go to Dashboard <ChevronRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="sm" />
              <LogoText size="sm" />
            </Link>
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Sniper Dashboard
              </Link>
              <Link href="/buybacks" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                $BOND Buybacks
              </Link>
              <Link href="/how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                How it Works
              </Link>
              <a
                href="https://x.com/Bondshot_io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                @Bondshot_io
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              Trade at your own risk. Cryptocurrency trading involves significant risk of loss.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Component: Section wrapper
function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-16 scroll-mt-24">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-2xl font-bold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

// Component: Flow step
function FlowStep({
  number,
  title,
  description,
  icon: Icon,
}: {
  number: number;
  title: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <div className="text-center p-4 rounded-xl bg-card border border-border">
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="text-xs text-muted-foreground mb-1">Step {number}</div>
      <h4 className="font-semibold mb-1">{title}</h4>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

// Component: Feature box
function FeatureBox({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-card border border-border">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h4 className="font-semibold text-sm mb-1">{title}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

// Component: Info box
function InfoBox({
  type,
  title,
  children,
}: {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-500',
    success: 'bg-orange-500/10 border-orange-500/30 text-orange-500',
    warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500',
    error: 'bg-red-500/10 border-red-500/30 text-red-500',
  };

  const icons = {
    info: Activity,
    success: CheckCircle2,
    warning: AlertTriangle,
    error: XCircle,
  };

  const Icon = icons[type];

  return (
    <div className={cn('rounded-xl border p-4', styles[type])}>
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-semibold mb-1">{title}</h4>
          <p className="text-sm text-muted-foreground">{children}</p>
        </div>
      </div>
    </div>
  );
}

// Component: Timeline item
function TimelineItem({
  time,
  event,
  highlight,
}: {
  time: string;
  event: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          'w-16 text-right font-mono text-sm',
          highlight ? 'text-primary font-semibold' : 'text-muted-foreground'
        )}
      >
        {time}
      </div>
      <div
        className={cn(
          'w-2 h-2 rounded-full',
          highlight ? 'bg-primary' : 'bg-muted-foreground/50'
        )}
      />
      <div className={cn('text-sm', highlight && 'font-medium')}>{event}</div>
    </div>
  );
}

// Component: Filter card
function FilterCard({
  title,
  icon: Icon,
  description,
  options,
  recommendation,
}: {
  title: string;
  icon: React.ElementType;
  description: string;
  options: string[];
  recommendation: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start gap-4 mb-4">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h4 className="font-semibold">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {options.map((option) => (
          <span
            key={option}
            className="px-3 py-1 rounded-lg bg-muted text-sm font-medium"
          >
            {option}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>Tip:</strong> {recommendation}
      </p>
    </div>
  );
}

// Component: Social badge
function SocialBadge({ platform }: { platform: string }) {
  const icons: Record<string, React.ReactNode> = {
    Twitter: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    Telegram: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
    Website: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  };

  return (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted text-sm">
      {icons[platform]}
      {platform}
    </span>
  );
}

// Component: Exit strategy card
function ExitStrategyCard({
  title,
  icon: Icon,
  iconColor,
  description,
  example,
  required,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  description: string;
  example: string;
  required?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start gap-4">
        <div className={cn('p-2 rounded-lg bg-muted', iconColor)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold">{title}</h4>
            {required && (
              <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">
                Required
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-2">{description}</p>
          <p className="text-xs text-muted-foreground bg-muted rounded px-2 py-1 inline-block">
            {example}
          </p>
        </div>
      </div>
    </div>
  );
}

// Component: Execution step
function ExecutionStep({
  step,
  title,
  description,
  status,
}: {
  step: number;
  title: string;
  description: string;
  status: 'success' | 'pending' | 'error';
}) {
  return (
    <div className="flex items-start gap-4">
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold',
          status === 'success' && 'bg-orange-500/20 text-orange-500',
          status === 'pending' && 'bg-muted text-muted-foreground',
          status === 'error' && 'bg-red-500/20 text-red-500'
        )}
      >
        {step}
      </div>
      <div>
        <h4 className="font-semibold text-sm">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

// Component: Stat preview
function StatPreview({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={cn(
          'text-lg font-bold',
          positive ? 'text-orange-500' : 'text-foreground'
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
