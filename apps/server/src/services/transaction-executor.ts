import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SecureWalletService, EncryptedKey } from './secure-wallet.js';
import { prisma } from '../db/client.js';
import { emitToUser } from '../websocket/handlers.js';
import { PumpSwapService, PumpSwapQuote, PumpSwapSellQuote } from './pumpswap.js';
import { tokenInfoService } from './token-info.js';
import { redis } from '../db/redis.js';

// Jito tip accounts (randomly selected for load distribution)
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVxaVXhp7Yyrvfvw8DQajJ',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

// Multiple Jito block engines for parallel submission (speed optimization)
const JITO_BLOCK_ENGINES = [
  'https://mainnet.block-engine.jito.wtf',
  'https://amsterdam.mainnet.block-engine.jito.wtf',
  'https://frankfurt.mainnet.block-engine.jito.wtf',
  'https://ny.mainnet.block-engine.jito.wtf',
  'https://tokyo.mainnet.block-engine.jito.wtf',
];

// SOL mint address
const SOL_MINT = 'So11111111111111111111111111111111111111112';

interface ExecuteSnipeParams {
  userId: string;
  walletId: string;
  tokenMint: string;
  poolAddress?: string;
  coinCreator?: string; // Original token creator - required for PumpSwap trades
  amountSol: number;
  slippageBps: number;
  priorityFeeSol: number;
  sniperId?: string;
  tokenSymbol?: string;
  tokenName?: string;
  initialMarketCapUsd?: number; // Market cap at time of migration detection - use this for accurate entry MCAP
  mevProtection?: boolean;
}

interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  tokenAmount?: number;
  solSpent?: number;
  solReceived?: number;
  fees?: {
    platformFee: number;
    jitoTip: number;
    networkFee: number;
  };
}

interface RaydiumSwapResponse {
  id: string;
  success: boolean;
  data: {
    swapType: string;
    inputMint: string;
    inputAmount: string;
    outputMint: string;
    outputAmount: string;
    otherAmountThreshold: string;
    slippageBps: number;
    priceImpactPct: number;
    routePlan: Array<{
      poolId: string;
      inputMint: string;
      outputMint: string;
      feeMint: string;
      feeRate: number;
      feeAmount: string;
    }>;
  };
}

interface RaydiumTxResponse {
  id: string;
  success: boolean;
  data: {
    transaction: string; // Base64 encoded versioned transaction
  }[];
}

// Cache for storing swap data between retries
interface SwapContext {
  quote: RaydiumSwapResponse['data'];
  wallet: Keypair;
  walletId: string;
  platformFee: number;
  tokenMint: string;
  tokenSymbol?: string;
  sniperId?: string;
  userId: string;
  isBuy: boolean;
  positionId?: string;
}

/**
 * TransactionExecutor - High-speed Raydium swaps with Jito MEV protection
 *
 * Speed optimizations:
 * - Parallel Jito submission to multiple block engines
 * - Pre-fetched blockhash caching
 * - Minimal instruction rebuilding on retry
 * - Skip preflight for faster submission
 *
 * MEV Protection:
 * - Jito private mempool (transactions not visible to searchers)
 * - Atomic bundle execution
 * - Random tip account selection
 *
 * User Communication:
 * - Real-time WebSocket events at every step
 * - Detailed error messages
 * - Progress tracking for retries
 */
export class TransactionExecutor {
  private secureWallet: SecureWalletService;
  private primaryConnection: Connection;
  private heliusConnection: Connection;
  private backupConnection: Connection | null = null;
  private platformFeeWallet: PublicKey;
  private platformFeeBps: number;
  private pumpSwapService: PumpSwapService;

  // Blockhash cache for speed
  // Increased from 2s to 30s to reduce Helius RPC calls significantly
  // Blockhashes are valid for ~90 slots (~45 seconds), so 30s cache is safe
  private cachedBlockhash: { blockhash: string; lastValidBlockHeight: number; fetchedAt: number } | null = null;
  private readonly BLOCKHASH_CACHE_MS = 30000; // Refresh every 30 seconds (was 2s)

  // Lookup table cache - these rarely change, cache for 5 minutes
  private lookupTableCache = new Map<string, { account: AddressLookupTableAccount; fetchedAt: number }>();
  private readonly LOOKUP_TABLE_CACHE_MS = 300000; // 5 minutes

  // Wallet transaction lock - prevents multiple concurrent transactions from same wallet
  // This is critical when multiple snipers share the same wallet
  private readonly WALLET_TX_LOCK_PREFIX = 'wallet-tx-lock:';
  private readonly WALLET_TX_LOCK_TTL = 60; // 60 second lock (transactions should complete within this)
  private readonly WALLET_TX_LOCK_RETRY_MS = 100; // Retry interval when waiting for lock
  private readonly WALLET_TX_LOCK_MAX_WAIT_MS = 30000; // Max 30 seconds waiting for lock

  constructor() {
    this.secureWallet = new SecureWalletService();

    // Primary RPC (Helius)
    const heliusKey = process.env.HELIUS_API_KEY;
    const heliusUrl =
      process.env.HELIUS_RPC_URL ||
      `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
    this.primaryConnection = new Connection(heliusUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 30000,
    });
    this.heliusConnection = this.primaryConnection;

    // Backup RPC
    if (process.env.BACKUP_RPC_URL) {
      this.backupConnection = new Connection(process.env.BACKUP_RPC_URL, 'confirmed');
    }

    // Platform fee configuration - CRITICAL: Must be a valid wallet address
    const feeWalletAddress = process.env.PLATFORM_FEE_WALLET;
    if (!feeWalletAddress || feeWalletAddress === '11111111111111111111111111111111') {
      throw new Error(
        'CRITICAL: PLATFORM_FEE_WALLET environment variable must be set to a valid Solana wallet address. ' +
        'The system program address (11111...11111) is not valid for receiving fees.'
      );
    }

    try {
      this.platformFeeWallet = new PublicKey(feeWalletAddress);
    } catch {
      throw new Error(`CRITICAL: Invalid PLATFORM_FEE_WALLET address: ${feeWalletAddress}`);
    }

    this.platformFeeBps = parseInt(process.env.PLATFORM_FEE_BPS || '100'); // 1%

    // Initialize PumpSwap service
    this.pumpSwapService = new PumpSwapService(this.primaryConnection);

    // Start blockhash refresh loop
    this.startBlockhashRefresh();
  }

  /**
   * Background blockhash refresh for speed
   */
  private startBlockhashRefresh(): void {
    const refresh = async () => {
      try {
        const { blockhash, lastValidBlockHeight } = await this.primaryConnection.getLatestBlockhash('confirmed');
        this.cachedBlockhash = { blockhash, lastValidBlockHeight, fetchedAt: Date.now() };
      } catch (error) {
        console.error('Blockhash refresh error:', error);
      }
    };

    // Initial fetch
    refresh();

    // Refresh every 2 seconds
    setInterval(refresh, this.BLOCKHASH_CACHE_MS);
  }

  /**
   * Get cached or fresh blockhash
   */
  private async getBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    if (this.cachedBlockhash && Date.now() - this.cachedBlockhash.fetchedAt < this.BLOCKHASH_CACHE_MS) {
      return { blockhash: this.cachedBlockhash.blockhash, lastValidBlockHeight: this.cachedBlockhash.lastValidBlockHeight };
    }

    const result = await this.primaryConnection.getLatestBlockhash('confirmed');
    this.cachedBlockhash = { ...result, fetchedAt: Date.now() };
    return result;
  }

  /**
   * Acquire wallet transaction lock - serializes transactions for the same wallet
   * This prevents issues when multiple snipers share the same wallet and try to execute
   * transactions simultaneously (balance race conditions, tx conflicts)
   *
   * @returns Lock ID to use for release, or null if lock couldn't be acquired
   */
  private async acquireWalletTxLock(walletId: string, timeoutMs?: number): Promise<string | null> {
    const lockKey = `${this.WALLET_TX_LOCK_PREFIX}${walletId}`;
    const lockId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const maxWait = timeoutMs ?? this.WALLET_TX_LOCK_MAX_WAIT_MS;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      // Try to acquire lock atomically
      const acquired = await redis.set(lockKey, lockId, 'EX', this.WALLET_TX_LOCK_TTL, 'NX');

      if (acquired) {
        console.log(`   🔐 Wallet tx lock acquired: ${walletId.slice(0, 8)}... (${lockId})`);
        return lockId;
      }

      // Lock is held by another transaction, wait and retry
      await new Promise(resolve => setTimeout(resolve, this.WALLET_TX_LOCK_RETRY_MS));
    }

    console.warn(`   ⚠️ Failed to acquire wallet tx lock after ${maxWait}ms: ${walletId.slice(0, 8)}...`);
    return null;
  }

  /**
   * Release wallet transaction lock
   * Only releases if we still own the lock (prevents releasing another's lock if we timed out)
   */
  private async releaseWalletTxLock(walletId: string, lockId: string): Promise<void> {
    const lockKey = `${this.WALLET_TX_LOCK_PREFIX}${walletId}`;

    // Only delete if we still own the lock (atomic check-and-delete via Lua script)
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const released = await redis.eval(script, 1, lockKey, lockId);
      if (released) {
        console.log(`   🔓 Wallet tx lock released: ${walletId.slice(0, 8)}...`);
      } else {
        console.log(`   ⚠️ Wallet tx lock already expired/released: ${walletId.slice(0, 8)}...`);
      }
    } catch (error) {
      console.error(`   ❌ Error releasing wallet tx lock:`, error);
    }
  }

  /**
   * Execute a snipe (buy) transaction with multi-path failsafe
   */
  async executeSnipe(params: ExecuteSnipeParams): Promise<ExecutionResult> {
    const {
      userId,
      walletId,
      tokenMint,
      amountSol,
      slippageBps,
      priorityFeeSol,
      sniperId,
      tokenSymbol,
      tokenName,
      initialMarketCapUsd,
      mevProtection = true,
    } = params;

    const startTime = Date.now();
    const tokenLabel = tokenSymbol || tokenMint.slice(0, 8);

    console.log(`\n💰 [TX EXECUTOR] Starting BUY transaction`);
    console.log(`   Token: ${tokenLabel} (${tokenMint})`);
    console.log(`   Amount: ${amountSol} SOL, Slippage: ${slippageBps}bps, Tip: ${priorityFeeSol} SOL`);
    console.log(`   MEV Protection: ${mevProtection ? 'ON' : 'OFF'}`);

    // Notify user immediately
    await emitToUser(userId, 'snipe:started', {
      sniperId,
      tokenMint,
      tokenSymbol: tokenLabel,
      amountSol,
      timestamp: startTime,
    });

    // CRITICAL: Acquire wallet-level transaction lock
    // This serializes transactions from the same wallet to prevent:
    // 1. Balance race conditions (multiple txs checking balance before any completes)
    // 2. Transaction conflicts (account state changes)
    // Especially important when multiple snipers share the same wallet
    const walletLockId = await this.acquireWalletTxLock(walletId);
    if (!walletLockId) {
      const error = 'Could not acquire wallet lock - another transaction in progress';
      console.log(`   ❌ ${error}`);
      await emitToUser(userId, 'snipe:failed', {
        sniperId,
        tokenMint,
        tokenSymbol: tokenLabel,
        error,
      });
      return { success: false, error };
    }

    try {
      console.log(`   📡 Fetching wallet keypair...`);
      const quoteStartTime = Date.now();

      // 1. Get wallet keypair first
      const wallet = await this.getWalletKeypair(userId, walletId);

      if (!wallet) {
        console.log(`   ❌ Wallet decryption failed`);
        throw new Error('Wallet not found or decryption failed');
      }
      console.log(`   ✓ Wallet decrypted (${wallet.publicKey.toBase58().slice(0, 8)}...)`);

      // 2. Try PumpSwap first (most migrations go to PumpSwap now)
      // Pass the known pool address and coinCreator from migration event to skip RPC discovery
      console.log(`   📡 Checking PumpSwap for pool...`);
      console.log(`   📡 Known pool address from migration: ${params.poolAddress || 'NOT PROVIDED'}`);
      console.log(`   📡 Known coinCreator from migration: ${params.coinCreator || 'NOT PROVIDED'}`);
      const pumpSwapQuote = await this.pumpSwapService.getBuyQuote(
        tokenMint,
        amountSol,
        slippageBps,
        params.poolAddress, // Use pool address from migration event if available
        params.coinCreator  // Use coinCreator from migration event (CRITICAL for PumpSwap)
      );

      let transaction: VersionedTransaction;
      let expectedTokens: number;
      let priceImpact: number;
      let swapContext: SwapContext | null = null;
      let isPumpSwap = false;

      // 2. Calculate fees
      const platformFee = amountSol * (this.platformFeeBps / 10000);
      console.log(`   Platform fee: ${platformFee.toFixed(6)} SOL (${this.platformFeeBps}bps)`);

      if (pumpSwapQuote) {
        // Use PumpSwap
        isPumpSwap = true;
        console.log(`   ✓ PumpSwap pool found! Using PumpSwap AMM`);
        expectedTokens = Number(pumpSwapQuote.expectedTokens) / 1e6; // PumpSwap tokens use 6 decimals
        priceImpact = pumpSwapQuote.priceImpactPct;

        const quoteDuration = Date.now() - quoteStartTime;
        console.log(`   ✓ Quote received in ${quoteDuration}ms`);
        console.log(`      Expected tokens: ${expectedTokens.toFixed(4)}`);
        console.log(`      Price impact: ${priceImpact}%`);

        // Notify quote received
        await emitToUser(userId, 'snipe:quote', {
          sniperId,
          tokenSymbol: tokenLabel,
          expectedTokens,
          priceImpact,
          latencyMs: Date.now() - startTime,
          dex: 'PumpSwap',
        });

        // Build PumpSwap transaction
        console.log(`   🔨 Building PumpSwap transaction...`);
        const buildStartTime = Date.now();
        transaction = await this.buildPumpSwapBuyTransaction(wallet, pumpSwapQuote, priorityFeeSol, platformFee);
        console.log(`   ✓ Transaction built in ${Date.now() - buildStartTime}ms`);
      } else {
        // Fall back to Raydium
        console.log(`   ⚠️ No PumpSwap pool found, trying Raydium...`);
        const quote = await this.getRaydiumQuote({
          inputMint: SOL_MINT,
          outputMint: tokenMint,
          amount: Math.floor(amountSol * LAMPORTS_PER_SOL),
          slippageBps,
          isBuy: true,
        });

        if (!quote) {
          console.log(`   ❌ Raydium quote also failed - no liquidity?`);
          throw new Error('Failed to get quote from PumpSwap or Raydium - token may not have liquidity');
        }

        expectedTokens = parseInt(quote.outputAmount) / 1e9;
        priceImpact = quote.priceImpactPct;

        const quoteDuration = Date.now() - quoteStartTime;
        console.log(`   ✓ Raydium quote received in ${quoteDuration}ms`);
        console.log(`      Expected tokens: ${expectedTokens.toFixed(4)}`);
        console.log(`      Price impact: ${priceImpact}%`);

        // Notify quote received
        await emitToUser(userId, 'snipe:quote', {
          sniperId,
          tokenSymbol: tokenLabel,
          expectedTokens,
          priceImpact,
          latencyMs: Date.now() - startTime,
          dex: 'Raydium',
        });

        // 3. Build and sign Raydium transaction
        console.log(`   🔨 Building Raydium transaction...`);
        const buildStartTime = Date.now();

        swapContext = {
          quote,
          wallet,
          walletId,
          platformFee,
          tokenMint,
          tokenSymbol,
          sniperId,
          userId,
          isBuy: true,
        };

        transaction = await this.buildSwapTransaction(swapContext, priorityFeeSol);
        console.log(`   ✓ Transaction built in ${Date.now() - buildStartTime}ms`);
      }

      // 4. Submit with MEV protection
      console.log(`   📤 Submitting transaction...`);
      const submitStartTime = Date.now();

      // For PumpSwap, we don't have a swapContext with Raydium quote, so we need different retry handling
      let result: { success: boolean; signature?: string; error?: string };

      if (isPumpSwap) {
        // PumpSwap: submit directly, rebuild on retry if needed
        result = await this.submitPumpSwapWithFailsafe({
          transaction,
          wallet,
          pumpSwapQuote: pumpSwapQuote!,
          platformFee,
          initialTip: priorityFeeSol,
          mevProtection,
          userId,
          sniperId,
          tokenSymbol: tokenLabel,
        });
      } else {
        // Raydium: use existing failsafe with swapContext
        result = await this.submitWithFailsafe({
          transaction,
          swapContext: swapContext!,
          initialTip: priorityFeeSol,
          mevProtection,
        });
      }

      const submitDuration = Date.now() - submitStartTime;

      if (result.success && result.signature) {
        const tokenAmount = expectedTokens;
        const totalDuration = Date.now() - startTime;

        console.log(`   ✅ TRANSACTION CONFIRMED!`);
        console.log(`      Signature: ${result.signature}`);
        console.log(`      Submit time: ${submitDuration}ms`);
        console.log(`      Total time: ${totalDuration}ms`);

        // 5. Record transaction (don't await - do in background for speed)
        this.recordTransaction({
          userId,
          walletId,
          sniperId,
          signature: result.signature,
          tokenMint,
          tokenSymbol,
          tokenName,
          initialMarketCapUsd, // Use market cap from migration event for accurate entry
          solAmount: amountSol,
          tokenAmount,
          platformFee,
          jitoTip: priorityFeeSol,
          txType: 'buy',
        }).catch(err => console.error('Failed to record transaction:', err));

        // 6. Notify success
        await emitToUser(userId, 'snipe:success', {
          sniperId,
          signature: result.signature,
          tokenMint,
          tokenSymbol: tokenLabel,
          tokenAmount,
          solSpent: amountSol,
          totalLatencyMs: totalDuration,
        });

        return {
          success: true,
          signature: result.signature,
          tokenAmount,
          solSpent: amountSol,
          fees: {
            platformFee,
            jitoTip: priorityFeeSol,
            networkFee: 0.000005,
          },
        };
      } else {
        console.log(`   ❌ Transaction failed after all retries: ${result.error}`);
        throw new Error(result.error || 'Transaction failed after all retries');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const totalDuration = Date.now() - startTime;

      console.log(`   💥 TRANSACTION FAILED: ${errorMessage}`);
      console.log(`      Duration: ${totalDuration}ms`);

      // Notify failure
      await emitToUser(userId, 'snipe:failed', {
        sniperId,
        tokenMint,
        tokenSymbol: tokenLabel,
        error: errorMessage,
        totalLatencyMs: totalDuration,
      });

      // Log failure (background)
      prisma.activityLog.create({
        data: {
          userId,
          sniperId,
          eventType: 'snipe:failed',
          eventData: { tokenMint, tokenSymbol, amountSol, error: errorMessage },
        },
      }).catch(err => console.error('Failed to log activity:', err));

      return { success: false, error: errorMessage };
    } finally {
      // ALWAYS release the wallet lock when done
      await this.releaseWalletTxLock(walletId, walletLockId);
    }
  }

  /**
   * Execute a sell transaction
   */
  async executeSell(params: {
    userId: string;
    walletId: string;
    positionId: string;
    tokenMint: string;
    tokenAmount: number;
    tokenDecimals?: number;
    slippageBps: number;
    priorityFeeSol: number;
    reason: 'manual' | 'take_profit' | 'stop_loss' | 'trailing_stop';
    tokenSymbol?: string;
  }): Promise<ExecutionResult> {
    const {
      userId,
      walletId,
      positionId,
      tokenMint,
      tokenAmount,
      tokenDecimals = 6, // PumpSwap tokens use 6 decimals
      slippageBps,
      priorityFeeSol,
      reason,
      tokenSymbol,
    } = params;

    const startTime = Date.now();

    // Notify immediately
    await emitToUser(userId, 'position:selling', {
      positionId,
      tokenMint,
      tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
      tokenAmount,
      reason,
      timestamp: startTime,
    });

    // CRITICAL: Acquire wallet-level transaction lock
    // Prevents concurrent sell attempts from the same wallet causing conflicts
    const walletLockId = await this.acquireWalletTxLock(walletId);
    if (!walletLockId) {
      const error = 'Could not acquire wallet lock - another transaction in progress';
      console.log(`   ❌ ${error}`);
      await emitToUser(userId, 'position:sell_failed', {
        positionId,
        tokenMint,
        tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
        reason,
        error,
      });
      return { success: false, error };
    }

    try {
      // 1. Get wallet keypair first
      const wallet = await this.getWalletKeypair(userId, walletId);

      if (!wallet) {
        throw new Error('Wallet not found or decryption failed');
      }

      // PumpSwap tokens use 6 decimals, Raydium uses variable (default 9)
      const tokenAmountRaw = BigInt(Math.floor(tokenAmount * Math.pow(10, tokenDecimals)));

      // 1.5. Verify wallet balances BEFORE attempting sell (PARALLEL for speed)
      // This prevents confusing errors when the position data doesn't match blockchain state
      const tokenMintPubkey = new PublicKey(tokenMint);
      const balanceCheckStart = Date.now();

      console.log(`   🔍 [SELL] Parallel balance check starting...`);

      // Check both Token programs AND SOL balance in parallel for speed
      const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      const token2022ATA = getAssociatedTokenAddressSync(tokenMintPubkey, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const tokenATA = getAssociatedTokenAddressSync(tokenMintPubkey, wallet.publicKey, false, TOKEN_PROGRAM_ID);

      // Fire all balance checks in parallel
      const [token2022Result, tokenResult, solBalance] = await Promise.allSettled([
        this.primaryConnection.getTokenAccountBalance(token2022ATA),
        this.primaryConnection.getTokenAccountBalance(tokenATA),
        this.primaryConnection.getBalance(wallet.publicKey),
      ]);

      const balanceCheckDuration = Date.now() - balanceCheckStart;
      console.log(`   ⚡ [SELL] Balance checks completed in ${balanceCheckDuration}ms`);

      // Determine actual token balance
      let actualBalance = 0n;
      let foundATA = '';

      if (token2022Result.status === 'fulfilled' && BigInt(token2022Result.value.value.amount) > 0n) {
        actualBalance = BigInt(token2022Result.value.value.amount);
        foundATA = token2022ATA.toBase58();
        console.log(`      Token-2022 balance: ${Number(actualBalance) / Math.pow(10, tokenDecimals)} tokens`);
      } else if (tokenResult.status === 'fulfilled' && BigInt(tokenResult.value.value.amount) > 0n) {
        actualBalance = BigInt(tokenResult.value.value.amount);
        foundATA = tokenATA.toBase58();
        console.log(`      Token balance: ${Number(actualBalance) / Math.pow(10, tokenDecimals)} tokens`);
      }

      if (actualBalance === 0n) {
        console.log(`   ❌ SELL ABORTED: Wallet has 0 tokens on-chain`);
        console.log(`      Wallet: ${wallet.publicKey.toBase58()}`);
        console.log(`      Token: ${tokenMint}`);
        console.log(`      Position says: ${tokenAmount} tokens`);
        throw new Error('No tokens to sell - wallet balance is 0. The tokens may have already been sold or transferred.');
      }

      // ALWAYS use actual blockchain balance for sells - position data can be stale
      // This ensures "Sell All" actually sells all tokens, not just what the position thinks we have
      const sellAmountRaw = actualBalance;

      if (actualBalance !== tokenAmountRaw) {
        const diff = actualBalance > tokenAmountRaw ? 'MORE' : 'FEWER';
        console.log(`   ⚠️ SELL NOTE: Wallet has ${diff} tokens than position shows`);
        console.log(`      Position says: ${tokenAmount} tokens (${tokenAmountRaw})`);
        console.log(`      Blockchain has: ${Number(actualBalance) / Math.pow(10, tokenDecimals)} tokens (${actualBalance})`);
        console.log(`      Using actual blockchain balance for sell transaction`);
      }

      // 1.6. Check SOL balance from parallel result
      const MIN_SOL_FOR_SELL = 0.005; // ~5ms worth of fees/tips
      const solBalanceNum = solBalance.status === 'fulfilled' ? solBalance.value / LAMPORTS_PER_SOL : 0;
      console.log(`   💰 [SELL] SOL balance: ${solBalanceNum.toFixed(6)} SOL`);

      if (solBalanceNum < MIN_SOL_FOR_SELL) {
        console.log(`   ❌ SELL ABORTED: Insufficient SOL for transaction fees`);
        console.log(`      Required: ~${MIN_SOL_FOR_SELL} SOL minimum`);
        console.log(`      Available: ${solBalanceNum.toFixed(6)} SOL`);
        console.log(`      Wallet: ${wallet.publicKey.toBase58()}`);
        throw new Error(`Insufficient SOL for sell transaction. Wallet has ${solBalanceNum.toFixed(6)} SOL but needs ~${MIN_SOL_FOR_SELL} SOL for fees. Please deposit SOL to: ${wallet.publicKey.toBase58()}`);
      }

      // 2. Try PumpSwap first
      console.log(`   📡 [SELL] Checking PumpSwap for pool...`);
      console.log(`   📡 [SELL] Selling ${Number(sellAmountRaw) / Math.pow(10, tokenDecimals)} tokens`);
      const pumpSwapQuote = await this.pumpSwapService.getSellQuote(tokenMint, sellAmountRaw, slippageBps);

      let transaction: VersionedTransaction;
      let expectedSol: number;
      let isPumpSwap = false;
      let swapContext: SwapContext | null = null;

      if (pumpSwapQuote) {
        // Use PumpSwap
        isPumpSwap = true;
        console.log(`   ✓ PumpSwap pool found! Using PumpSwap AMM for sell`);
        expectedSol = Number(pumpSwapQuote.expectedSol) / LAMPORTS_PER_SOL;

        // Notify quote
        await emitToUser(userId, 'position:sell_quote', {
          positionId,
          tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
          expectedSol,
          priceImpact: pumpSwapQuote.priceImpactPct,
          dex: 'PumpSwap',
        });

        // Calculate fees (taken from received SOL)
        const platformFee = expectedSol * (this.platformFeeBps / 10000);

        // Build PumpSwap sell transaction
        console.log(`   🔨 Building PumpSwap sell transaction...`);
        transaction = await this.buildPumpSwapSellTransaction(wallet, pumpSwapQuote, priorityFeeSol, platformFee);
      } else {
        // Fall back to Raydium
        console.log(`   ⚠️ No PumpSwap pool found, trying Raydium for sell...`);
        const quote = await this.getRaydiumQuote({
          inputMint: tokenMint,
          outputMint: SOL_MINT,
          amount: Number(sellAmountRaw), // Use actual balance, not position amount
          slippageBps,
          isBuy: false,
        });

        if (!quote) {
          throw new Error('Failed to get sell quote from PumpSwap or Raydium - no liquidity available');
        }

        expectedSol = parseInt(quote.outputAmount) / LAMPORTS_PER_SOL;

        // Notify quote
        await emitToUser(userId, 'position:sell_quote', {
          positionId,
          tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
          expectedSol,
          priceImpact: quote.priceImpactPct,
          dex: 'Raydium',
        });

        // Calculate fees (taken from received SOL)
        const platformFee = expectedSol * (this.platformFeeBps / 10000);

        // Build Raydium transaction
        swapContext = {
          quote,
          wallet,
          walletId,
          platformFee,
          tokenMint,
          tokenSymbol,
          userId,
          isBuy: false,
          positionId,
        };

        transaction = await this.buildSwapTransaction(swapContext, priorityFeeSol);
      }

      // Calculate fees for result
      const platformFee = expectedSol * (this.platformFeeBps / 10000);

      // 4. Submit with MEV protection (always on for sells)
      let result: { success: boolean; signature?: string; error?: string };

      if (isPumpSwap) {
        result = await this.submitPumpSwapSellWithFailsafe({
          transaction,
          wallet,
          pumpSwapQuote: pumpSwapQuote!,
          platformFee,
          initialTip: priorityFeeSol,
          userId,
          positionId,
          tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
        });
      } else {
        result = await this.submitWithFailsafe({
          transaction,
          swapContext: swapContext!,
          initialTip: priorityFeeSol,
          mevProtection: true, // Always protect sells
        });
      }

      if (result.success && result.signature) {
        // 5. Update position and record transaction (background)
        this.recordSellTransaction({
          userId,
          positionId,
          signature: result.signature,
          tokenMint,
          tokenSymbol,
          tokenAmount,
          solReceived: expectedSol,
          platformFee,
          jitoTip: priorityFeeSol,
          reason,
        }).catch(err => console.error('Failed to record sell:', err));

        // 6. Notify success
        await emitToUser(userId, 'position:sold', {
          positionId,
          signature: result.signature,
          tokenMint,
          tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
          tokenAmount,
          solReceived: expectedSol - platformFee,
          reason,
          totalLatencyMs: Date.now() - startTime,
        });

        return {
          success: true,
          signature: result.signature,
          tokenAmount,
          solReceived: expectedSol - platformFee,
          fees: {
            platformFee,
            jitoTip: priorityFeeSol,
            networkFee: 0.000005,
          },
        };
      } else {
        throw new Error(result.error || 'Sell failed after all retries');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await emitToUser(userId, 'position:sell_failed', {
        positionId,
        tokenMint,
        tokenSymbol: tokenSymbol || tokenMint.slice(0, 8),
        error: errorMessage,
        reason,
      });

      return { success: false, error: errorMessage };
    } finally {
      // ALWAYS release the wallet lock when done
      await this.releaseWalletTxLock(walletId, walletLockId);
    }
  }

  /**
   * Get Raydium quote for swap
   */
  private async getRaydiumQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps: number;
    isBuy: boolean;
  }): Promise<RaydiumSwapResponse['data'] | null> {
    try {
      const response = await fetch('https://transaction-v1.raydium.io/compute/swap-base-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `quote-${Date.now()}`,
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount.toString(),
          slippageBps: params.slippageBps,
          txVersion: 'V0',
        }),
      });

      if (!response.ok) {
        console.error('Raydium quote error:', await response.text());
        return null;
      }

      const data: RaydiumSwapResponse = await response.json();
      if (!data.success) {
        console.error('Raydium quote failed:', data);
        return null;
      }

      return data.data;
    } catch (error) {
      console.error('Failed to get Raydium quote:', error);
      return null;
    }
  }

  /**
   * Build swap transaction using Raydium's serialized transaction
   * This is faster than building from scratch
   */
  private async buildSwapTransaction(
    context: SwapContext,
    jitoTip: number
  ): Promise<VersionedTransaction> {
    const { quote, wallet, platformFee, isBuy } = context;

    // Get serialized swap transaction from Raydium
    const txResponse = await fetch('https://transaction-v1.raydium.io/transaction/swap-base-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        computeUnitPriceMicroLamports: Math.floor((jitoTip * LAMPORTS_PER_SOL) / 400_000).toString(),
        swapResponse: quote,
        txVersion: 'V0',
        wallet: wallet.publicKey.toBase58(),
        wrapSol: isBuy, // Wrap SOL when buying
        unwrapSol: !isBuy, // Unwrap when selling
      }),
    });

    if (!txResponse.ok) {
      throw new Error(`Raydium transaction API error: ${await txResponse.text()}`);
    }

    const txData: RaydiumTxResponse = await txResponse.json();
    if (!txData.success || !txData.data?.[0]?.transaction) {
      throw new Error('Raydium returned no transaction data');
    }

    // Decode the base64 transaction
    const txBuffer = Buffer.from(txData.data[0].transaction, 'base64');
    let transaction = VersionedTransaction.deserialize(txBuffer);

    // Now we need to add our platform fee and Jito tip
    // We'll rebuild with the swap instructions + our additions
    const { blockhash, lastValidBlockHeight } = await this.getBlockhash();

    // Get the message and extract lookup tables
    const message = transaction.message;
    const lookupTableAddresses = message.addressTableLookups.map(lookup => lookup.accountKey);

    // Fetch lookup tables with caching (reduces Helius RPC calls significantly)
    let lookupTables: AddressLookupTableAccount[] = [];
    if (lookupTableAddresses.length > 0) {
      const now = Date.now();
      const uncachedAddresses: PublicKey[] = [];
      const uncachedIndices: number[] = [];

      // Check cache first
      for (let i = 0; i < lookupTableAddresses.length; i++) {
        const key = lookupTableAddresses[i].toBase58();
        const cached = this.lookupTableCache.get(key);
        if (cached && now - cached.fetchedAt < this.LOOKUP_TABLE_CACHE_MS) {
          lookupTables.push(cached.account);
        } else {
          uncachedAddresses.push(lookupTableAddresses[i]);
          uncachedIndices.push(i);
        }
      }

      // Fetch uncached lookup tables
      if (uncachedAddresses.length > 0) {
        const fetchedAccounts = await this.primaryConnection.getMultipleAccountsInfo(uncachedAddresses);
        for (let i = 0; i < fetchedAccounts.length; i++) {
          const account = fetchedAccounts[i];
          if (account) {
            const lookupTable = new AddressLookupTableAccount({
              key: uncachedAddresses[i],
              state: AddressLookupTableAccount.deserialize(account.data),
            });
            lookupTables.push(lookupTable);
            // Cache the lookup table
            this.lookupTableCache.set(uncachedAddresses[i].toBase58(), {
              account: lookupTable,
              fetchedAt: now,
            });
          }
        }
      }
    }

    // Decompile the transaction to get instructions
    const decompiledMessage = TransactionMessage.decompile(message, { addressLookupTableAccounts: lookupTables });
    const originalInstructions = decompiledMessage.instructions;

    // Build new instructions array
    const instructions: TransactionInstruction[] = [];

    // 1. Compute budget (replace Raydium's with our higher limit)
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: Math.floor((jitoTip * LAMPORTS_PER_SOL) / 400_000),
    }));

    // 2. Platform fee transfer (before swap for buys, we take from input)
    if (platformFee > 0 && isBuy) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: this.platformFeeWallet,
          lamports: Math.floor(platformFee * LAMPORTS_PER_SOL),
        })
      );
    }

    // 3. Add original swap instructions (skip compute budget instructions from Raydium)
    for (const ix of originalInstructions) {
      const isComputeBudget = ix.programId.equals(ComputeBudgetProgram.programId);
      if (!isComputeBudget) {
        instructions.push(ix);
      }
    }

    // 4. Platform fee for sells (taken from output SOL)
    if (platformFee > 0 && !isBuy) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: this.platformFeeWallet,
          lamports: Math.floor(platformFee * LAMPORTS_PER_SOL),
        })
      );
    }

    // 5. Jito tip (random tip account for load distribution)
    const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(tipAccount),
        lamports: Math.floor(jitoTip * LAMPORTS_PER_SOL),
      })
    );

    // Build new versioned transaction
    const newMessage = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables);

    const newTransaction = new VersionedTransaction(newMessage);
    newTransaction.sign([wallet]);

    return newTransaction;
  }

  /**
   * Submit with multi-path failsafe and parallel Jito submission
   */
  private async submitWithFailsafe(params: {
    transaction: VersionedTransaction;
    swapContext: SwapContext;
    initialTip: number;
    mevProtection: boolean;
  }): Promise<{ success: boolean; signature?: string; error?: string }> {
    const { swapContext, initialTip, mevProtection } = params;
    let { transaction } = params;
    const { userId, sniperId, tokenSymbol } = swapContext;

    // Build attempt sequence - optimized for speed and landing rate
    const attempts = mevProtection
      ? [
          { path: 'jito-parallel', tipMultiplier: 1.5 },   // Start higher
          { path: 'jito-parallel', tipMultiplier: 2.5 },   // Aggressive bump
          { path: 'helius', tipMultiplier: 3.5 },          // Helius staked
          { path: 'direct', tipMultiplier: 5 },            // Last resort
        ]
      : [
          { path: 'helius', tipMultiplier: 1.5 },
          { path: 'helius', tipMultiplier: 2.5 },
          { path: 'direct', tipMultiplier: 4 },
        ];

    console.log(`   🔄 Submission strategy: ${attempts.map(a => `${a.path}(${a.tipMultiplier}x)`).join(' → ')}`);

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const attemptTip = initialTip * attempt.tipMultiplier;

      console.log(`   📤 Attempt ${i + 1}/${attempts.length}: ${attempt.path} (tip: ${attemptTip.toFixed(4)} SOL)`);

      // Rebuild transaction with new tip if not first attempt
      if (i > 0) {
        console.log(`      Rebuilding transaction with higher tip...`);
        await emitToUser(userId, 'snipe:retrying', {
          sniperId,
          tokenSymbol,
          attempt: i + 1,
          maxAttempts: attempts.length,
          path: attempt.path,
          newTip: attemptTip,
        });

        transaction = await this.rebuildWithNewTip(swapContext, attemptTip);
      }

      try {
        await emitToUser(userId, 'snipe:submitting', {
          sniperId,
          tokenSymbol,
          path: attempt.path,
          attempt: i + 1,
        });

        let signature: string | null = null;
        const submitStart = Date.now();

        if (attempt.path === 'jito-parallel') {
          signature = await this.submitToJitoParallel(transaction);
        } else if (attempt.path === 'helius') {
          signature = await this.submitToHelius(transaction);
        } else {
          signature = await this.submitDirect(transaction);
        }

        const submitDuration = Date.now() - submitStart;

        if (signature) {
          console.log(`      ✓ Submitted in ${submitDuration}ms, signature: ${signature.slice(0, 16)}...`);
          console.log(`      ⏳ Waiting for confirmation...`);

          // Confirm transaction
          const confirmStart = Date.now();
          const confirmed = await this.confirmTransactionFast(signature);
          const confirmDuration = Date.now() - confirmStart;

          if (confirmed) {
            console.log(`      ✅ Confirmed in ${confirmDuration}ms`);
            return { success: true, signature };
          } else {
            console.log(`      ❌ Confirmation failed/timed out after ${confirmDuration}ms`);
          }
        } else {
          console.log(`      ❌ No signature returned after ${submitDuration}ms`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.log(`      ❌ Error: ${errorMsg}`);
      }

      // Minimal delay before retry - speed is critical
      if (i < attempts.length - 1) {
        await this.sleep(25);
      }
    }

    return { success: false, error: 'All submission attempts failed' };
  }

  /**
   * Submit to ALL Jito block engines in parallel - first success wins
   * Returns the transaction signature after polling for bundle confirmation
   */
  private async submitToJitoParallel(transaction: VersionedTransaction): Promise<string | null> {
    // CRITICAL: Jito expects base58-encoded transactions, NOT base64
    const serializedBytes = transaction.serialize();
    const bs58 = await import('bs58');
    const serialized = bs58.default.encode(serializedBytes);

    // Extract the transaction signature directly from the signed transaction
    // This allows us to verify on-chain even if Jito polling fails
    const txSignatureBytes = transaction.signatures[0];
    const txSignature = txSignatureBytes
      ? bs58.default.encode(txSignatureBytes)
      : null;

    // Submit to all Jito endpoints in parallel
    const submissions = JITO_BLOCK_ENGINES.map(async (endpoint) => {
      try {
        const response = await fetch(`${endpoint}/api/v1/bundles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendBundle',
            params: [[serialized]],
          }),
        });

        const result = await response.json();
        if (result.error) {
          // Log specific Jito errors for debugging
          console.log(`      Jito ${endpoint.split('.')[0].replace('https://', '')}: ${result.error.message}`);
          throw new Error(result.error.message);
        }

        return { bundleId: result.result as string, endpoint };
      } catch (error) {
        // Log which endpoint failed
        const errMsg = error instanceof Error ? error.message : 'unknown';
        if (!errMsg.includes('Jito')) { // Don't double-log
          console.log(`      Jito ${endpoint.split('.')[0].replace('https://', '')}: ${errMsg.slice(0, 50)}`);
        }
        return null;
      }
    });

    // Wait for all submissions (not just first - we want to know which succeeded)
    const results = await Promise.allSettled(submissions);

    let bundleId: string | null = null;
    let successEndpoint: string | null = null;
    let successCount = 0;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        successCount++;
        if (!bundleId) {
          bundleId = result.value.bundleId;
          successEndpoint = result.value.endpoint;
        }
      }
    }

    if (!bundleId) {
      console.log(`      ⚠️ All Jito endpoints rejected the bundle`);
      return null;
    }

    console.log(`      Jito: ${successCount}/${JITO_BLOCK_ENGINES.length} accepted, bundle: ${bundleId.slice(0, 12)}...`);

    // Poll for bundle status to get the actual transaction signature
    // Jito bundles typically land within 1-2 slots (~800ms)
    const signature = await this.pollJitoBundleStatus(bundleId, successEndpoint!);

    return signature;
  }

  /**
   * Poll Jito for bundle status and return the transaction signature when confirmed
   * Optimized for speed with aggressive polling and early timeout
   */
  private async pollJitoBundleStatus(bundleId: string, endpoint: string): Promise<string | null> {
    const maxAttempts = 12; // ~3 seconds total (was 10 seconds)
    const pollIntervalMs = 250; // Poll every 250ms (was 500ms)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`${endpoint}/api/v1/bundles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBundleStatuses',
            params: [[bundleId]],
          }),
        });

        const result = await response.json();

        if (result.result?.value?.[0]) {
          const bundleStatus = result.result.value[0];
          const status = bundleStatus.confirmation_status;

          if (status === 'confirmed' || status === 'finalized') {
            // Bundle landed - extract transaction signatures
            const txSignatures = bundleStatus.transactions || [];
            if (txSignatures.length > 0) {
              console.log(`      Jito bundle ${bundleId.slice(0, 12)}... confirmed: ${txSignatures[0].slice(0, 16)}...`);
              return txSignatures[0];
            }
          } else if (status === 'failed' || bundleStatus.err) {
            console.log(`      Jito bundle failed: ${bundleStatus.err || 'unknown'}`);
            return null;
          }
          // Status is 'processed' or pending - keep polling
        }
      } catch (error) {
        // Silent fail - continue polling
      }

      await this.sleep(pollIntervalMs);
    }

    // Don't log warning - this is expected when bundle doesn't land quickly
    return null;
  }

  /**
   * Submit via Helius staked connections
   */
  private async submitToHelius(transaction: VersionedTransaction): Promise<string | null> {
    try {
      // Use sendRawTransaction for more control
      const serialized = transaction.serialize();

      // Extract expected signature from the transaction for comparison
      const bs58 = await import('bs58');
      const expectedSig = bs58.default.encode(transaction.signatures[0]);

      // Log transaction size and key details for debugging
      console.log(`      Helius: Sending ${serialized.length} byte transaction...`);
      console.log(`      Helius: Expected signature: ${expectedSig.slice(0, 20)}...`);

      const signature = await this.heliusConnection.sendRawTransaction(serialized, {
        skipPreflight: false, // Enable preflight to catch errors BEFORE submission
        maxRetries: 2, // Allow some retries for reliability
        preflightCommitment: 'processed',
      });

      // Compare returned signature with expected
      if (signature !== expectedSig) {
        console.log(`      ⚠️ Helius returned different signature than expected!`);
        console.log(`         Expected: ${expectedSig.slice(0, 30)}...`);
        console.log(`         Got: ${signature.slice(0, 30)}...`);
      }

      console.log(`      Helius: Transaction accepted, signature: ${signature.slice(0, 20)}...`);
      return signature;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Log full error for debugging
      console.log(`      Helius error: ${errMsg}`);

      // Check for specific error types
      if (errMsg.includes('Blockhash not found')) {
        console.log(`      ⚠️ Blockhash expired - need fresher blockhash`);
      } else if (errMsg.includes('already been processed')) {
        console.log(`      ℹ️ Transaction already processed`);
      } else if (errMsg.includes('insufficient funds')) {
        console.log(`      ⚠️ Insufficient funds in wallet`);
      }
      return null;
    }
  }

  /**
   * Submit directly to RPC with higher retry count
   */
  private async submitDirect(transaction: VersionedTransaction): Promise<string | null> {
    const connection = this.backupConnection || this.primaryConnection;

    try {
      // Use sendRawTransaction for more control and reliability
      const serialized = transaction.serialize();
      console.log(`      Direct: Sending ${serialized.length} byte transaction...`);

      const signature = await connection.sendRawTransaction(serialized, {
        skipPreflight: false, // Enable preflight to catch errors
        maxRetries: 3,
        preflightCommitment: 'processed',
      });
      console.log(`      Direct: Transaction accepted, signature: ${signature.slice(0, 20)}...`);
      return signature;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log(`      Direct RPC error: ${errMsg}`);
      return null;
    }
  }

  /**
   * Fast transaction confirmation with timeout
   * Optimized for migration sniping - aggressive initial polling, then backoff
   */
  private async confirmTransactionFast(signature: string): Promise<boolean> {
    const startTime = Date.now();
    const timeout = 12000; // 12 second timeout (was 30s) - if not confirmed by then, retry with higher tip
    let pollInterval = 400; // Start aggressive at 400ms
    const maxPollInterval = 1500; // Max 1.5 seconds between polls

    try {
      // Poll for confirmation with gradual backoff
      while (Date.now() - startTime < timeout) {
        const status = await this.primaryConnection.getSignatureStatus(signature);

        if (status.value) {
          if (status.value.err) {
            // Log the specific error for debugging
            const errStr = JSON.stringify(status.value.err);
            console.log(`      ⚠️ Transaction error: ${errStr.slice(0, 100)}`);
            return false;
          }

          if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
            return true;
          }
        }

        // Wait before next poll (with gradual backoff)
        await this.sleep(pollInterval);
        pollInterval = Math.min(pollInterval * 1.3, maxPollInterval);
      }

      return false;
    } catch (error) {
      // Silent fail - let caller handle retry
      return false;
    }
  }

  /**
   * Rebuild transaction with new tip (preserves swap instructions)
   */
  private async rebuildWithNewTip(context: SwapContext, newTip: number): Promise<VersionedTransaction> {
    // Rebuild the entire transaction with new tip
    return this.buildSwapTransaction(context, newTip);
  }

  /**
   * Build a PumpSwap buy transaction with all necessary instructions
   */
  private async buildPumpSwapBuyTransaction(
    wallet: Keypair,
    quote: PumpSwapQuote,
    jitoTip: number,
    platformFee: number
  ): Promise<VersionedTransaction> {
    const { blockhash } = await this.getBlockhash();

    // Get swap instructions from PumpSwap service
    const { instructions: swapInstructions, cleanupInstructions } = await this.pumpSwapService.buildBuyInstruction(wallet, quote);

    const instructions: TransactionInstruction[] = [];

    // 1. Compute budget
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: Math.floor((jitoTip * LAMPORTS_PER_SOL) / 400_000),
    }));

    // 2. Platform fee transfer (before swap)
    if (platformFee > 0) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: this.platformFeeWallet,
          lamports: Math.floor(platformFee * LAMPORTS_PER_SOL),
        })
      );
    }

    // 3. Add PumpSwap instructions
    instructions.push(...swapInstructions);

    // 4. Add cleanup (close WSOL account)
    instructions.push(...cleanupInstructions);

    // 5. Jito tip
    const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(tipAccount),
        lamports: Math.floor(jitoTip * LAMPORTS_PER_SOL),
      })
    );

    // Build versioned transaction
    const message = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    transaction.sign([wallet]);

    // Verify the transaction was signed correctly
    const signerPubkey = transaction.message.staticAccountKeys[0];
    if (signerPubkey.toBase58() !== wallet.publicKey.toBase58()) {
      console.error(`   ❌ CRITICAL: Transaction signer mismatch!`);
      console.error(`      Transaction signer: ${signerPubkey.toBase58()}`);
      console.error(`      Wallet pubkey: ${wallet.publicKey.toBase58()}`);
    }

    // Log transaction details for debugging
    console.log(`   📝 Transaction built:`);
    console.log(`      Signer: ${wallet.publicKey.toBase58().slice(0, 16)}...`);
    console.log(`      Blockhash: ${blockhash.slice(0, 16)}...`);
    console.log(`      Instructions: ${instructions.length}`);

    return transaction;
  }

  /**
   * Submit PumpSwap transaction with failsafe retry logic
   * Implements tip escalation on retries for better landing rate
   */
  private async submitPumpSwapWithFailsafe(params: {
    transaction: VersionedTransaction;
    wallet: Keypair;
    pumpSwapQuote: PumpSwapQuote;
    platformFee: number;
    initialTip: number;
    mevProtection: boolean;
    userId: string;
    sniperId?: string;
    tokenSymbol?: string;
  }): Promise<{ success: boolean; signature?: string; error?: string }> {
    const { wallet, pumpSwapQuote, platformFee, initialTip, mevProtection, userId, sniperId, tokenSymbol } = params;
    let { transaction } = params;

    // Build attempt sequence - optimized for speed and landing rate
    // Migration snipes are highly competitive - use aggressive tips
    // Strategy: Jito first (MEV protected), then Helius staked, then direct
    //
    // NOTE: We NO LONGER escalate slippage on retries.
    // PumpSwap AMM calculates "minimum SOL needed for minTokensOut tokens" and only spends that.
    // Escalating slippage (lowering minTokensOut) caused users to spend LESS SOL, not more!
    // Now we use fixed 2% execution tolerance on minTokensOut (set in getBuyQuote).
    const attempts = mevProtection
      ? [
          { path: 'jito-parallel', tipMultiplier: 1.5 },
          { path: 'jito-parallel', tipMultiplier: 2.5 },
          { path: 'helius', tipMultiplier: 3.5 },
          { path: 'direct', tipMultiplier: 5 },
        ]
      : [
          { path: 'helius', tipMultiplier: 1.5 },
          { path: 'helius', tipMultiplier: 2.5 },
          { path: 'direct', tipMultiplier: 4 },
        ];

    console.log(`   🔄 PumpSwap submission strategy: ${attempts.map(a => `${a.path}(tip:${a.tipMultiplier}x)`).join(' → ')}`);

    // Log transaction details for debugging
    console.log(`   📋 Transaction details:`);
    console.log(`      Pool: ${pumpSwapQuote.poolAddress}`);
    console.log(`      Token: ${pumpSwapQuote.tokenMint}`);
    console.log(`      Base Vault: ${pumpSwapQuote.baseVault}`);
    console.log(`      Quote Vault: ${pumpSwapQuote.quoteVault}`);
    console.log(`      Coin Creator: ${pumpSwapQuote.coinCreator}`);
    console.log(`      Expected tokens: ${Number(pumpSwapQuote.expectedTokens) / 1e6}`);
    console.log(`      Min tokens out: ${Number(pumpSwapQuote.minTokensOut) / 1e6}`);
    console.log(`      Max SOL spend: ${Number(pumpSwapQuote.maxSolSpend) / 1e9} SOL`);

    // Simulate transaction FIRST to catch errors before submitting
    // Use sigVerify: true to ensure the signature is valid
    try {
      console.log(`   🔬 Simulating transaction with signature verification...`);
      const simulation = await this.heliusConnection.simulateTransaction(transaction, {
        sigVerify: true, // CRITICAL: Verify signature is valid
        replaceRecentBlockhash: false, // Use the actual blockhash in the transaction
      });

      if (simulation.value.err) {
        console.log(`   ❌ SIMULATION FAILED: ${JSON.stringify(simulation.value.err)}`);
        if (simulation.value.logs) {
          console.log(`   📋 Simulation logs (last 15):`);
          simulation.value.logs.slice(-15).forEach(log => console.log(`      ${log}`));
        }
        // Log more details about the error
        const errStr = JSON.stringify(simulation.value.err);
        if (errStr.includes('3005')) {
          console.log(`   ⚠️ Error 3005 = AccountNotEnoughKeys - instruction missing required accounts`);
        } else if (errStr.includes('3004')) {
          console.log(`   ⚠️ Error 3004 = AccountDidNotDeserialize - wrong account type`);
        } else if (errStr.includes('3012')) {
          console.log(`   ⚠️ Error 3012 = AccountNotInitialized - account needs to be created first`);
        }
        return { success: false, error: `Simulation failed: ${JSON.stringify(simulation.value.err)}` };
      }
      console.log(`   ✓ Simulation passed (${simulation.value.unitsConsumed} CU used)`);
    } catch (simError) {
      console.log(`   ⚠️ Simulation error (continuing anyway): ${simError instanceof Error ? simError.message : String(simError)}`);
    }

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const attemptTip = initialTip * attempt.tipMultiplier;

      console.log(`   📤 Attempt ${i + 1}/${attempts.length}: ${attempt.path} (tip: ${attemptTip.toFixed(4)} SOL)`);

      // ALWAYS rebuild transaction for each attempt to ensure fresh blockhash
      // This is critical - stale blockhashes cause "transaction is invalid" errors
      if (i > 0) {
        console.log(`      Rebuilding PumpSwap transaction with fresh blockhash and higher tip...`);
        await emitToUser(userId, 'snipe:retrying', {
          sniperId,
          tokenSymbol,
          attempt: i + 1,
          maxAttempts: attempts.length,
          path: attempt.path,
          newTip: attemptTip,
        });
      }

      // Use the original quote's minTokensOut (with 2% execution tolerance)
      // We no longer adjust slippage on retries - that was causing less SOL to be spent!
      // Force fresh blockhash for every attempt by clearing cache
      this.cachedBlockhash = null;
      transaction = await this.buildPumpSwapBuyTransaction(wallet, pumpSwapQuote, attemptTip, platformFee);

      try {
        await emitToUser(userId, 'snipe:submitting', {
          sniperId,
          tokenSymbol,
          path: attempt.path,
          attempt: i + 1,
        });

        let signature: string | null = null;
        const submitStart = Date.now();

        if (attempt.path === 'jito-parallel') {
          signature = await this.submitToJitoParallel(transaction);
        } else if (attempt.path === 'helius') {
          signature = await this.submitToHelius(transaction);
        } else {
          signature = await this.submitDirect(transaction);
        }

        const submitDuration = Date.now() - submitStart;

        if (signature) {
          console.log(`      ✓ Submitted in ${submitDuration}ms, signature: ${signature.slice(0, 16)}...`);
          console.log(`      ⏳ Waiting for confirmation...`);

          const confirmStart = Date.now();
          const confirmed = await this.confirmTransactionFast(signature);
          const confirmDuration = Date.now() - confirmStart;

          if (confirmed) {
            console.log(`      ✅ Confirmed in ${confirmDuration}ms`);
            return { success: true, signature };
          } else {
            console.log(`      ❌ Confirmation failed/timed out after ${confirmDuration}ms`);
          }
        } else {
          console.log(`      ❌ No signature returned after ${submitDuration}ms`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.log(`      ❌ Error: ${errorMsg}`);
      }

      // Minimal delay before retry - speed is critical for migration sniping
      if (i < attempts.length - 1) {
        const delay = 25; // Fixed 25ms delay - just enough for state to settle
        await this.sleep(delay);
      }
    }

    return { success: false, error: 'All PumpSwap submission attempts failed' };
  }

  /**
   * Build a PumpSwap sell transaction with all necessary instructions
   */
  private async buildPumpSwapSellTransaction(
    wallet: Keypair,
    quote: PumpSwapSellQuote,
    jitoTip: number,
    platformFee: number
  ): Promise<VersionedTransaction> {
    const { blockhash } = await this.getBlockhash();

    // Get swap instructions from PumpSwap service
    const { instructions: swapInstructions, cleanupInstructions } = await this.pumpSwapService.buildSellInstruction(wallet, quote);

    const instructions: TransactionInstruction[] = [];

    // 1. Compute budget
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: Math.floor((jitoTip * LAMPORTS_PER_SOL) / 400_000),
    }));

    // 2. Add PumpSwap sell instructions
    instructions.push(...swapInstructions);

    // 3. Add cleanup (close WSOL account to receive SOL)
    instructions.push(...cleanupInstructions);

    // 4. Platform fee transfer (after swap, from received SOL)
    if (platformFee > 0) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: this.platformFeeWallet,
          lamports: Math.floor(platformFee * LAMPORTS_PER_SOL),
        })
      );
    }

    // 5. Jito tip
    const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(tipAccount),
        lamports: Math.floor(jitoTip * LAMPORTS_PER_SOL),
      })
    );

    // Build versioned transaction
    const message = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    transaction.sign([wallet]);

    return transaction;
  }

  /**
   * Submit PumpSwap sell transaction with failsafe retry logic
   */
  private async submitPumpSwapSellWithFailsafe(params: {
    transaction: VersionedTransaction;
    wallet: Keypair;
    pumpSwapQuote: PumpSwapSellQuote;
    platformFee: number;
    initialTip: number;
    userId: string;
    positionId: string;
    tokenSymbol?: string;
  }): Promise<{ success: boolean; signature?: string; error?: string }> {
    const { wallet, pumpSwapQuote, platformFee, initialTip, userId, positionId, tokenSymbol } = params;
    let { transaction } = params;

    // Optimized sell submission strategy - aggressive tips for fast landing
    // Sells are less time-critical than snipes but still benefit from fast execution
    const attempts = [
      { path: 'jito-parallel', tipMultiplier: 1.2 },   // Start slightly higher for better landing
      { path: 'jito-parallel', tipMultiplier: 2 },     // Aggressive bump on first retry
      { path: 'helius', tipMultiplier: 3 },            // Helius staked with high priority
      { path: 'direct', tipMultiplier: 4 },            // Last resort - very high priority
    ];

    console.log(`   🔄 PumpSwap SELL submission strategy: ${attempts.map(a => `${a.path}(${a.tipMultiplier}x)`).join(' → ')}`);

    // Simulate transaction FIRST to catch errors before submitting (like buys do)
    try {
      console.log(`   🔬 Simulating sell transaction...`);
      const simulation = await this.heliusConnection.simulateTransaction(transaction, {
        sigVerify: true,
        replaceRecentBlockhash: false,
      });

      if (simulation.value.err) {
        console.log(`   ❌ SELL SIMULATION FAILED: ${JSON.stringify(simulation.value.err)}`);
        if (simulation.value.logs) {
          console.log(`   📋 Simulation logs (last 10):`);
          simulation.value.logs.slice(-10).forEach(log => console.log(`      ${log}`));
        }
        return { success: false, error: `Simulation failed: ${JSON.stringify(simulation.value.err)}` };
      }
      console.log(`   ✓ Simulation passed (${simulation.value.unitsConsumed} CU used)`);
    } catch (simError) {
      console.log(`   ⚠️ Simulation error (continuing anyway): ${simError instanceof Error ? simError.message : String(simError)}`);
    }

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const attemptTip = initialTip * attempt.tipMultiplier;

      console.log(`   📤 Attempt ${i + 1}/${attempts.length}: ${attempt.path} (tip: ${attemptTip.toFixed(4)} SOL)`);

      // Rebuild transaction with new tip if not first attempt
      if (i > 0) {
        console.log(`      Rebuilding PumpSwap sell transaction with higher tip...`);
        await emitToUser(userId, 'position:sell_retrying', {
          positionId,
          tokenSymbol,
          attempt: i + 1,
          maxAttempts: attempts.length,
          path: attempt.path,
          newTip: attemptTip,
        });

        transaction = await this.buildPumpSwapSellTransaction(wallet, pumpSwapQuote, attemptTip, platformFee);
      }

      try {
        let signature: string | null = null;
        const submitStart = Date.now();

        if (attempt.path === 'jito-parallel') {
          signature = await this.submitToJitoParallel(transaction);
        } else if (attempt.path === 'helius') {
          signature = await this.submitToHelius(transaction);
        } else {
          signature = await this.submitDirect(transaction);
        }

        const submitDuration = Date.now() - submitStart;

        if (signature) {
          console.log(`      ✓ Submitted in ${submitDuration}ms, signature: ${signature.slice(0, 16)}...`);
          console.log(`      ⏳ Waiting for confirmation...`);

          const confirmStart = Date.now();
          const confirmed = await this.confirmTransactionFast(signature);
          const confirmDuration = Date.now() - confirmStart;

          if (confirmed) {
            console.log(`      ✅ Confirmed in ${confirmDuration}ms`);
            return { success: true, signature };
          } else {
            console.log(`      ❌ Confirmation failed/timed out after ${confirmDuration}ms`);
          }
        } else {
          console.log(`      ❌ No signature returned after ${submitDuration}ms`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.log(`      ❌ Error: ${errorMsg}`);
      }

      // Minimal delay before retry - speed matters for sells too
      if (i < attempts.length - 1) {
        const delay = 25; // Fixed 25ms delay - just enough for state to settle (same as buys)
        await this.sleep(delay);
      }
    }

    // CRITICAL: After all attempts fail, check if sell actually succeeded on-chain
    // This handles the case where tx landed but confirmation timed out
    console.log(`   🔍 Checking on-chain state after submission failures...`);
    try {
      const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      const tokenMint = new PublicKey(pumpSwapQuote.tokenMint);
      const token2022ATA = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const tokenATA = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey, false, TOKEN_PROGRAM_ID);

      // Check both token programs
      const [token2022Result, tokenResult] = await Promise.allSettled([
        this.primaryConnection.getTokenAccountBalance(token2022ATA),
        this.primaryConnection.getTokenAccountBalance(tokenATA),
      ]);

      let currentBalance = 0n;
      if (token2022Result.status === 'fulfilled') {
        currentBalance = BigInt(token2022Result.value.value.amount);
      } else if (tokenResult.status === 'fulfilled') {
        currentBalance = BigInt(tokenResult.value.value.amount);
      }

      if (currentBalance === 0n) {
        // Tokens are gone! The sell succeeded even though confirmation failed
        console.log(`   ✅ On-chain verification: Token balance is 0 - sell DID succeed!`);

        // Try to find the actual transaction signature from recent wallet history
        const sigs = await this.primaryConnection.getSignaturesForAddress(wallet.publicKey, { limit: 3 });
        const recentSig = sigs[0]?.signature || 'unknown';
        console.log(`   📝 Most recent wallet tx: ${recentSig.slice(0, 16)}...`);

        return { success: true, signature: recentSig };
      } else {
        console.log(`   ❌ On-chain verification: Token balance is ${currentBalance} - sell truly failed`);
      }
    } catch (verifyError) {
      console.log(`   ⚠️ On-chain verification error: ${verifyError instanceof Error ? verifyError.message : 'Unknown'}`);
    }

    return { success: false, error: 'All PumpSwap sell submission attempts failed' };
  }

  /**
   * Get wallet keypair securely
   */
  private async getWalletKeypair(userId: string, walletId: string): Promise<Keypair | null> {
    try {
      const wallet = await prisma.wallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet || wallet.walletType !== 'generated') {
        console.log(`   ⚠️ Wallet not found or not generated type`);
        return null;
      }

      const encrypted: EncryptedKey = {
        ciphertext: wallet.encryptedPrivateKey || '',
        iv: wallet.iv || '',
        authTag: wallet.authTag || '',
        version: 1,
      };

      const privateKey = await this.secureWallet.decryptPrivateKey(encrypted, userId);

      // CRITICAL BUG FIX: Keypair.fromSecretKey() does NOT copy the key - it uses the
      // same buffer reference! If we zero the buffer, we corrupt the keypair's secret key.
      // Solution: Make a copy of the private key for the keypair to use.
      const privateKeyCopy = new Uint8Array(privateKey);
      const keypair = Keypair.fromSecretKey(privateKeyCopy);

      // Now we can safely zero out our original decrypted buffer
      privateKey.fill(0);

      // CRITICAL: Verify the decrypted keypair matches the stored wallet address
      const expectedAddress = wallet.publicKey;
      const actualAddress = keypair.publicKey.toBase58();

      if (expectedAddress !== actualAddress) {
        console.error(`   ❌ CRITICAL: Wallet address mismatch!`);
        console.error(`      Expected: ${expectedAddress}`);
        console.error(`      Got: ${actualAddress}`);
        console.error(`   This means the decryption is producing wrong keys!`);
        // Zero out the keypair's copy too
        privateKeyCopy.fill(0);
        return null;
      }

      console.log(`   ✓ Wallet verified: ${actualAddress.slice(0, 12)}...`);

      // NOTE: We intentionally do NOT zero privateKeyCopy here because the Keypair
      // object needs it for signing. The keypair (and its secret key) will be
      // garbage collected after the transaction is complete.

      return keypair;
    } catch (error) {
      console.error('Failed to get wallet keypair:', error);
      return null;
    }
  }

  /**
   * Record buy transaction in database
   */
  private async recordTransaction(params: {
    userId: string;
    walletId: string;
    sniperId?: string;
    signature: string;
    tokenMint: string;
    tokenSymbol?: string;
    tokenName?: string;
    initialMarketCapUsd?: number; // Market cap from migration event (fallback only)
    solAmount: number;
    tokenAmount: number;
    platformFee: number;
    jitoTip: number;
    txType: 'buy' | 'sell';
  }): Promise<void> {
    const { userId, walletId, sniperId, signature, tokenMint, tokenSymbol, tokenName, initialMarketCapUsd, solAmount, tokenAmount, platformFee, jitoTip } = params;

    // Fetch token metadata from DexScreener/Jupiter (for symbol/name if not provided)
    // Only fetch if we don't have the data from migration event
    let fetchedSymbol: string | null = null;
    let fetchedName: string | null = null;
    if (!tokenSymbol || !tokenName) {
      const metadata = await tokenInfoService.getTokenMetadata(tokenMint).catch(() => null);
      if (metadata) {
        fetchedSymbol = metadata.symbol || null;
        fetchedName = metadata.name || null;
      }
    }

    // Use provided values from migration event first, then fall back to fetched data
    const finalSymbol = tokenSymbol || fetchedSymbol;
    const finalName = tokenName || fetchedName;

    // CRITICAL: Calculate entry market cap from ACTUAL execution price
    // This is the TRUE entry market cap - not the migration threshold
    // Formula: (SOL spent / tokens received) * total supply * SOL price in USD
    // PumpFun tokens always have 1 billion total supply with 6 decimals
    const PUMPFUN_TOTAL_SUPPLY = 1_000_000_000; // 1 billion tokens
    const SOL_PRICE_USD = 120; // Current approximate SOL price

    let entryMarketCap: number | null = null;

    if (solAmount > 0 && tokenAmount > 0) {
      // Calculate the actual entry price per token in SOL
      const entryPricePerTokenSol = solAmount / tokenAmount;
      // Calculate market cap: price per token * total supply * SOL price
      entryMarketCap = Math.round(entryPricePerTokenSol * PUMPFUN_TOTAL_SUPPLY * SOL_PRICE_USD);
      console.log(`   📊 Entry MCAP calculated from execution: $${entryMarketCap.toLocaleString()}`);
      console.log(`      (${solAmount} SOL / ${tokenAmount.toFixed(2)} tokens * 1B supply * $${SOL_PRICE_USD})`);
    } else {
      // Fallback to migration event market cap if we can't calculate
      entryMarketCap = initialMarketCapUsd || null;
      console.log(`   ⚠️ Using fallback entry MCAP from migration: $${entryMarketCap?.toLocaleString() || 'null'}`);
    }

    // Create position record with enriched data
    const position = await prisma.position.create({
      data: {
        userId,
        walletId,
        sniperId,
        tokenMint,
        tokenSymbol: finalSymbol,
        tokenName: finalName,
        entrySol: solAmount,
        entryTokenAmount: tokenAmount,
        entryPrice: solAmount / tokenAmount,
        entryMarketCap: entryMarketCap,
        currentTokenAmount: tokenAmount,
        status: 'open',
      },
    });

    // Create transaction record
    await prisma.transaction.create({
      data: {
        userId,
        positionId: position.id,
        signature,
        txType: 'buy',
        tokenMint, // Include tokenMint so trades show in activity log
        solAmount,
        tokenAmount,
        platformFee,
        jitoTip,
        status: 'confirmed',
      },
    });

    // Record fee in ledger
    await prisma.feeLedger.create({
      data: {
        userId,
        feeAmount: platformFee,
        feeSol: platformFee,
        settled: false,
      },
    });

    // Activity log
    await prisma.activityLog.create({
      data: {
        userId,
        sniperId,
        eventType: 'snipe:success',
        eventData: { signature, tokenMint, tokenSymbol: finalSymbol, solAmount, tokenAmount, platformFee, jitoTip },
      },
    });

    // Emit position:opened event so frontend can update positions in real-time
    await emitToUser(userId, 'position:opened', {
      id: position.id,
      tokenMint,
      tokenSymbol: finalSymbol,
      tokenName: finalName,
      entrySol: solAmount,
      entryPrice: solAmount / tokenAmount,
      entryMarketCap: entryMarketCap,
      entryTokenAmount: tokenAmount,
      currentTokenAmount: tokenAmount,
      status: 'open',
      createdAt: position.createdAt.toISOString(),
      sniperId,
    });
  }

  /**
   * Record sell transaction
   */
  private async recordSellTransaction(params: {
    userId: string;
    positionId: string;
    signature: string;
    tokenMint: string;
    tokenSymbol?: string;
    tokenAmount: number;
    solReceived: number;
    platformFee: number;
    jitoTip: number;
    reason: string;
  }): Promise<void> {
    const { userId, positionId, signature, tokenMint, tokenSymbol, tokenAmount, solReceived, platformFee, jitoTip, reason } = params;

    // Update position to closed
    const position = await prisma.position.update({
      where: { id: positionId },
      data: {
        status: 'closed',
        exitSol: solReceived,
        exitPrice: solReceived / tokenAmount,
        currentTokenAmount: 0,
        closedAt: new Date(),
      },
    });

    // Create sell transaction record
    await prisma.transaction.create({
      data: {
        userId,
        positionId,
        signature,
        txType: 'sell',
        tokenMint, // Include tokenMint so trades show in activity log
        solAmount: solReceived,
        tokenAmount,
        platformFee,
        jitoTip,
        status: 'confirmed',
      },
    });

    // Record fee
    await prisma.feeLedger.create({
      data: {
        userId,
        feeAmount: platformFee,
        feeSol: platformFee,
        settled: false,
      },
    });

    // Activity log
    await prisma.activityLog.create({
      data: {
        userId,
        sniperId: position.sniperId,
        eventType: `position:${reason}`,
        eventData: { signature, tokenMint, tokenSymbol, tokenAmount, solReceived, platformFee },
      },
    });
  }

  /**
   * Get current token price from Jupiter (more reliable than Raydium for new tokens)
   */
  async getTokenPrice(tokenMint: string): Promise<number | null> {
    try {
      // Try Jupiter first (better for new tokens)
      const jupiterResponse = await fetch(
        `https://price.jup.ag/v6/price?ids=${tokenMint}`
      );

      if (jupiterResponse.ok) {
        const data = await jupiterResponse.json();
        if (data.data?.[tokenMint]?.price) {
          return data.data[tokenMint].price;
        }
      }

      // Fallback to Raydium
      const raydiumResponse = await fetch(
        `https://api.raydium.io/v2/main/price?tokens=${tokenMint}`
      );

      if (raydiumResponse.ok) {
        const data = await raydiumResponse.json();
        return data.data?.[tokenMint] || null;
      }

      return null;
    } catch (error) {
      console.error('Failed to get token price:', error);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get executor status for admin dashboard
   */
  getStatus(): {
    rpcConnections: {
      primary: boolean;
      helius: boolean;
      backup: boolean;
    };
    jitoEndpoints: string[];
    mevProtection: boolean;
    blockhashCacheAge: number | null;
    platformFeeWallet: string;
    platformFeeBps: number;
  } {
    return {
      rpcConnections: {
        primary: !!this.primaryConnection,
        helius: !!this.heliusConnection,
        backup: !!this.backupConnection,
      },
      jitoEndpoints: JITO_BLOCK_ENGINES,
      mevProtection: true,
      blockhashCacheAge: this.cachedBlockhash
        ? Date.now() - this.cachedBlockhash.fetchedAt
        : null,
      platformFeeWallet: this.platformFeeWallet.toBase58(),
      platformFeeBps: this.platformFeeBps,
    };
  }
}

// Singleton instance
export const transactionExecutor = new TransactionExecutor();
