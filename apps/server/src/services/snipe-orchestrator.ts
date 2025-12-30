import { Queue } from 'bullmq';
import { redis } from '../db/redis.js';
import { prisma } from '../db/client.js';
import { migrationDetector, type MigrationEvent } from './migration-detector.js';
import { tokenInfoService } from './token-info.js';
import { tokenAnalysisService } from './token-analysis.js';
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
  // Migration time filter (minutes from token creation to migration)
  maxMigrationTimeMinutes?: number; // 5, 15, 60, or 360
  // Volume filter (minimum volume in USD since token deployment)
  minVolumeUsd?: number; // 10000, 25000, 50000, or 100000
  // Holder count filter - minimum unique holders
  minHolderCount?: number; // 25, 50, 100, 250
  // Dev wallet holdings filter - max % of supply held by dev/creator
  maxDevHoldingsPct?: number; // 5, 15, 30, 50
  // Social presence filters
  requireTwitter?: boolean;
  requireTelegram?: boolean;
  requireWebsite?: boolean;
  // Top 10 wallet concentration - max % of supply held by top 10 wallets
  maxTop10HoldingsPct?: number; // 30, 50, 70, 90
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

  // Redis key prefix for tracking sniped tokens per sniper
  // Format: snipe-lock:{sniperId}:{tokenMint} = "1" (TTL: 24 hours)
  private readonly SNIPE_LOCK_PREFIX = 'snipe-lock:';
  private readonly SNIPE_LOCK_TTL_SECONDS = 86400; // 24 hours

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
    let dispatched = 0;
    const filteredSniperIds: string[] = [];

    for (const sniper of activeSnipers) {
      const meetsFilter = await this.matchesCriteria(sniper.config, migration);
      if (meetsFilter) {
        matched++;
        // dispatchSnipeJob returns false if token was already sniped (duplicate blocked)
        const wasDispatched = await this.dispatchSnipeJob(sniper, migration);
        if (wasDispatched) {
          dispatched++;
        }
      } else {
        // Track that this sniper filtered out this migration
        filteredSniperIds.push(sniper.id);
      }
    }

    console.log(`Dispatched ${dispatched}/${matched} snipe jobs for ${migration.tokenSymbol || migration.tokenMint}`);
    console.log(`Filtered ${filteredSniperIds.length} snipers for ${migration.tokenSymbol || migration.tokenMint}`);

    // Update migration event with snipe count (only count actually dispatched)
    if (dispatched > 0) {
      await prisma.migrationEvent.updateMany({
        where: { tokenMint: migration.tokenMint },
        data: { totalSnipesAttempted: { increment: dispatched } },
      });
    }

    // Update tokensFiltered counter for each sniper that filtered this migration
    if (filteredSniperIds.length > 0) {
      await prisma.sniperConfig.updateMany({
        where: { id: { in: filteredSniperIds } },
        data: { tokensFiltered: { increment: 1 } },
      });
    }
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
  private async matchesCriteria(
    config: SniperConfig,
    migration: MigrationEvent & { detectedAt: number }
  ): Promise<boolean> {
    // CRITICAL: Reject stale migrations - only snipe real-time events
    // This prevents sniping historical tokens on startup or reconnection
    const MAX_MIGRATION_AGE_MS = 30_000; // 30 seconds max age
    const migrationAge = Date.now() - migration.detectedAt;

    if (migrationAge > MAX_MIGRATION_AGE_MS) {
      console.log(
        `Rejecting stale migration: ${migration.tokenSymbol || migration.tokenMint} ` +
        `(age: ${Math.round(migrationAge / 1000)}s, max: ${MAX_MIGRATION_AGE_MS / 1000}s)`
      );
      return false;
    }

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

    // Check migration time filter
    // migration.timestamp = token creation time
    // migration.detectedAt = when the migration was detected
    if (config.maxMigrationTimeMinutes) {
      const migrationTimeMinutes = tokenInfoService.calculateMigrationTimeMinutes(
        migration.timestamp,
        migration.detectedAt
      );

      if (migrationTimeMinutes > config.maxMigrationTimeMinutes) {
        console.log(
          `Skipping ${migration.tokenSymbol}: migration time ${migrationTimeMinutes}m exceeds max ${config.maxMigrationTimeMinutes}m`
        );
        return false;
      }
    }

    // Check volume filter
    if (config.minVolumeUsd) {
      const volumeData = await tokenInfoService.getTokenVolume(migration.tokenMint);

      if (!tokenInfoService.meetsVolumeCriteria(volumeData, config.minVolumeUsd)) {
        console.log(
          `Skipping ${migration.tokenSymbol}: volume $${volumeData?.volumeUsdTotal || 0} below min $${config.minVolumeUsd}`
        );
        return false;
      }
    }

    // Check max market cap filter
    if (config.maxMarketCapUsd) {
      const marketData = await tokenInfoService.getTokenMarketData(migration.tokenMint);

      if (!tokenInfoService.meetsMarketCapCriteria(marketData, config.maxMarketCapUsd)) {
        console.log(
          `Skipping ${migration.tokenSymbol}: market cap $${marketData?.marketCapUsd || 0} exceeds max $${config.maxMarketCapUsd}`
        );
        return false;
      }
    }

    // Check holder count, dev holdings, top 10 concentration, and social filters
    const needsTokenAnalysis =
      config.minHolderCount ||
      config.maxDevHoldingsPct ||
      config.maxTop10HoldingsPct ||
      config.requireTwitter ||
      config.requireTelegram ||
      config.requireWebsite;

    if (needsTokenAnalysis) {
      const tokenAnalysis = await tokenAnalysisService.getTokenAnalysis(migration.tokenMint);

      // Check minimum holder count
      if (config.minHolderCount) {
        if (!tokenAnalysisService.meetsHolderCountCriteria(tokenAnalysis, config.minHolderCount)) {
          console.log(
            `Skipping ${migration.tokenSymbol}: holder count ${tokenAnalysis?.holderCount || 0} below min ${config.minHolderCount}`
          );
          return false;
        }
      }

      // Check max dev wallet holdings
      if (config.maxDevHoldingsPct) {
        if (!tokenAnalysisService.meetsDevHoldingsCriteria(tokenAnalysis, config.maxDevHoldingsPct)) {
          console.log(
            `Skipping ${migration.tokenSymbol}: dev holdings ${tokenAnalysis?.devHoldingsPct || 0}% exceeds max ${config.maxDevHoldingsPct}%`
          );
          return false;
        }
      }

      // Check max top 10 wallet concentration
      if (config.maxTop10HoldingsPct) {
        if (!tokenAnalysisService.meetsTop10Criteria(tokenAnalysis, config.maxTop10HoldingsPct)) {
          console.log(
            `Skipping ${migration.tokenSymbol}: top 10 holdings ${tokenAnalysis?.top10HoldingsPct || 0}% exceeds max ${config.maxTop10HoldingsPct}%`
          );
          return false;
        }
      }

      // Check social presence requirements
      if (config.requireTwitter || config.requireTelegram || config.requireWebsite) {
        if (
          !tokenAnalysisService.meetsSocialCriteria(
            tokenAnalysis,
            config.requireTwitter || false,
            config.requireTelegram || false,
            config.requireWebsite || false
          )
        ) {
          const missing: string[] = [];
          if (config.requireTwitter && !tokenAnalysis?.socials.twitter) missing.push('Twitter');
          if (config.requireTelegram && !tokenAnalysis?.socials.telegram) missing.push('Telegram');
          if (config.requireWebsite && !tokenAnalysis?.socials.website) missing.push('Website');
          console.log(
            `Skipping ${migration.tokenSymbol}: missing required socials: ${missing.join(', ')}`
          );
          return false;
        }
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
  ): Promise<boolean> {
    // CRITICAL: Atomic lock to prevent sniping the same token twice
    // Uses Redis SETNX (set if not exists) for atomic check-and-set
    const lockKey = `${this.SNIPE_LOCK_PREFIX}${sniper.id}:${migration.tokenMint}`;
    const acquired = await redis.set(lockKey, '1', 'EX', this.SNIPE_LOCK_TTL_SECONDS, 'NX');

    if (!acquired) {
      console.log(
        `Duplicate snipe blocked: ${migration.tokenSymbol || migration.tokenMint} ` +
        `already sniped by sniper "${sniper.name}"`
      );
      return false;
    }

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

    return true;
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
