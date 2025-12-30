import { Worker, Job } from 'bullmq';
import { transactionExecutor } from '../services/transaction-executor.js';
import { prisma } from '../db/client.js';
import { emitToUser } from '../websocket/handlers.js';

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

    console.log(
      `Processing snipe for ${migration.tokenSymbol || migration.tokenMint} via sniper "${sniperName}"`
    );

    // Calculate job latency
    const latencyMs = Date.now() - migration.detectedAt;
    console.log(`Migration latency: ${latencyMs}ms`);

    // Update job progress
    await job.updateProgress(10);

    try {
      // Check if sniper is still active
      const sniper = await prisma.sniperConfig.findUnique({
        where: { id: sniperId },
      });

      if (!sniper || !sniper.isActive) {
        console.log(`Sniper ${sniperName} is no longer active, skipping`);
        await emitToUser(userId, 'snipe:skipped', {
          sniperId,
          sniperName,
          reason: 'Sniper is no longer active',
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
        });
        return;
      }

      await job.updateProgress(20);

      // Check wallet balance
      const hasBalance = await this.checkWalletBalance(
        walletId,
        config.snipeAmountSol + config.priorityFeeSol + 0.001 // Extra for fees
      );

      if (!hasBalance) {
        console.log(`Insufficient balance for snipe`);
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
            },
          },
        });
        return;
      }

      await job.updateProgress(30);

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
      });

      await job.updateProgress(80);

      if (result.success) {
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

        console.log(
          `Snipe successful: ${result.signature} for ${migration.tokenSymbol}`
        );
      } else {
        // Update sniper stats for failure
        await prisma.sniperConfig.update({
          where: { id: sniperId },
          data: {
            totalSnipes: { increment: 1 },
            failedSnipes: { increment: 1 },
          },
        });

        console.error(`Snipe failed: ${result.error}`);
      }

      await job.updateProgress(100);
    } catch (error) {
      console.error('Error processing snipe job:', error);

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

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
   * Check if wallet has sufficient balance
   */
  private async checkWalletBalance(
    _walletId: string,
    _requiredSol: number
  ): Promise<boolean> {
    // In production, this would:
    // 1. Get wallet public key from database
    // 2. Query Solana RPC for balance
    // 3. Return true if balance >= requiredSol

    // For now, assume sufficient balance
    return true;
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
