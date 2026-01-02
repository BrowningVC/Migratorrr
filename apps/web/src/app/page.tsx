'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Crosshair, Zap, Shield, TrendingUp, Activity, ArrowRight, Radio, BookOpen, Wallet, DollarSign, Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo, LogoText } from '@/components/logo';
import { PreAuthSniperModal } from '@/components/sniper/pre-auth-sniper-modal';
import { useAuthStore } from '@/lib/stores/auth';
import { cn } from '@/lib/utils';

// Workflow steps for animated diagram
const WORKFLOW_STEPS = [
  { id: 1, label: 'Token Migrates', sublabel: 'PumpFun → Raydium', icon: 'migration' },
  { id: 2, label: 'Detected', sublabel: '~50ms latency', icon: 'detect' },
  { id: 3, label: 'Auto Buy', sublabel: 'Sniper executes buy transaction based on user parameters', icon: 'buy' },
  { id: 4, label: 'Take Profit', sublabel: 'Sniper executes sell transaction based on user profit settings', icon: 'profit' },
];

const TAGLINE = 'Exploiting PumpFun Profitability';
const MIGRATOR_TOKEN_ADDRESS = 'BnbvSDF8zUjWAvkD6eyxbrTNtkRwG4i3oDNRumFRpump';

export default function LandingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isSniperModalOpen, setIsSniperModalOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(1); // Start at 1 so first box is green on load
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const { isAuthenticated, hasCompletedOnboarding, _hasHydrated: authHydrated } = useAuthStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Typewriter effect for tagline
  useEffect(() => {
    if (!mounted) return;

    // If finished typing, wait 3 seconds then reset
    if (taglineIndex >= TAGLINE.length) {
      const resetTimeout = setTimeout(() => {
        setTaglineIndex(0);
      }, 3000); // 3 second pause before restarting
      return () => clearTimeout(resetTimeout);
    }

    const timeout = setTimeout(() => {
      setTaglineIndex(prev => prev + 1);
    }, 50); // 50ms per character

    return () => clearTimeout(timeout);
  }, [mounted, taglineIndex]);

  // Handle Dashboard click - go to dashboard if authenticated with sniper, otherwise open modal
  const handleDashboardClick = () => {
    // Wait for auth store to hydrate before checking auth state
    if (!authHydrated) {
      // Store hasn't hydrated yet - wait a moment and try again
      setTimeout(() => {
        const state = useAuthStore.getState();
        if (state._hasHydrated && state.isAuthenticated && state.hasCompletedOnboarding) {
          router.push('/dashboard');
        } else {
          setIsSniperModalOpen(true);
        }
      }, 100);
      return;
    }

    // If authenticated with completed onboarding, go to dashboard
    // (Dashboard will show existing snipers or prompt to create one)
    if (isAuthenticated && hasCompletedOnboarding) {
      router.push('/dashboard');
    } else {
      // Not authenticated - open sniper modal to start the flow
      setIsSniperModalOpen(true);
    }
  };

  // Animated workflow progression
  useEffect(() => {
    if (!mounted) return;

    const interval = setInterval(() => {
      setActiveStep(prev => (prev + 1) % (WORKFLOW_STEPS.length + 1));
    }, 1500);

    return () => clearInterval(interval);
  }, [mounted]);

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Logo size="md" />
            <LogoText size="md" />
            <span className="hidden sm:inline-block text-xs text-orange-500/70 border-l border-orange-800/50 pl-2 ml-1 font-mono">
              {TAGLINE.slice(0, taglineIndex)}
              <span className="animate-pulse">|</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={handleDashboardClick}>
              Sniper Dashboard
            </Button>
            <Link href="/buybacks">
              <Button variant="ghost">$MIGRATOR Buybacks</Button>
            </Link>
            <Link href="/how-it-works">
              <Button variant="ghost">How it Works</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section - Technical Design */}
      <section className="relative overflow-hidden border-b border-border">
        {/* Background grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(249,115,22,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(249,115,22,0.03)_1px,transparent_1px)] bg-[size:50px_50px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />

        <div className="container mx-auto px-4 py-16 relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left side - Text content */}
            <div className="space-y-6">
              {/* Main heading with code styling */}
              <div className="space-y-2">
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
                  <span className="bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent">Automated Sniping</span>
                  <span className="text-zinc-100"> on </span>
                  <span className="bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent">Migrations</span>
                  <span className="text-zinc-100"> With</span>
                </h1>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-zinc-100">
                  Custom Filters in <span className="font-mono text-orange-400">&lt;100ms</span>
                </h1>
              </div>

              {/* Technical description */}
              <p className="text-lg text-zinc-400 max-w-lg leading-relaxed">
                Automated trading engine for PumpFun migrations. WebSocket-based detection,
                Jito MEV protection, configurable hands-free trading with full customisation of your own trading signals.
              </p>

              {/* Stats row */}
              <div className="flex flex-wrap gap-6 py-4">
                <div className="space-y-1">
                  <div className="text-2xl font-mono font-bold text-zinc-100">~50ms</div>
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">Avg Latency</div>
                </div>
                <div className="w-px bg-zinc-800" />
                <div className="space-y-1">
                  <div className="text-2xl font-mono font-bold text-zinc-100">Jito</div>
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">MEV Protection</div>
                </div>
                <div className="w-px bg-zinc-800" />
                <div className="space-y-1">
                  <div className="text-2xl font-mono font-bold text-orange-400">24/7</div>
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">Automated</div>
                </div>
              </div>

              {/* CTA */}
              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  size="lg"
                  className="gap-2 bg-orange-600 hover:bg-orange-700 text-white font-medium px-6"
                  onClick={() => setIsSniperModalOpen(true)}
                >
                  <Crosshair className="h-4 w-4" />
                  Deploy Sniper
                </Button>
                <Link href="/how-it-works">
                  <Button
                    size="lg"
                    variant="outline"
                    className="gap-2 border-zinc-700 hover:bg-zinc-800/50 text-zinc-300"
                  >
                    <BookOpen className="h-4 w-4" />
                    How it Works
                  </Button>
                </Link>
              </div>
            </div>

            {/* Right side - Animated workflow diagram */}
            <div className="lg:pl-8">
              <div className="relative">
                {/* Workflow steps */}
                <div className="space-y-4">
                  {WORKFLOW_STEPS.map((step, index) => {
                    const isActive = activeStep > index;
                    const isCurrent = activeStep === index + 1;

                    return (
                      <div key={step.id} className="relative">
                        {/* Connector line - sleek design */}
                        {index < WORKFLOW_STEPS.length - 1 && (
                          <div className="absolute left-6 top-14 w-px h-8 bg-zinc-800/50">
                            {/* Animated fill with glow */}
                            <div
                              className={cn(
                                "w-full transition-all duration-700 ease-out rounded-full",
                                isActive
                                  ? "h-full bg-gradient-to-b from-orange-400 to-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]"
                                  : "h-0 bg-orange-500"
                              )}
                            />
                          </div>
                        )}

                        {/* Step card */}
                        <div
                          className={cn(
                            "flex items-center gap-4 p-4 rounded-xl border transition-all duration-300",
                            isCurrent && "border-orange-500/50 bg-orange-500/5 scale-[1.02]",
                            isActive && !isCurrent && "border-orange-500/30 bg-zinc-900/50",
                            !isActive && "border-zinc-800 bg-zinc-900/30"
                          )}
                        >
                          {/* Icon */}
                          <div
                            className={cn(
                              "w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300",
                              isActive ? "bg-orange-500/20" : "bg-zinc-800"
                            )}
                          >
                            {step.icon === 'migration' && (
                              <ArrowRight className={cn("w-5 h-5 transition-colors", isActive ? "text-orange-400" : "text-zinc-500")} />
                            )}
                            {step.icon === 'detect' && (
                              <Radio className={cn("w-5 h-5 transition-colors", isActive ? "text-orange-400" : "text-zinc-500", isCurrent && "animate-pulse")} />
                            )}
                            {step.icon === 'buy' && (
                              <Wallet className={cn("w-5 h-5 transition-colors", isActive ? "text-orange-400" : "text-zinc-500")} />
                            )}
                            {step.icon === 'profit' && (
                              <DollarSign className={cn("w-5 h-5 transition-colors", isActive ? "text-orange-400" : "text-zinc-500")} />
                            )}
                          </div>

                          {/* Text */}
                          <div className="flex-1">
                            <div className={cn(
                              "font-semibold transition-colors",
                              isActive ? "text-zinc-100" : "text-zinc-400"
                            )}>
                              {step.label}
                            </div>
                            <div className={cn(
                              "text-sm transition-colors",
                              isActive ? "text-zinc-400" : "text-zinc-600"
                            )}>
                              {step.sublabel}
                            </div>
                          </div>

                          {/* Check mark */}
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300",
                            isActive ? "bg-orange-500" : "bg-zinc-800"
                          )}>
                            {isActive && <Check className="w-3.5 h-3.5 text-white" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Continues searching message - shows when all steps complete */}
                <div className={cn(
                  "mt-4 flex items-center gap-3 p-3 rounded-lg border transition-all duration-500",
                  activeStep > WORKFLOW_STEPS.length
                    ? "border-orange-500/30 bg-orange-500/5 opacity-100"
                    : "border-transparent bg-transparent opacity-0"
                )}>
                  <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                    <Radio className="w-4 h-4 text-orange-400 animate-pulse" />
                  </div>
                  <div className="text-sm text-orange-400">
                    Continues searching for next migration...
                  </div>
                </div>

                {/* Token contract box */}
                <div className="mt-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-100">$MIGRATOR</span>
                      <span className="px-2 py-0.5 text-xs font-medium bg-orange-500/20 text-orange-400 rounded">
                        Live
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-zinc-800 px-3 py-2 rounded font-mono text-zinc-400 truncate">
                      {MIGRATOR_TOKEN_ADDRESS}
                    </code>
                    <button
                      className={cn(
                        "p-2 rounded transition-colors",
                        copied ? "bg-orange-500/20 text-orange-400" : "hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                      )}
                      onClick={() => {
                        navigator.clipboard.writeText(MIGRATOR_TOKEN_ADDRESS);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      title="Copy contract address"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center mb-12">Why Migratorrr?</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <FeatureCard
            icon={<Zap className="h-8 w-8" />}
            title="Lightning Fast"
            description="Triple-redundant migration detection with sub-100ms latency. Execute before the crowd."
          />
          <FeatureCard
            icon={<Shield className="h-8 w-8" />}
            title="MEV Protected"
            description="All trades via Jito bundles with anti-sandwich protection. Your trades stay private."
          />
          <FeatureCard
            icon={<TrendingUp className="h-8 w-8" />}
            title="Auto Take Profit"
            description="Set your targets and let automation handle exits. Take profit, stop loss, trailing stops."
          />
          <FeatureCard
            icon={<Activity className="h-8 w-8" />}
            title="Real-Time Updates"
            description="Live activity log, toast notifications, and P&L tracking. Always know what's happening."
          />
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-border bg-card/50">
        <div className="container mx-auto px-4 py-20">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <StepCard
              number={1}
              title="Configure Sniper"
              description="Set your buy amount, slippage, take profit targets, and optional token filters."
            />
            <StepCard
              number={2}
              title="Connect Wallet"
              description="Link your Phantom or Solflare wallet, or generate a new one directly in the app."
            />
            <StepCard
              number={3}
              title="Watch It Work"
              description="Migratorrr monitors for migrations and executes trades automatically. Track everything in real-time."
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Ready to Start Sniping?</h2>
          <p className="text-muted-foreground mb-8">
            Configure your sniper in under a minute. No wallet required to start.
          </p>
          <Button
            size="lg"
            className="gap-2 bg-orange-600 hover:bg-orange-700"
            onClick={() => setIsSniperModalOpen(true)}
          >
            Configure Your Sniper <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
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
                $MIGRATOR Buybacks
              </Link>
              <Link href="/how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                How it Works
              </Link>
              <a
                href="https://x.com/Migratorrr"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                @Migratorrr
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              Trade at your own risk. Cryptocurrency trading involves significant risk of loss.
            </p>
          </div>
        </div>
      </footer>

      {/* Pre-Auth Sniper Configuration Modal */}
      <PreAuthSniperModal
        isOpen={isSniperModalOpen}
        onClose={() => setIsSniperModalOpen(false)}
      />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors">
      <div className="text-primary mb-4">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center">
      <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold mx-auto mb-4">
        {number}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
