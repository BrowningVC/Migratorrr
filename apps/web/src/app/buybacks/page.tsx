'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Logo, LogoText } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Crosshair, BarChart3, Flame } from 'lucide-react';

export default function BuybacksPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navigation */}
      <nav className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Logo size="md" />
            <LogoText size="md" />
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost">Home</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="ghost">Dashboard</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Coming Soon Content */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden px-4">
        {/* Background grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(34,197,94,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.03)_1px,transparent_1px)] bg-[size:50px_50px]" />

        {/* Animated glow background */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={cn(
              "w-[900px] h-[500px] rounded-full transition-all duration-1000",
              mounted ? "opacity-100 scale-100" : "opacity-0 scale-50"
            )}
            style={{
              background: 'radial-gradient(ellipse, rgba(34, 197, 94, 0.06) 0%, transparent 60%)',
            }}
          />
        </div>

        {/* Title */}
        <h1
          className={cn(
            "text-4xl md:text-5xl font-bold text-center mb-3 transition-all duration-1000 z-10",
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          )}
        >
          <span className="bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent">$MIGRATOR</span>
          <span className="text-zinc-100"> Buybacks</span>
        </h1>

        <p
          className={cn(
            "text-zinc-500 text-center mb-16 max-w-lg transition-all duration-1000 delay-100 z-10",
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          )}
        >
          Fees from Sniper trades & Token Volume are used to buy back and burn $MIGRATOR tokens
        </p>

        {/* Factory Conveyor Belt Animation */}
        <div
          className={cn(
            "relative w-full max-w-3xl transition-all duration-1000 delay-200 z-10",
            mounted ? "opacity-100 scale-100" : "opacity-0 scale-90"
          )}
        >
          {/* Factory Structure */}
          <div className="flex items-stretch justify-between">
            {/* Left Factory Input - Fee Sources */}
            <div className="flex flex-col items-center">
              {/* Factory hopper/input */}
              <div className="relative">
                {/* Top funnel section */}
                <div className="w-36 h-8 bg-gradient-to-b from-zinc-800 to-zinc-900 rounded-t-xl border-t border-l border-r border-zinc-700 flex items-center justify-center">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">Revenue Sources</span>
                </div>
                {/* Main hopper body */}
                <div className="w-36 h-28 bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 rounded-b-xl relative overflow-hidden">
                  {/* Fee items dropping in - using icons */}
                  {mounted && (
                    <>
                      {/* Sniper Fee Icon */}
                      <div
                        className="absolute flex items-center justify-center"
                        style={{
                          animation: 'drop-fee 3.5s ease-in infinite',
                          animationDelay: '0s',
                        }}
                      >
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600/20 to-purple-800/20 border border-purple-500/40 flex items-center justify-center backdrop-blur-sm">
                          <Crosshair className="w-4 h-4 text-purple-400" />
                        </div>
                      </div>
                      {/* Volume Fee Icon */}
                      <div
                        className="absolute flex items-center justify-center"
                        style={{
                          animation: 'drop-fee 3.5s ease-in infinite',
                          animationDelay: '1.2s',
                        }}
                      >
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600/20 to-blue-800/20 border border-blue-500/40 flex items-center justify-center backdrop-blur-sm">
                          <BarChart3 className="w-4 h-4 text-blue-400" />
                        </div>
                      </div>
                      {/* Sniper Fee Icon 2 */}
                      <div
                        className="absolute flex items-center justify-center"
                        style={{
                          animation: 'drop-fee 3.5s ease-in infinite',
                          animationDelay: '2.4s',
                        }}
                      >
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600/20 to-purple-800/20 border border-purple-500/40 flex items-center justify-center backdrop-blur-sm">
                          <Crosshair className="w-4 h-4 text-purple-400" />
                        </div>
                      </div>
                    </>
                  )}
                  {/* Inner shadow */}
                  <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-transparent pointer-events-none" />
                </div>
                {/* Output chute */}
                <div className="w-14 h-3 mx-auto bg-zinc-900 border-l border-r border-b border-zinc-800 rounded-b" />
              </div>
              {/* Labels */}
              <div className="mt-4 flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-600/20 to-purple-800/20 border border-purple-500/40 flex items-center justify-center">
                    <Crosshair className="w-3 h-3 text-purple-400" />
                  </div>
                  <span className="text-xs text-zinc-500">Sniper Fees</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-600/20 to-blue-800/20 border border-blue-500/40 flex items-center justify-center">
                    <BarChart3 className="w-3 h-3 text-blue-400" />
                  </div>
                  <span className="text-xs text-zinc-500">Volume Fees</span>
                </div>
              </div>
            </div>

            {/* Conveyor Belt */}
            <div className="flex-1 flex flex-col justify-end px-6 pb-10">
              <div className="relative h-12">
                {/* Belt track */}
                <div className="absolute inset-x-0 bottom-0 h-2.5 bg-zinc-900 rounded-full border border-zinc-800 overflow-hidden">
                  {/* Belt segments animation */}
                  {mounted && (
                    <div
                      className="absolute inset-0 flex"
                      style={{ animation: 'belt-scroll 1.5s linear infinite' }}
                    >
                      {[...Array(24)].map((_, i) => (
                        <div key={i} className="flex-shrink-0 w-3 h-full border-r border-zinc-700/40" />
                      ))}
                    </div>
                  )}
                </div>

                {/* Belt rollers */}
                <div className="absolute left-0 bottom-0 w-3.5 h-3.5 rounded-full bg-zinc-700 border border-zinc-600 -translate-x-0.5 shadow-inner" />
                <div className="absolute right-0 bottom-0 w-3.5 h-3.5 rounded-full bg-zinc-700 border border-zinc-600 translate-x-0.5 shadow-inner" />

                {/* SOL tokens traveling on belt */}
                {mounted && [0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="absolute bottom-2.5"
                    style={{
                      animation: 'travel-belt 3s linear infinite',
                      animationDelay: `${i * 1}s`,
                    }}
                  >
                    {/* Solana Logo Style Token */}
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{
                        background: 'linear-gradient(135deg, #9945FF 0%, #14F195 50%, #00C2FF 100%)',
                        boxShadow: '0 0 16px rgba(153, 69, 255, 0.4), 0 0 8px rgba(20, 241, 149, 0.3)',
                      }}
                    >
                      <span className="text-[8px] font-bold text-white drop-shadow-sm">SOL</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Belt support structure */}
              <div className="flex justify-between px-6 mt-0.5">
                <div className="w-0.5 h-5 bg-zinc-800 rounded" />
                <div className="w-0.5 h-5 bg-zinc-800 rounded" />
                <div className="w-0.5 h-5 bg-zinc-800 rounded" />
              </div>
            </div>

            {/* Right Factory Output - Token Buyback */}
            <div className="flex flex-col items-center">
              {/* Factory processor */}
              <div className="relative">
                {/* Top section with status */}
                <div className="w-36 h-8 bg-gradient-to-b from-green-950/80 to-green-950/40 rounded-t-xl border-t border-l border-r border-green-700/50 flex items-center justify-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] text-green-400 uppercase tracking-wider font-medium">Processing</span>
                </div>
                {/* Main body with logo */}
                <div
                  className="w-36 h-28 bg-gradient-to-br from-green-950/40 to-emerald-950/20 border border-green-700/40 rounded-b-xl relative overflow-hidden flex items-center justify-center"
                  style={{
                    boxShadow: '0 0 50px rgba(34, 197, 94, 0.1), inset 0 0 30px rgba(34, 197, 94, 0.05)',
                  }}
                >
                  <div className="relative z-10">
                    <Logo size="md" />
                  </div>
                  {/* Pulse ring */}
                  <div
                    className="absolute inset-2 rounded-lg border border-green-500/20"
                    style={{ animation: mounted ? 'pulse-ring 2s ease-out infinite' : 'none' }}
                  />
                  {/* Burn particles rising */}
                  {mounted && (
                    <div className="absolute inset-0 overflow-hidden rounded-b-xl">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className="absolute bottom-0"
                          style={{
                            left: `${20 + i * 15}%`,
                            animation: 'rise-particle 2.5s ease-out infinite',
                            animationDelay: `${i * 0.5}s`,
                          }}
                        >
                          <Flame className="w-3 h-3 text-green-500/60" />
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Inner glow */}
                  <div className="absolute inset-0 bg-gradient-to-t from-green-500/5 to-transparent pointer-events-none" />
                </div>
                {/* Input chute */}
                <div className="absolute -left-1.5 top-1/2 w-3 h-5 bg-zinc-900 border border-zinc-800 rounded-l -translate-y-1/2" />
              </div>
              {/* Labels */}
              <div className="mt-4 flex flex-col items-center gap-1">
                <span className="text-sm font-semibold bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent">$MIGRATOR</span>
                <span className="text-xs text-zinc-500 uppercase tracking-wider">Buy Backs</span>
              </div>
            </div>
          </div>

          {/* Process label */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-14">
            <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900/90 border border-zinc-800 rounded-full backdrop-blur-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-zinc-400">Automatic Buyback & Burn</span>
            </div>
          </div>
        </div>

        {/* Stats preview */}
        <div
          className={cn(
            "flex gap-12 mt-32 transition-all duration-1000 delay-400 z-10",
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          )}
        >
          <div className="text-center">
            <div className="text-3xl font-mono font-bold text-zinc-300">--</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wider mt-1">Tokens Burned</div>
          </div>
          <div className="w-px bg-zinc-800" />
          <div className="text-center">
            <div className="text-3xl font-mono font-bold text-zinc-300">--</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wider mt-1">SOL Spent</div>
          </div>
          <div className="w-px bg-zinc-800" />
          <div className="text-center">
            <div className="text-3xl font-mono font-bold text-zinc-300">--</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wider mt-1">Total Buybacks</div>
          </div>
        </div>

        {/* Coming Soon badge */}
        <div
          className={cn(
            "mt-10 transition-all duration-1000 delay-500 z-10",
            mounted ? "opacity-100 scale-100" : "opacity-0 scale-90"
          )}
        >
          <span className="text-sm text-zinc-600">Analytics Dashboard Coming Soon</span>
        </div>
      </div>

      {/* Custom keyframes */}
      <style jsx>{`
        @keyframes drop-fee {
          0% {
            top: -32px;
            left: 50%;
            transform: translateX(-50%);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          45% {
            top: 70px;
            opacity: 1;
          }
          55% {
            opacity: 0;
          }
          100% {
            top: 70px;
            opacity: 0;
          }
        }

        @keyframes travel-belt {
          0% {
            left: -8%;
            opacity: 0;
          }
          8% {
            opacity: 1;
          }
          92% {
            opacity: 1;
          }
          100% {
            left: 100%;
            opacity: 0;
          }
        }

        @keyframes belt-scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-24px);
          }
        }

        @keyframes pulse-ring {
          0% {
            transform: scale(1);
            opacity: 0.4;
          }
          50% {
            transform: scale(1.03);
            opacity: 0.15;
          }
          100% {
            transform: scale(1);
            opacity: 0.4;
          }
        }

        @keyframes rise-particle {
          0% {
            transform: translateY(0) scale(1);
            opacity: 0;
          }
          20% {
            opacity: 0.6;
          }
          100% {
            transform: translateY(-80px) scale(0.3);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
