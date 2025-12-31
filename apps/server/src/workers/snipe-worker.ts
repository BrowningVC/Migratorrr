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

    this.worker = new Worker<SnipeJob>(
      'snipe-queue',
      async (job) => this.processSnipeJob(job),
      {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        },
        concurrency: 10, // Process up to 10 snipes concurrently
        limiter: {
          max: 50, // Max 50 jobs per minute
          duration: 60000,
        },
      }
    );

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
        await emitToUser(userId, 'snipe:failed', {
          sniperId,
          sniperName,
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
          error: 'Insufficient wallet balance',
        });

        await prisma.activityLog.create({
          data: {
            userId,
            sniperId,
            eventType: 'snipe:failed',
            eventData: {
              tokenMint: migration.tokenMint,
              tokenSymbol: migration.tokenSymbol,
              error: 'Insufficient wallet balance',
              requiredSol: requiredBalance,
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
      const existingPosition = await prisma.position.findFirst({
        where: {
          walletId,
          tokenMint: migration.tokenMint,
          status: { in: ['open', 'pending'] },
        },
      });

      if (existingPosition) {
        console.log(`   ❌ ABORT: Duplicate position exists (${existingPosition.id})`);
        await emitToUser(userId, 'snipe:skipped', {
          sniperId,
          sniperName,
          reason: 'Position already exists for this token',
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
        });
        return;
      }
      console.log(`   ✓ No duplicate positions`);

      await job.updateProgress(40);

      console.log(`   🚀 Step 4: Executing snipe transaction...`);
      const txStartTime = Date.now();

      // Execute the snipe
      const result = await transactionExecutor.executeSnipe({
        userId,
        walletId,
        tokenMint: migration.tokenMint,
        poolAddress: migration.poolAddress,
        amountSol: config.snipeAmountSol,
        slippageBps: config.slippageBps,
        priorityFeeSol: config.priorityFeeSol,
        sniperId,
        tokenSymbol: migration.tokenSymbol,
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
   */
  private async checkWalletBalance(
    walletPublicKey: string,
    requiredSol: number
  ): Promise<boolean> {
    const cacheKey = `${BALANCE_CACHE_PREFIX}${walletPublicKey}`;

    try {
      // Check cache first
      const cachedBalance = await redis.get(cacheKey);
      let balanceSol: number;

      if (cachedBalance !== null) {
        balanceSol = parseFloat(cachedBalance);
        console.log(`Wallet ${walletPublicKey.slice(0, 8)}... balance (cached): ${balanceSol.toFixed(4)} SOL (required: ${requiredSol.toFixed(4)} SOL)`);
      } else {
        // Fetch from chain and cache
        const publicKey = new PublicKey(walletPublicKey);
        const balance = await connection.getBalance(publicKey);
        balanceSol = balance / LAMPORTS_PER_SOL;

        // Cache the balance
        await redis.setex(cacheKey, BALANCE_CACHE_TTL_SECONDS, balanceSol.toString());

        console.log(`Wallet ${walletPublicKey.slice(0, 8)}... balance (fresh): ${balanceSol.toFixed(4)} SOL (required: ${requiredSol.toFixed(4)} SOL)`);
      }

      return balanceSol >= requiredSol;
    } catch (error) {
      console.error('Error checking wallet balance:', error);
      // Return false on error to be safe - don't execute snipes if we can't verify balance
      return false;
    }
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
   */
  private async updatePositionWithAutomation(params: {
    signature: string;
    sniperId: string;
    config: SnipeJob['config'];
  }): Promise<void> {
    const { signature, sniperId, config } = params;

    // Find the position created by the transaction
    const transaction = await prisma.transaction.findFirst({
      where: { signature },
      include: { position: true },
    });

    if (!transaction?.position) {
      console.warn(`Position not found for transaction ${signature}`);
      return;
    }

    const position = transaction.position;

    // Calculate TP/SL prices
    const entryPrice = position.entryPrice || 0;
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
        `Updated position ${position.id} with automation settings:`,
        updates
      );
    }
  }
}

// Singleton instance
export const snipeWorker = new SnipeWorker();
