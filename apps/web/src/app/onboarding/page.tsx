'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import bs58 from 'bs58';
import toast from 'react-hot-toast';

import { useAuthStore } from '@/lib/stores/auth';
import { useWalletsStore } from '@/lib/stores/wallets';
import { useSnipersStore, Sniper } from '@/lib/stores/snipers';
import { usePendingSniperStore } from '@/lib/stores/pending-sniper';
import { authApi, walletApi, sniperApi } from '@/lib/api';
import { StepIndicator } from '@/components/onboarding/step-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wallet } from 'lucide-react';

// Dynamic import to prevent hydration mismatch with wallet button
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

type OnboardingStep = 'connect' | 'authenticate' | 'wallet-setup' | 'complete';

export default function OnboardingPage() {
  const router = useRouter();
  const { publicKey, signMessage, connected } = useWallet();
  const { setAuth, token, completeOnboarding, hasCompletedOnboarding } = useAuthStore();
  const { setWallets, addWallet, wallets } = useWalletsStore();
  const { addSniper } = useSnipersStore();
  const { pendingSniper, clearPendingSniper, hasPendingSniper } = usePendingSniperStore();

  const [step, setStep] = useState<OnboardingStep>('connect');
  const [isLoading, setIsLoading] = useState(false);
  const [walletLabel, setWalletLabel] = useState('');
  const [mounted, setMounted] = useState(false);
  const [createdSniperId, setCreatedSniperId] = useState<string | null>(null);
  const [isCreatingForExistingUser, setIsCreatingForExistingUser] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Redirect if already completed onboarding
  // BUT: If there's a pending sniper, create it first before redirecting
  useEffect(() => {
    // Prevent running multiple times
    if (isCreatingForExistingUser) return;

    if (hasCompletedOnboarding && token) {
      // Check if there's a pending sniper that needs to be created
      if (hasPendingSniper() && pendingSniper) {
        // Find a generated wallet to use
        const existingGeneratedWallet = wallets.find(w => w.walletType === 'generated');

        if (existingGeneratedWallet) {
          // Create the pending sniper before redirecting
          setIsCreatingForExistingUser(true);
          createPendingSniperForExistingUser(token, existingGeneratedWallet.id);
        } else {
          // User has no generated wallet - need to go through wallet-setup
          setStep('wallet-setup');
          return;
        }
      } else {
        // No pending sniper, just redirect
        router.push('/dashboard');
      }
    }
  }, [hasCompletedOnboarding, token, wallets, isCreatingForExistingUser]);

  // Auto-advance when wallet connects
  useEffect(() => {
    if (connected && publicKey && step === 'connect') {
      setStep('authenticate');
    }
  }, [connected, publicKey, step]);

  const stepIndex = {
    connect: 0,
    authenticate: 1,
    'wallet-setup': 2,
    complete: 3,
  };

  const handleAuthenticate = async () => {
    if (!publicKey || !signMessage) {
      toast.error('Wallet not connected');
      return;
    }

    setIsLoading(true);
    const toastId = toast.loading('Authenticating...');

    try {
      // Get nonce and message to sign
      const nonceRes = await authApi.getNonce(publicKey.toBase58());
      if (!nonceRes.success || !nonceRes.data) {
        throw new Error(nonceRes.error || 'Failed to get nonce');
      }

      const { message: messageToSign } = nonceRes.data;

      // Sign the message from the server
      const messageBytes = new TextEncoder().encode(messageToSign);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);

      // Verify signature
      const verifyRes = await authApi.verify(
        publicKey.toBase58(),
        signatureBase58,
        messageToSign
      );

      if (!verifyRes.success || !verifyRes.data) {
        throw new Error(verifyRes.error || 'Authentication failed');
      }

      const { token: authToken, user } = verifyRes.data;
      setAuth(authToken, user.id);

      toast.success('Authenticated successfully!', { id: toastId });

      // Fetch existing wallets (data is array directly, not { wallets: [...] })
      const walletsRes = await walletApi.getAll(authToken);
      let hasGeneratedWallet = false;
      if (walletsRes.success && walletsRes.data) {
        const walletsList = Array.isArray(walletsRes.data) ? walletsRes.data : [];
        setWallets(walletsList.map(w => ({
          ...w,
          walletType: w.walletType as 'connected' | 'generated',
          isActive: true,
        })));
        // Check if user already has a generated wallet
        hasGeneratedWallet = walletsList.some(w => w.walletType === 'generated');
      }

      // Connect the current wallet if not already connected
      await walletApi.connect(authToken, publicKey.toBase58(), true);

      // Simple flow:
      // - If user already has a server-generated wallet, use it and skip wallet-setup
      // - Otherwise, go to wallet-setup to generate one
      if (hasGeneratedWallet) {
        // User has an existing generated wallet on server - use it
        const existingGeneratedWallet = walletsRes.data?.find(
          (w: any) => w.walletType === 'generated'
        );

        if (existingGeneratedWallet && hasPendingSniper() && pendingSniper) {
          await createPendingSniper(authToken, existingGeneratedWallet.id);
        }
        setStep('complete');
      } else {
        // User needs a server-side generated wallet for trading
        setStep('wallet-setup');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Authentication failed',
        { id: toastId }
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateWallet = async () => {
    if (!token) {
      toast.error('Not authenticated');
      return;
    }

    setIsLoading(true);
    const toastId = toast.loading('Generating trading wallet...');

    try {
      const res = await walletApi.generate(token, walletLabel || 'Trading Wallet');

      if (!res.success || !res.data) {
        // Check if session expired (user not found in DB - stale token)
        if (res.error?.includes('Session expired') || res.error?.includes('reconnect')) {
          toast.error('Session expired. Please reconnect your wallet.');
          // Clear auth and restart
          const { clearAuth } = useAuthStore.getState();
          clearAuth();
          setStep('connect');
          return;
        }
        throw new Error(res.error || 'Failed to generate wallet');
      }

      // Server returns data as wallet object directly, not { wallet: {...} }
      const wallet = res.data as any;
      const newWallet = {
        id: wallet.id,
        publicKey: wallet.publicKey,
        label: wallet.label,
        walletType: 'generated' as const,
        isPrimary: wallet.isPrimary || false,
        isActive: true,
        createdAt: wallet.createdAt || new Date().toISOString(),
      };
      addWallet(newWallet);

      toast.success('Trading wallet generated!', { id: toastId });

      // If there's a pending sniper config, create it now
      if (hasPendingSniper() && pendingSniper) {
        await createPendingSniper(token, wallet.id);
      }

      setStep('complete');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate wallet',
        { id: toastId }
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Create sniper for returning authenticated user with pending config
  // This handles the case where user already completed onboarding but came back with a new sniper config
  const createPendingSniperForExistingUser = async (authToken: string, walletId: string) => {
    if (!pendingSniper) {
      router.push('/dashboard');
      return;
    }

    const sniperToastId = toast.loading(`Creating sniper "${pendingSniper.name}"...`);

    try {
      const res = await sniperApi.create(authToken, {
        walletId,
        name: pendingSniper.name,
        config: pendingSniper.config as unknown as Record<string, unknown>,
        isActive: false,
      });

      if (res.success && res.data) {
        const sniperData = res.data;
        const newSniper: Sniper = {
          id: sniperData.id,
          name: sniperData.name,
          isActive: sniperData.isActive || false,
          walletId,
          config: pendingSniper.config,
          stats: {
            totalSnipes: 0,
            successfulSnipes: 0,
            failedSnipes: 0,
            totalSolSpent: 0,
            totalSolProfit: 0,
          },
          createdAt: sniperData.createdAt || new Date().toISOString(),
          updatedAt: sniperData.updatedAt || new Date().toISOString(),
        };

        addSniper(newSniper);
        clearPendingSniper();
        toast.success(`Sniper "${pendingSniper.name}" created!`, { id: sniperToastId });
      } else {
        throw new Error(res.error || 'Failed to create sniper');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create sniper',
        { id: sniperToastId }
      );
    }

    // Always redirect to dashboard after attempt
    router.push('/dashboard');
  };

  // Create sniper from pending config
  const createPendingSniper = async (authToken: string, walletId: string) => {
    if (!pendingSniper) return;

    const sniperToastId = toast.loading(`Creating sniper "${pendingSniper.name}"...`);

    try {
      const res = await sniperApi.create(authToken, {
        walletId,
        name: pendingSniper.name,
        config: pendingSniper.config as unknown as Record<string, unknown>,
        isActive: false,
      });

      if (res.success && res.data) {
        const sniperData = res.data;
        const newSniper: Sniper = {
          id: sniperData.id,
          name: sniperData.name,
          isActive: sniperData.isActive || false,
          walletId,
          config: pendingSniper.config,
          stats: {
            totalSnipes: 0,
            successfulSnipes: 0,
            failedSnipes: 0,
            totalSolSpent: 0,
            totalSolProfit: 0,
          },
          createdAt: sniperData.createdAt || new Date().toISOString(),
          updatedAt: sniperData.updatedAt || new Date().toISOString(),
        };

        addSniper(newSniper);
        setCreatedSniperId(sniperData.id);
        clearPendingSniper();
        toast.success(`Sniper "${pendingSniper.name}" created!`, { id: sniperToastId });
      } else {
        throw new Error(res.error || 'Failed to create sniper');
      }
    } catch {
      toast.error('Sniper creation failed, you can create it from the dashboard', { id: sniperToastId });
    }
  };

  const handleSkipWallet = () => {
    setStep('complete');
  };

  const handleComplete = () => {
    completeOnboarding();
    toast.success('Welcome to Migratorrr!');
    router.push('/dashboard');
  };

  // Show loading state until mounted to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-pulse text-zinc-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent mb-2">
            Migratorrr
          </h1>
          <p className="text-zinc-400">Get started in a few simple steps</p>
        </div>

        {/* Step Indicator */}
        <div className="mb-8">
          <StepIndicator currentStep={stepIndex[step]} totalSteps={4} />
        </div>

        {/* Step Content */}
        <Card className="bg-zinc-900/50 border-zinc-800">
          {/* Step 1: Connect Wallet */}
          {step === 'connect' && (
            <>
              <CardHeader className="text-center pb-2">
                <div className="w-14 h-14 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Wallet className="w-7 h-7 text-green-400" />
                </div>
                <CardTitle className="text-2xl">Connect Your Wallet</CardTitle>
                <p className="text-zinc-400 text-sm mt-2">
                  Final step before accessing your Sniper Dashboard
                </p>
              </CardHeader>
              <CardContent className="space-y-5 pt-2">
                {/* Sniper info if available */}
                {hasPendingSniper() && pendingSniper && (
                  <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400 text-sm">Sniper Ready</span>
                      <span className="text-white font-medium text-sm">"{pendingSniper.name}"</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">
                      Will be created after you connect
                    </p>
                  </div>
                )}

                <p className="text-zinc-400 text-sm text-center">
                  Connect your Solana wallet to get started. We support Phantom,
                  Solflare, and other major wallets.
                </p>

                <div className="flex justify-center pt-2">
                  <WalletMultiButton />
                </div>
              </CardContent>
            </>
          )}

          {/* Step 2: Authenticate */}
          {step === 'authenticate' && (
            <>
              <CardHeader>
                <CardTitle className="text-xl">Verify Your Wallet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-zinc-400 text-sm">
                  Sign a message to prove ownership of your wallet. This does
                  not require any SOL or gas fees.
                </p>
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <p className="text-xs text-zinc-500 mb-1">Connected wallet</p>
                  <p className="font-mono text-sm text-white truncate">
                    {publicKey?.toBase58()}
                  </p>
                </div>
                <Button
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={handleAuthenticate}
                  disabled={isLoading}
                >
                  {isLoading ? 'Signing...' : 'Sign to Authenticate'}
                </Button>
              </CardContent>
            </>
          )}

          {/* Step 3: Wallet Setup */}
          {step === 'wallet-setup' && (
            <>
              <CardHeader>
                <CardTitle className="text-xl">Setup Trading Wallet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {hasPendingSniper() && pendingSniper && (
                  <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-3 mb-2">
                    <p className="text-green-400 text-sm">
                      Creating wallet for sniper <strong>"{pendingSniper.name}"</strong>
                    </p>
                  </div>
                )}
                <p className="text-zinc-400 text-sm">
                  Generate a dedicated trading wallet for automated sniping. This
                  wallet will be used to execute trades on your behalf.
                </p>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="wallet-label">Wallet Label (optional)</Label>
                    <Input
                      id="wallet-label"
                      placeholder="e.g., Main Trading Wallet"
                      value={walletLabel}
                      onChange={(e) => setWalletLabel(e.target.value)}
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>

                  <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-3">
                    <p className="text-yellow-400 text-xs">
                      <strong>Important:</strong> You'll need to fund this wallet
                      with SOL for trading. You can export the private key at any
                      time.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  {!hasPendingSniper() && (
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={handleSkipWallet}
                      disabled={isLoading}
                    >
                      Skip for now
                    </Button>
                  )}
                  <Button
                    className={`${hasPendingSniper() ? 'w-full' : 'flex-1'} bg-green-600 hover:bg-green-700`}
                    onClick={handleGenerateWallet}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Setting up...' : hasPendingSniper() ? 'Generate Wallet & Create Sniper' : 'Generate Wallet'}
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* Step 4: Complete */}
          {step === 'complete' && (
            <>
              <CardHeader>
                <CardTitle className="text-xl">
                  {createdSniperId ? 'Sniper Created!' : "You're All Set!"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center py-4">
                  <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-8 h-8 text-green-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <p className="text-zinc-400 text-sm">
                    {createdSniperId
                      ? 'Your sniper is ready and waiting. Fund your wallet and activate it to start sniping!'
                      : 'Your account is ready. Head to the dashboard to create your first sniper and start catching migrations!'}
                  </p>
                </div>

                <div className="bg-zinc-800/50 rounded-lg p-4 space-y-2">
                  <h4 className="font-medium text-sm">Next steps:</h4>
                  <ul className="text-zinc-400 text-sm space-y-1">
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      Fund your trading wallet with SOL
                    </li>
                    {createdSniperId ? (
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                        Activate your sniper from the dashboard
                      </li>
                    ) : (
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                        Create your first sniper configuration
                      </li>
                    )}
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      Watch the magic happen
                    </li>
                  </ul>
                </div>

                <Button
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={handleComplete}
                >
                  Go to Dashboard
                </Button>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
