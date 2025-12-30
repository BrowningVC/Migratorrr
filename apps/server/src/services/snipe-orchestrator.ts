import { Queue } from 'bullmq';
import { redis } from '../db/redis.js';
import { prisma } from '../db/client.js';
import { migrationDetector, type MigrationEvent } from './migration-detector.js';
import { emitToUser } from '../websocket/handlers.js';

interface ActiveSniper {
  id: string;
  userId: string;
  walletId: string;
  walletPublicKey: string;
  name: string;
  config: SniperConfig;
}

interface SniperConfig {
  snipeAmountSol: number;
  slippageBps: number;
  priorityFeeSol: number;
  takeProfitPct?: number;
  stopLossPct?: number;
  trailingStopPct?: number;
  maxMarketCapUsd?: number;
  minLiquiditySol?: number;
  namePatterns?: string[];
  excludedPatterns?: string[];
  creatorWhitelist?: string[];
  [key: string]: unknown;
}

interface SnipeJob {
  sniperId: string;
  userId: string;
  walletId: string;
  walletPublicKey: string;
  sniperName: string;
  config: SniperConfig;
  migration: MigrationEvent & {
    detectedBy: string;
    detectedAt: number;
  };
  createdAt: number;
}

/**
 * SnipeOrchestrator - Matches migrations to user snipers and dispatches jobs
 *
 * 1. Listens for migration events from MigrationDetector
 * 2. Queries all active sniper configurations
 * 3. Filters migrations based on user criteria
 * 4. Dispatches snipe jobs to BullMQ queue
 */
export class SnipeOrchestrator {
  private snipeQueue: Queue;
  private isRunning = false;

  constructor() {
    this.snipeQueue = new Queue('snipe-queue', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 1, // Snipes should not retry automatically
      },
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Snipe orchestrator already running');
      return;
    }

    this.isRunning = true;

    // Listen for migration events
    migrationDetector.on('migration', (event) => {
      this.handleMigration(event).catch((error) => {
        console.error('Error handling migration:', error);
      });
    });

    console.log('Snipe Orchestrator started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    migrationDetector.removeAllListeners('migration');
    await this.snipeQueue.close();
    console.log('Snipe Orchestrator stopped');
  }

  /**
   * Handle a new migration event
   */
  private async handleMigration(migration: MigrationEvent & { detectedBy: string; detectedAt: number }): Promise<void> {
    console.log(`Processing migration for snipers: ${migration.tokenSymbol || migration.tokenMint}`);

    // Get all active snipers with their wallet info
    const activeSnipers = await this.getActiveSnipers();

    if (activeSnipers.length === 0) {
      console.log('No active snipers found');
      return;
    }

    console.log(`Found ${activeSnipers.length} active snipers`);

    // Filter and dispatch jobs
    let matched = 0;
    for (const sniper of activeSnipers) {
      if (this.matchesCriteria(sniper.config, migration)) {
        matched++;
        await this.dispatchSnipeJob(sniper, migration);
      }
    }

    console.log(`Dispatched ${matched} snipe jobs for ${migration.tokenSymbol || migration.tokenMint}`);

    // Update migration event with snipe count
    await prisma.migrationEvent.updateMany({
      where: { tokenMint: migration.tokenMint },
      data: { totalSnipesAttempted: { increment: matched } },
    });
  }

  /**
   * Get all active snipers with wallet information
   */
  private async getActiveSnipers(): Promise<ActiveSniper[]> {
    const snipers = await prisma.sniperConfig.findMany({
      where: { isActive: true },
      include: {
        wallet: {
          select: {
            id: true,
            publicKey: true,
          },
        },
      },
    });

    return snipers.map((s: typeof snipers[number]) => ({
      id: s.id,
      userId: s.userId,
      walletId: s.walletId,
      walletPublicKey: s.wallet.publicKey,
      name: s.name,
      config: s.config as SniperConfig,
    }));
  }

  /**
   * Check if a migration matches sniper criteria
   */
  private matchesCriteria(config: SniperConfig, migration: MigrationEvent): boolean {
    // Check minimum liquidity
    if (config.minLiquiditySol && migration.initialLiquiditySol < config.minLiquiditySol) {
      return false;
    }

    // Check name patterns (if any match, include)
    if (config.namePatterns && config.namePatterns.length > 0) {
      const name = (migration.tokenName || '').toLowerCase();
      const symbol = (migration.tokenSymbol || '').toLowerCase();

      const matches = config.namePatterns.some((pattern) => {
        const p = pattern.toLowerCase();
        return name.includes(p) || symbol.includes(p);
      });

      if (!matches) {
        return false;
      }
    }

    // Check excluded patterns (if any match, exclude)
    if (config.excludedPatterns && config.excludedPatterns.length > 0) {
      const name = (migration.tokenName || '').toLowerCase();
      const symbol = (migration.tokenSymbol || '').toLowerCase();

      const excluded = config.excludedPatterns.some((pattern) => {
        const p = pattern.toLowerCase();
        return name.includes(p) || symbol.includes(p);
      });

      if (excluded) {
        return false;
      }
    }

    // All criteria passed
    return true;
  }

  /**
   * Dispatch a snipe job to the queue
   */
  private async dispatchSnipeJob(
    sniper: ActiveSniper,
    migration: MigrationEvent & { detectedBy: string; detectedAt: number }
  ): Promise<void> {
    const job: SnipeJob = {
      sniperId: sniper.id,
      userId: sniper.userId,
      walletId: sniper.walletId,
      walletPublicKey: sniper.walletPublicKey,
      sniperName: sniper.name,
      config: sniper.config,
      migration,
      createdAt: Date.now(),
    };

    // Add job with priority based on priority fee
    // Higher fee = higher priority (lower number)
    const priority = Math.max(1, Math.floor(100 - sniper.config.priorityFeeSol * 10000));

    await this.snipeQueue.add('snipe', job, {
      priority,
      jobId: `${sniper.id}-${migration.tokenMint}-${Date.now()}`,
    });

    console.log(`Dispatched snipe job for sniper "${sniper.name}" (priority: ${priority})`);

    // Notify user
    await emitToUser(sniper.userId, 'migration:matched', {
      sniperId: sniper.id,
      sniperName: sniper.name,
      tokenMint: migration.tokenMint,
      tokenSymbol: migration.tokenSymbol,
      tokenName: migration.tokenName,
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: sniper.userId,
        sniperId: sniper.id,
        eventType: 'migration:matched',
        eventData: {
          tokenMint: migration.tokenMint,
          tokenSymbol: migration.tokenSymbol,
          sniperName: sniper.name,
          config: {
            snipeAmountSol: sniper.config.snipeAmountSol,
            slippageBps: sniper.config.slippageBps,
          },
        },
      },
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.snipeQueue.getWaitingCount(),
      this.snipeQueue.getActiveCount(),
      this.snipeQueue.getCompletedCount(),
      this.snipeQueue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  }
}

// Singleton instance
export const snipeOrchestrator = new SnipeOrchestrator();
