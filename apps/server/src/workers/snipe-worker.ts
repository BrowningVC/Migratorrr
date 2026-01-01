import { Worker, Job } from 'bullmq';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { transactionExecutor } from '../services/transaction-executor.js';
import { prisma } from '../db/client.js';
import { emitToUser } from '../websocket/handlers.js';
import { redis } from '../db/redis.js';

// Initialize Solana connection
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(HELIUS_RPC_URL, 'confirmed');

// Balance cache settings - reduces Helius getBalance calls significantly
const BALANCE_CACHE_PREFIX = 'wallet-balance:';
const BALANCE_CACHE_TTL_SECONDS = 30; // Cache balances for 30 seconds

interface SnipeJob {
  sniperId: string;
  userId: string;
  walletId: string;
  walletPublicKey: string;
  sniperName: string;
  config: {
    snipeAmountSol: number;
    slippageBps: number;
    priorityFeeSol: number;
    takeProfitPct?: number;
    stopLossPct?: number;
    trailingStopPct?: number;
    mevProtection?: boolean;
    [key: string]: unknown;
  };
  migration: {
    tokenMint: string;
    tokenName?: string;
    tokenSymbol?: string;
    poolAddress: string;
    coinCreator?: string | null; // Original token creator - required for PumpSwap trades
    initialLiquiditySol: number;
    initialMarketCapUsd?: number;
    detectedBy: string;
    detectedAt: number;
  };
  createdAt: number;
}

/**
 * SnipeWorker - Processes snipe jobs from BullMQ queue
 *
 * Responsibilities:
 * 1. Execute buy transactions via TransactionExecutor
 * 2. Create position records with TP/SL settings
 * 3. Notify users of results in real-time
 * 4. Handle failures gracefully
 */
export class SnipeWorker {
  private worker: Worker | null = null;
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Snipe worker already running');
      return;
    }

    // Worker configuration optimized for 100+ concurrent snipers
    // Key considerations:
    // - Each snipe job takes ~2-5 seconds (balance check, lock acquisition, tx execution)
    // - Helius RPC has generous limits with our API key
    // - Jito bundles can handle high throughput
    // - BullMQ handles job distribution efficiently
    const WORKER_CONCURRENCY = parseInt(process.env.SNIPE_WORKER_CONCURRENCY || '25');
    const RATE_LIMIT_PER_MINUTE = parseInt(process.env.SNIPE_RATE_LIMIT || '200');

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.worker = new Worker<SnipeJob>(
      'snipe-queue',
      async (job) => this.processSnipeJob(job),
      {
        connection: redisUrl,
        concurrency: WORKER_CONCURRENCY, // Process up to 25 snipes concurrently (configurable via env)
        limiter: {
          max: RATE_LIMIT_PER_MINUTE, // Max 200 jobs per minute (configurable via env)
          duration: 60000,
        },
      }
    );

    console.log(`Snipe Worker configured: concurrency=${WORKER_CONCURRENCY}, rateLimit=${RATE_LIMIT_PER_MINUTE}/min`);

    // Event handlers
    this.worker.on('completed', (job) => {
      console.log(`Snipe job ${job.id} completed`);
    });

    this.worker.on('failed', (job, error) => {
      console.error(`Snipe job ${job?.id} failed:`, error);
    });

    this.worker.on('error', (error) => {
      console.error('Snipe worker error:', error);
    });

    this.isRunning = true;
    console.log('Snipe Worker started');
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    this.isRunning = false;
    console.log('Snipe Worker stopped');
  }

  /**
   * Process a single snipe job
   */
  private async processSnipeJob(job: Job<SnipeJob>): Promise<void> {
    const { sniperId, userId, walletId, sniperName, config, migration } =
      job.data;

    const timestamp = new Date().toISOString();
    const tokenLabel = migration.tokenSymbol || migration.tokenMint.slice(0, 8);

    console.log(`\n🎯 [${timestamp}] SNIPE WORKER: Processing job ${job.id}`);
    console.log(`   Token: ${tokenLabel} (${migration.tokenMint})`);
    console.log(`   Sniper: "${sniperName}" (${sniperId.slice(0, 8)}...)`);
    console.log(`   Config: ${config.snipeAmountSol} SOL, ${config.slippageBps}bps slippage, ${config.priorityFeeSol} SOL tip`);
    console.log(`   CoinCreator in job: ${migration.coinCreator || 'NULL/undefined'}`);
    console.log(`   Pool in job: ${migration.poolAddress || 'NULL/undefined'}`);

    // Calculate job latency
    const latencyMs = Date.now() - migration.detectedAt;
    console.log(`   Latency from detection: ${latencyMs}ms`);

    // Update job progress
    await job.updateProgress(10);

    try {
      console.log(`   🔍 Step 1: Validating sniper and wallet...`);

      // Check if sniper is still active and wallet still valid
      const [sniper, wallet] = await Promise.all([
        prisma.sniperConfig.findUnique({
          where: { id: sniperId },
        }),
        prisma.wallet.findUnique({
          where: { id: walletId },
          select: { id: true, userId: true, publicKey: true, walletType: true },
        }),
      ]);

      if (!sniper || !sniper.isActive) {
        console.log(`   ❌ ABORT: Sniper "${sniperName}" is no longer active`);
        await emitToUser(userId, 'snipe:skipped', {
          sniperId,
          sniperName,
          reason: 'Sniper is no longer active',
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
        });
        return;
      }
      console.log(`   ✓ Sniper is active`);

      // CRITICAL: Verify wallet exists, belongs to user, and is a generated wallet
      if (!wallet) {
        console.log(`   ❌ ABORT: Wallet ${walletId} not found`);
        await emitToUser(userId, 'snipe:failed', {
          sniperId,
          sniperName,
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
          error: 'Trading wallet not found',
        });
        return;
      }

      if (wallet.userId !== userId) {
        console.log(`   ❌ ABORT: Wallet ownership mismatch! Expected ${userId}, got ${wallet.userId}`);
        await emitToUser(userId, 'snipe:failed', {
          sniperId,
          sniperName,
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
          error: 'Wallet authorization failed',
        });
        return;
      }

      if (wallet.walletType !== 'generated') {
        console.log(`   ❌ ABORT: Wallet is not a generated wallet (type: ${wallet.walletType})`);
        await emitToUser(userId, 'snipe:failed', {
          sniperId,
          sniperName,
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
          error: 'Only server-generated wallets can execute snipes',
        });
        return;
      }
      console.log(`   ✓ Wallet validated (${wallet.publicKey.slice(0, 8)}...)`);

      await job.updateProgress(20);

      console.log(`   🔍 Step 2: Checking wallet balance...`);
      // Check wallet balance using the public key from the job data
      // Required: snipe amount + priority fee (Jito tip) + platform fee (1%) + network fees buffer
      const platformFeeBps = parseInt(process.env.PLATFORM_FEE_BPS || '100'); // Default 1%
      const platformFee = config.snipeAmountSol * (platformFeeBps / 10000);
      const networkFeeBuffer = 0.001; // ~5000 lamports for tx fees
      const requiredBalance = config.snipeAmountSol + config.priorityFeeSol + platformFee + networkFeeBuffer;

      console.log(`   Required: ${requiredBalance.toFixed(4)} SOL (snipe: ${config.snipeAmountSol}, tip: ${config.priorityFeeSol}, fee: ${platformFee.toFixed(4)}, buffer: ${networkFeeBuffer})`);

      const hasBalance = await this.checkWalletBalance(
        job.data.walletPublicKey,
        requiredBalance
      );

      if (!hasBalance) {
        console.log(`   ❌ ABORT: Insufficient balance for snipe`);

        // Auto-disable the sniper due to insufficient funds
        await prisma.sniperConfig.update({
          where: { id: sniperId },
          data: { isActive: false },
        });
        console.log(`   🔴 Sniper "${sniperName}" auto-disabled due to insufficient balance`);

        await emitToUser(userId, 'snipe:failed', {
          sniperId,
          sniperName,
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
          error: 'Insufficient wallet balance',
        });

        // Notify user that sniper was disabled
        await emitToUser(userId, 'sniper:disabled', {
          sniperId,
          sniperName,
          reason: 'Insufficient wallet balance - please top up your wallet and re-enable the sniper',
          requiredSol: requiredBalance,
        });

        await prisma.activityLog.create({
          data: {
            userId,
            sniperId,
            eventType: 'snipe:failed',
            eventData: {
              tokenMint: migration.tokenMint,
              tokenSymbol: migration.tokenSymbol,
              error: 'Insufficient wallet balance - sniper auto-disabled',
              requiredSol: requiredBalance,
              autoDisabled: true,
            },
          },
        });
        return;
      }
      console.log(`   ✓ Balance sufficient`);

      await job.updateProgress(30);

      console.log(`   🔍 Step 3: Checking for duplicate positions...`);
      // CRITICAL: Final check - verify no existing position for this token + wallet
      // This is a last-resort safeguard against duplicate snipes
      // Check ALL non-closed statuses to catch positions being created/sold
      const existingPosition = await prisma.position.findFirst({
        where: {
          walletId,
          tokenMint: migration.tokenMint,
          status: { in: ['open', 'pending', 'selling'] },
        },
      });

      if (existingPosition) {
        console.log(`   ❌ ABORT: Duplicate position exists (${existingPosition.id}, status: ${existingPosition.status})`);
        await emitToUser(userId, 'snipe:skipped', {
          sniperId,
          sniperName,
          reason: 'Position already exists for this token',
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
        });
        return;
      }
      console.log(`   ✓ No duplicate positions (wallet: ${walletId.slice(0, 8)}, token: ${migration.tokenMint.slice(0, 12)})`);

      // CRITICAL: TWO-LAYER atomic lock system to prevent duplicate snipes
      // Layer 1: Wallet-level lock - prevents ANY snipe to this token from this wallet
      //          This catches cases where user has multiple snipers with same wallet
      // Layer 2: Sniper-level lock - prevents same sniper from double-executing
      //
      // Lock keys use consistent format: prefix:identifier:tokenMint
      // TTL is 5 minutes - long enough for tx to complete + confirmation
      const EXECUTION_LOCK_TTL = 300;

      // Layer 1: WALLET-LEVEL LOCK (most important - prevents wallet from double-buying)
      const walletLockKey = `snipe-wallet-exec:${walletId}:${migration.tokenMint}`;
      const walletLockValue = `${sniperId}:${job.id || Date.now()}`;

      console.log(`   🔒 Attempting wallet lock: ${walletLockKey}`);
      const acquiredWalletLock = await redis.set(walletLockKey, walletLockValue, 'EX', EXECUTION_LOCK_TTL, 'NX');

      if (!acquiredWalletLock) {
        // Check who owns the lock for debugging
        const lockOwner = await redis.get(walletLockKey);
        console.log(`   ❌ ABORT: Wallet already has pending snipe for this token`);
        console.log(`      Lock key: ${walletLockKey}`);
        console.log(`      Lock owner: ${lockOwner}`);
        console.log(`      Our attempt: ${walletLockValue}`);
        await emitToUser(userId, 'snipe:skipped', {
          sniperId,
          sniperName,
          reason: 'Wallet already sniping this token',
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
        });
        return;
      }
      console.log(`   ✓ Wallet lock acquired`);

      // Layer 2: SNIPER-LEVEL LOCK (additional safety)
      const sniperLockKey = `snipe-exec:${sniperId}:${migration.tokenMint}`;
      const acquiredSniperLock = await redis.set(sniperLockKey, job.id || '1', 'EX', EXECUTION_LOCK_TTL, 'NX');

      if (!acquiredSniperLock) {
        // Release wallet lock since we couldn't get sniper lock
        await redis.del(walletLockKey);
        console.log(`   ❌ ABORT: Sniper execution already in progress for this token`);
        console.log(`      Lock key: ${sniperLockKey}`);
        await emitToUser(userId, 'snipe:skipped', {
          sniperId,
          sniperName,
          reason: 'Another snipe already executing for this token',
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
        });
        return;
      }
      console.log(`   ✓ Sniper lock acquired`);

      await job.updateProgress(40);

      console.log(`   🚀 Step 4: Executing snipe transaction...`);
      const txStartTime = Date.now();

      // Execute the snipe
      const result = await transactionExecutor.executeSnipe({
        userId,
        walletId,
        tokenMint: migration.tokenMint,
        poolAddress: migration.poolAddress,
        coinCreator: migration.coinCreator || undefined, // CRITICAL: Pass coinCreator from migration event
        amountSol: config.snipeAmountSol,
        slippageBps: config.slippageBps,
        priorityFeeSol: config.priorityFeeSol,
        sniperId,
        tokenSymbol: migration.tokenSymbol,
        tokenName: migration.tokenName,
        initialMarketCapUsd: migration.initialMarketCapUsd, // CRITICAL: Pass market cap at migration time for accurate entry MCAP
        mevProtection: config.mevProtection ?? true, // Default to enabled
      });

      const txDuration = Date.now() - txStartTime;
      await job.updateProgress(80);

      if (result.success) {
        console.log(`   ✅ SNIPE SUCCESS!`);
        console.log(`      Signature: ${result.signature}`);
        console.log(`      Tokens received: ${result.tokenAmount?.toFixed(4) || 'unknown'}`);
        console.log(`      SOL spent: ${result.solSpent?.toFixed(4) || config.snipeAmountSol} SOL`);
        console.log(`      Transaction time: ${txDuration}ms`);
        console.log(`      Total latency: ${Date.now() - migration.detectedAt}ms`);

        // Update the position with TP/SL settings
        if (result.signature) {
          await this.updatePositionWithAutomation({
            signature: result.signature,
            sniperId,
            config,
          });
        }

        // Update sniper stats
        await prisma.sniperConfig.update({
          where: { id: sniperId },
          data: {
            totalSnipes: { increment: 1 },
            successfulSnipes: { increment: 1 },
            totalSolSpent: { increment: config.snipeAmountSol },
          },
        });

        // Invalidate balance cache after successful snipe
        await SnipeWorker.invalidateBalanceCache(job.data.walletPublicKey);
      } else {
        console.log(`   ❌ SNIPE FAILED!`);
        console.log(`      Error: ${result.error}`);
        console.log(`      Transaction time: ${txDuration}ms`);

        // Update sniper stats for failure
        await prisma.sniperConfig.update({
          where: { id: sniperId },
          data: {
            totalSnipes: { increment: 1 },
            failedSnipes: { increment: 1 },
          },
        });
      }

      await job.updateProgress(100);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`   💥 SNIPE ERROR: ${errorMessage}`);
      console.error('   Full error:', error);

      await emitToUser(userId, 'snipe:failed', {
        sniperId,
        sniperName,
        tokenMint: migration.tokenMint,
        tokenSymbol: migration.tokenSymbol,
        error: errorMessage,
      });

      // Re-throw to mark job as failed
      throw error;
    }
  }

  /**
   * Check if wallet has sufficient balance (with Redis caching to reduce Helius RPC calls)
   * Includes retry logic for RPC failures and better error handling
   */
  private async checkWalletBalance(
    walletPublicKey: string,
    requiredSol: number
  ): Promise<boolean> {
    const cacheKey = `${BALANCE_CACHE_PREFIX}${walletPublicKey}`;
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 500;

    // Check cache first - always use cached value if available
    try {
      const cachedBalance = await redis.get(cacheKey);
      if (cachedBalance !== null) {
        const balanceSol = parseFloat(cachedBalance);
        console.log(`   Wallet ${walletPublicKey} balance (cached): ${balanceSol.toFixed(4)} SOL (required: ${requiredSol.toFixed(4)} SOL)`);
        return balanceSol >= requiredSol;
      }
    } catch (cacheError) {
      console.warn(`   ⚠️ Redis cache error, will fetch from chain:`, cacheError);
    }

    // Fetch from chain with retry logic
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const publicKey = new PublicKey(walletPublicKey);
        const balance = await connection.getBalance(publicKey);
        const balanceSol = balance / LAMPORTS_PER_SOL;

        // Cache the balance
        try {
          await redis.setex(cacheKey, BALANCE_CACHE_TTL_SECONDS, balanceSol.toString());
        } catch (cacheSetError) {
          console.warn(`   ⚠️ Failed to cache balance:`, cacheSetError);
        }

        console.log(`   Wallet ${walletPublicKey} balance (fresh): ${balanceSol.toFixed(4)} SOL (required: ${requiredSol.toFixed(4)} SOL)`);
        return balanceSol >= requiredSol;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`   ⚠️ Balance check attempt ${attempt}/${MAX_RETRIES} failed for ${walletPublicKey}: ${errorMsg}`);

        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }
      }
    }

    // All retries failed - DO NOT proceed with snipe
    // Proceeding would waste transaction fees on a likely-to-fail transaction
    // and could create orphaned database entries
    console.error(`   ❌ All ${MAX_RETRIES} balance check attempts failed for ${walletPublicKey} - SKIPPING snipe (RPC unreachable)`);
    return false;
  }

  /**
   * Invalidate balance cache after a transaction (call this after successful snipes)
   */
  static async invalidateBalanceCache(walletPublicKey: string): Promise<void> {
    const cacheKey = `${BALANCE_CACHE_PREFIX}${walletPublicKey}`;
    await redis.del(cacheKey);
  }

  /**
   * Update position with take profit / stop loss settings
   * Includes retry logic to handle race condition with transaction recording
   */
  private async updatePositionWithAutomation(params: {
    signature: string;
    sniperId: string;
    config: SnipeJob['config'];
  }): Promise<void> {
    const { signature, sniperId, config } = params;

    // Skip if no automation settings configured
    if (!config.takeProfitPct && !config.stopLossPct && !config.trailingStopPct) {
      return;
    }

    // Retry up to 3 times with 500ms delay to handle race condition
    // The transaction/position might not be committed yet when we first check
    let transactionWithPosition: { position: NonNullable<Awaited<ReturnType<typeof prisma.transaction.findFirst>>['position']> } | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const tx = await prisma.transaction.findFirst({
        where: { signature },
        include: { position: true },
      });

      if (tx?.position) {
        transactionWithPosition = { position: tx.position };
        break;
      }

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (!transactionWithPosition) {
      console.error(`[Automation] Position not found for transaction ${signature.slice(0, 20)}... after 3 retries`);
      return;
    }

    const position = transactionWithPosition.position;

    // Calculate TP/SL prices from entry price
    const entryPrice = position.entryPrice || 0;
    if (entryPrice === 0) {
      console.warn(`[Automation] Entry price is 0 for position ${position.id}, skipping TP/SL setup`);
      return;
    }

    const updates: Record<string, unknown> = {};

    if (config.takeProfitPct) {
      updates.takeProfitPrice = entryPrice * (1 + config.takeProfitPct / 100);
    }

    if (config.stopLossPct) {
      updates.stopLossPrice = entryPrice * (1 - config.stopLossPct / 100);
    }

    if (config.trailingStopPct) {
      updates.trailingStopPct = config.trailingStopPct;
      updates.highestPrice = entryPrice; // Start tracking from entry
    }

    if (Object.keys(updates).length > 0) {
      await prisma.position.update({
        where: { id: position.id },
        data: updates,
      });

      console.log(
        `[Automation] Set TP/SL for position ${position.id.slice(0, 8)}...: ` +
        `TP=${(updates.takeProfitPrice as number)?.toExponential(2) || 'none'}, ` +
        `SL=${(updates.stopLossPrice as number)?.toExponential(2) || 'none'}, ` +
        `TrailingStop=${updates.trailingStopPct || 'none'}%`
      );
    }
  }
}

// Singleton instance
export const snipeWorker = new SnipeWorker();
