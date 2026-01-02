'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Logo, LogoText } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowRight, Flame, TrendingUp, Zap, CircleDollarSign, Repeat, ChevronDown } from 'lucide-react';

// Animated counter hook
function useAnimatedCounter(end: number, duration: number = 2000, startOnMount: boolean = true) {
  const [count, setCount] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (!startOnMount || hasStarted) return;
    setHasStarted(true);

    let startTime: number;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }, [end, duration, startOnMount, hasStarted]);

  return count;
}

export default function BuybacksPage() {
  const [mounted, setMounted] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 4);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const tokensBurned = useAnimatedCounter(0, 2000, mounted);
  const solSpent = useAnimatedCounter(0, 2000, mounted);
  const totalBuybacks = useAnimatedCounter(0, 2000, mounted);

  const steps = [
    {
      icon: Zap,
      title: 'Trade Fees Collected',
      description: '0.5% fee on every sniper trade',
      color: 'orange',
    },
    {
      icon: CircleDollarSign,
      title: 'SOL Accumulated',
      description: 'Fees pool in treasury wallet',
      color: 'purple',
    },
    {
      icon: TrendingUp,
      title: 'Market Buy $BOND',
      description: 'Automatic buybacks executed',
      color: 'blue',
    },
    {
      icon: Flame,
      title: 'Tokens Burned',
      description: 'Permanently removed from supply',
      color: 'red',
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800/50 bg-black/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Logo size="sm" />
            <LogoText size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
                Home
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-black font-medium">
                Launch App
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6 relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(249,115,22,0.15),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/20 mb-8 transition-all duration-700",
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            )}
          >
            <Flame className="w-4 h-4 text-orange-400" />
            <span className="text-sm text-orange-400 font-medium">100% of Revenue → $BOND Buybacks</span>
          </div>

          <h1
            className={cn(
              "text-5xl md:text-6xl lg:text-7xl font-bold mb-6 transition-all duration-700 delay-100",
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            )}
          >
            <span className="text-white">Deflationary</span>
            <br />
            <span className="bg-gradient-to-r from-orange-400 via-orange-500 to-amber-500 bg-clip-text text-transparent">
              By Design
            </span>
          </h1>

          <p
            className={cn(
              "text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-12 transition-all duration-700 delay-200",
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            )}
          >
            Every trade on Bondshot generates fees that are used exclusively to buy back and burn $BOND tokens.
            No team allocation. No marketing budget. Just pure deflation.
          </p>

          <div
            className={cn(
              "flex items-center justify-center gap-2 text-zinc-500 transition-all duration-700 delay-300",
              mounted ? "opacity-100" : "opacity-0"
            )}
          >
            <span className="text-sm">See how it works</span>
            <ChevronDown className="w-4 h-4 animate-bounce" />
          </div>
        </div>
      </section>

      {/* Process Flow Section */}
      <section className="py-20 px-6 relative">
        <div className="max-w-5xl mx-auto">
          <div
            className={cn(
              "text-center mb-16 transition-all duration-700",
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            )}
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              The <span className="text-orange-500">Buyback</span> Cycle
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              A simple, transparent process that runs automatically with every trade
            </p>
          </div>

          {/* Horizontal Flow */}
          <div className="relative">
            {/* Connection line */}
            <div className="absolute top-16 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-zinc-800 to-transparent hidden md:block" />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-4">
              {steps.map((step, i) => {
                const isActive = activeStep === i;
                const colorMap: Record<string, { bg: string; border: string; text: string; glow: string }> = {
                  orange: {
                    bg: 'bg-orange-500/10',
                    border: 'border-orange-500/30',
                    text: 'text-orange-400',
                    glow: 'shadow-orange-500/20',
                  },
                  purple: {
                    bg: 'bg-purple-500/10',
                    border: 'border-purple-500/30',
                    text: 'text-purple-400',
                    glow: 'shadow-purple-500/20',
                  },
                  blue: {
                    bg: 'bg-blue-500/10',
                    border: 'border-blue-500/30',
                    text: 'text-blue-400',
                    glow: 'shadow-blue-500/20',
                  },
                  red: {
                    bg: 'bg-red-500/10',
                    border: 'border-red-500/30',
                    text: 'text-red-400',
                    glow: 'shadow-red-500/20',
                  },
                };
                const colorClasses = colorMap[step.color];

                return (
                  <div
                    key={i}
                    className={cn(
                      "relative flex flex-col items-center text-center p-6 rounded-2xl border transition-all duration-500",
                      isActive
                        ? `${colorClasses.bg} ${colorClasses.border} shadow-lg ${colorClasses.glow}`
                        : "bg-zinc-900/30 border-zinc-800/50"
                    )}
                  >
                    {/* Step number */}
                    <div
                      className={cn(
                        "absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500",
                        isActive
                          ? `${colorClasses.bg} ${colorClasses.text} ${colorClasses.border} border`
                          : "bg-zinc-900 text-zinc-500 border border-zinc-800"
                      )}
                    >
                      {i + 1}
                    </div>

                    {/* Icon */}
                    <div
                      className={cn(
                        "w-14 h-14 rounded-xl flex items-center justify-center mb-4 transition-all duration-500",
                        isActive ? colorClasses.bg : "bg-zinc-800/50"
                      )}
                    >
                      <step.icon
                        className={cn(
                          "w-7 h-7 transition-all duration-500",
                          isActive ? colorClasses.text : "text-zinc-500"
                        )}
                      />
                    </div>

                    <h3 className={cn(
                      "font-semibold mb-2 transition-all duration-500",
                      isActive ? "text-white" : "text-zinc-300"
                    )}>
                      {step.title}
                    </h3>
                    <p className="text-sm text-zinc-500">{step.description}</p>

                    {/* Arrow to next (mobile) */}
                    {i < steps.length - 1 && (
                      <div className="md:hidden mt-4">
                        <ArrowRight className="w-5 h-5 text-zinc-700 rotate-90" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Repeat indicator */}
            <div className="flex items-center justify-center mt-8">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/50 border border-zinc-800">
                <Repeat className="w-4 h-4 text-orange-400" />
                <span className="text-sm text-zinc-400">Continuous cycle with every trade</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 px-6 border-t border-zinc-900">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Buyback Statistics</h2>
            <p className="text-zinc-500">Real-time tracking of all buyback activity</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="relative p-8 rounded-2xl bg-gradient-to-br from-red-500/10 to-transparent border border-red-500/20 text-center group hover:border-red-500/40 transition-all">
              <Flame className="w-8 h-8 text-red-400 mx-auto mb-4" />
              <div className="text-4xl font-bold font-mono text-white mb-2">
                {tokensBurned > 0 ? tokensBurned.toLocaleString() : '--'}
              </div>
              <div className="text-sm text-zinc-500 uppercase tracking-wider">Tokens Burned</div>
            </div>

            <div className="relative p-8 rounded-2xl bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20 text-center group hover:border-purple-500/40 transition-all">
              <CircleDollarSign className="w-8 h-8 text-purple-400 mx-auto mb-4" />
              <div className="text-4xl font-bold font-mono text-white mb-2">
                {solSpent > 0 ? `${solSpent.toLocaleString()} SOL` : '--'}
              </div>
              <div className="text-sm text-zinc-500 uppercase tracking-wider">SOL Spent</div>
            </div>

            <div className="relative p-8 rounded-2xl bg-gradient-to-br from-orange-500/10 to-transparent border border-orange-500/20 text-center group hover:border-orange-500/40 transition-all">
              <TrendingUp className="w-8 h-8 text-orange-400 mx-auto mb-4" />
              <div className="text-4xl font-bold font-mono text-white mb-2">
                {totalBuybacks > 0 ? totalBuybacks : '--'}
              </div>
              <div className="text-sm text-zinc-500 uppercase tracking-wider">Total Buybacks</div>
            </div>
          </div>

          <div className="text-center mt-8">
            <span className="text-sm text-zinc-600">Statistics update in real-time • Analytics dashboard coming soon</span>
          </div>
        </div>
      </section>

      {/* Why It Matters Section */}
      <section className="py-20 px-6 border-t border-zinc-900">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-6">
                Why <span className="text-orange-500">100%</span> Buybacks?
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-orange-400 font-bold">1</span>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Aligned Incentives</h3>
                    <p className="text-sm text-zinc-400">
                      The team only benefits when users benefit. More volume = more buybacks = higher $BOND value.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-orange-400 font-bold">2</span>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Permanent Deflation</h3>
                    <p className="text-sm text-zinc-400">
                      Burned tokens are gone forever. Supply only decreases, creating sustainable upward pressure.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-orange-400 font-bold">3</span>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Full Transparency</h3>
                    <p className="text-sm text-zinc-400">
                      All buybacks are on-chain and verifiable. Track every transaction in real-time.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-orange-500/20 to-amber-500/20 blur-3xl rounded-full" />
              <div className="relative p-8 rounded-2xl border border-orange-500/20 bg-black/50 backdrop-blur-sm">
                <div className="text-center">
                  <div className="text-6xl font-bold bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent mb-2">
                    100%
                  </div>
                  <div className="text-lg text-zinc-300 mb-4">of all platform revenue</div>
                  <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
                    <ArrowRight className="w-4 h-4" />
                    <span>Goes directly to $BOND buybacks</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 border-t border-zinc-900">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Start Trading?</h2>
          <p className="text-zinc-400 mb-8">
            Every trade you make contributes to the buyback cycle
          </p>
          <Link href="/dashboard">
            <Button size="lg" className="h-14 px-8 bg-orange-500 hover:bg-orange-600 text-black font-semibold text-lg gap-2">
              Launch Sniper
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size="sm" />
            <LogoText size="sm" />
          </div>
          <p className="text-xs text-zinc-600">Trade at your own risk</p>
        </div>
      </footer>
    </div>
  );
}
