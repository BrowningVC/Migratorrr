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
    const timestamp = new Date().toISOString();
    console.log(`\n📥 [${timestamp}] ORCHESTRATOR: Processing migration`);
    console.log(`   Token: ${migration.tokenSymbol || 'Unknown'} (${migration.tokenMint})`);
    console.log(`   Pool: ${migration.poolAddress}`);
    console.log(`   Liquidity: ${migration.initialLiquiditySol} SOL`);

    // Get all active snipers with their wallet info
    const activeSnipers = await this.getActiveSnipers();

    if (activeSnipers.length === 0) {
      console.log(`   ⚠️  No active snipers found - migration will not be sniped`);
      return;
    }

    console.log(`   Found ${activeSnipers.length} active sniper(s)`);

    // Filter and dispatch jobs
    let matched = 0;
    let dispatched = 0;
    const filteredSniperIds: string[] = [];

    for (const sniper of activeSnipers) {
      console.log(`\n   🔍 Evaluating sniper: "${sniper.name}" (${sniper.id.slice(0, 8)}...)`);
      const meetsFilter = await this.matchesCriteria(sniper.config, migration);
      if (meetsFilter) {
        matched++;
        console.log(`   ✅ Sniper "${sniper.name}" PASSED all filters`);
        // dispatchSnipeJob returns false if token was already sniped (duplicate blocked)
        const wasDispatched = await this.dispatchSnipeJob(sniper, migration);
        if (wasDispatched) {
          dispatched++;
          console.log(`   📤 Snipe job DISPATCHED for "${sniper.name}"`);
        } else {
          console.log(`   ⏭️  Snipe job SKIPPED (duplicate) for "${sniper.name}"`);
        }
      } else {
        // Track that this sniper filtered out this migration
        filteredSniperIds.push(sniper.id);
        console.log(`   ❌ Sniper "${sniper.name}" FILTERED OUT (see filter logs above)`);
      }
    }

    console.log(`\n   📊 SUMMARY: ${dispatched}/${matched} jobs dispatched, ${filteredSniperIds.length} snipers filtered`);

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
   * CRITICAL: Only returns snipers with valid generated wallets that belong to the user
   */
  private async getActiveSnipers(): Promise<ActiveSniper[]> {
    const snipers = await prisma.sniperConfig.findMany({
      where: { isActive: true },
      include: {
        wallet: {
          select: {
            id: true,
            publicKey: true,
            walletType: true,
            userId: true,
          },
        },
      },
    });

    // Filter out snipers with invalid wallet configurations
    const validSnipers = snipers.filter((s: typeof snipers[number]) => {
      // Wallet must exist
      if (!s.wallet) {
        console.error(`Sniper ${s.id} (${s.name}) has no associated wallet - skipping`);
        return false;
      }

      // Wallet must be a generated wallet (server-controlled)
      if (s.wallet.walletType !== 'generated') {
        console.error(`Sniper ${s.id} (${s.name}) wallet is not a generated wallet - skipping`);
        return false;
      }

      // Wallet must belong to the sniper's user
      if (s.wallet.userId !== s.userId) {
        console.error(`Sniper ${s.id} (${s.name}) wallet ownership mismatch - skipping`);
        return false;
      }

      return true;
    });

    return validSnipers.map((s: typeof snipers[number]) => ({
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
    const tokenLabel = migration.tokenSymbol || migration.tokenMint.slice(0, 8);

    // CRITICAL: Reject stale migrations - only snipe real-time events
    // This prevents sniping historical tokens on startup or reconnection
    const MAX_MIGRATION_AGE_MS = 30_000; // 30 seconds max age
    const migrationAge = Date.now() - migration.detectedAt;

    if (migrationAge > MAX_MIGRATION_AGE_MS) {
      console.log(
        `      ⏱️  FILTER FAIL: Stale migration (age: ${Math.round(migrationAge / 1000)}s > max ${MAX_MIGRATION_AGE_MS / 1000}s)`
      );
      return false;
    }
    console.log(`      ✓ Migration age OK (${Math.round(migrationAge / 1000)}s)`);

    // Check minimum liquidity
    if (config.minLiquiditySol) {
      if (migration.initialLiquiditySol < config.minLiquiditySol) {
        console.log(
          `      ⏱️  FILTER FAIL: Liquidity ${migration.initialLiquiditySol} SOL < min ${config.minLiquiditySol} SOL`
        );
        return false;
      }
      console.log(`      ✓ Liquidity OK (${migration.initialLiquiditySol} SOL >= ${config.minLiquiditySol} SOL)`);
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
        console.log(
          `      ⏱️  FILTER FAIL: Name/symbol doesn't match patterns [${config.namePatterns.join(', ')}]`
        );
        return false;
      }
      console.log(`      ✓ Name pattern matched`);
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
        console.log(
          `      ⏱️  FILTER FAIL: Name/symbol matches excluded pattern`
        );
        return false;
      }
      console.log(`      ✓ Not in excluded patterns`);
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
          `      ⏱️  FILTER FAIL: Migration time ${migrationTimeMinutes.toFixed(1)}m > max ${config.maxMigrationTimeMinutes}m`
        );
        return false;
      }
      console.log(`      ✓ Migration time OK (${migrationTimeMinutes.toFixed(1)}m <= ${config.maxMigrationTimeMinutes}m)`);
    }

    // Check volume filter
    if (config.minVolumeUsd) {
      console.log(`      🔄 Fetching volume data...`);
      const volumeData = await tokenInfoService.getTokenVolume(migration.tokenMint);

      if (!tokenInfoService.meetsVolumeCriteria(volumeData, config.minVolumeUsd)) {
        console.log(
          `      ⏱️  FILTER FAIL: Volume $${volumeData?.volumeUsdTotal?.toFixed(0) || 0} < min $${config.minVolumeUsd}`
        );
        return false;
      }
      console.log(`      ✓ Volume OK ($${volumeData?.volumeUsdTotal?.toFixed(0) || 0} >= $${config.minVolumeUsd})`);
    }

    // Check max market cap filter
    if (config.maxMarketCapUsd) {
      console.log(`      🔄 Fetching market cap data...`);
      const marketData = await tokenInfoService.getTokenMarketData(migration.tokenMint);

      if (!tokenInfoService.meetsMarketCapCriteria(marketData, config.maxMarketCapUsd)) {
        console.log(
          `      ⏱️  FILTER FAIL: Market cap $${marketData?.marketCapUsd?.toFixed(0) || 0} > max $${config.maxMarketCapUsd}`
        );
        return false;
      }
      console.log(`      ✓ Market cap OK ($${marketData?.marketCapUsd?.toFixed(0) || 0} <= $${config.maxMarketCapUsd})`);
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
      console.log(`      🔄 Fetching token analysis...`);
      const tokenAnalysis = await tokenAnalysisService.getTokenAnalysis(migration.tokenMint);

      // Check minimum holder count
      if (config.minHolderCount) {
        if (!tokenAnalysisService.meetsHolderCountCriteria(tokenAnalysis, config.minHolderCount)) {
          console.log(
            `      ⏱️  FILTER FAIL: Holder count ${tokenAnalysis?.holderCount || 0} < min ${config.minHolderCount}`
          );
          return false;
        }
        console.log(`      ✓ Holder count OK (${tokenAnalysis?.holderCount || 0} >= ${config.minHolderCount})`);
      }

      // Check max dev wallet holdings
      if (config.maxDevHoldingsPct) {
        if (!tokenAnalysisService.meetsDevHoldingsCriteria(tokenAnalysis, config.maxDevHoldingsPct)) {
          console.log(
            `      ⏱️  FILTER FAIL: Dev holdings ${tokenAnalysis?.devHoldingsPct?.toFixed(1) || 0}% > max ${config.maxDevHoldingsPct}%`
          );
          return false;
        }
        console.log(`      ✓ Dev holdings OK (${tokenAnalysis?.devHoldingsPct?.toFixed(1) || 0}% <= ${config.maxDevHoldingsPct}%)`);
      }

      // Check max top 10 wallet concentration
      if (config.maxTop10HoldingsPct) {
        if (!tokenAnalysisService.meetsTop10Criteria(tokenAnalysis, config.maxTop10HoldingsPct)) {
          console.log(
            `      ⏱️  FILTER FAIL: Top 10 holdings ${tokenAnalysis?.top10HoldingsPct?.toFixed(1) || 0}% > max ${config.maxTop10HoldingsPct}%`
          );
          return false;
        }
        console.log(`      ✓ Top 10 holdings OK (${tokenAnalysis?.top10HoldingsPct?.toFixed(1) || 0}% <= ${config.maxTop10HoldingsPct}%)`);
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
            `      ⏱️  FILTER FAIL: Missing required socials: ${missing.join(', ')}`
          );
          return false;
        }
        console.log(`      ✓ Social requirements met`);
      }
    }

    // All criteria passed
    console.log(`      ✅ ALL FILTERS PASSED`);
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
