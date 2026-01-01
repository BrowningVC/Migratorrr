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
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.snipeQueue = new Queue('snipe-queue', {
      connection: redisUrl,
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

  // Cache for token analysis data - shared across all snipers for same migration
  // This prevents 100+ redundant API calls when many snipers have filters enabled
  private tokenDataCache = new Map<string, {
    volumeData?: Awaited<ReturnType<typeof tokenInfoService.getTokenVolume>>;
    marketData?: Awaited<ReturnType<typeof tokenInfoService.getTokenMarketData>>;
    analysisData?: Awaited<ReturnType<typeof tokenAnalysisService.getTokenAnalysis>>;
    fetchedAt: number;
  }>();
  private readonly TOKEN_DATA_CACHE_MS = 30000; // 30 second cache

  /**
   * Handle a new migration event
   * OPTIMIZED: Parallel processing for 100+ snipers
   */
  private async handleMigration(migration: MigrationEvent & { detectedBy: string; detectedAt: number }): Promise<void> {
    const timestamp = new Date().toISOString();
    const startTime = Date.now();
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

    // OPTIMIZATION: Pre-fetch token data ONCE if ANY sniper needs it
    // This prevents N redundant API calls for N snipers
    await this.prefetchTokenData(activeSnipers, migration);

    // OPTIMIZATION: Process all snipers in PARALLEL instead of sequentially
    // This is critical for 100+ snipers - sequential processing would take too long
    const results = await Promise.allSettled(
      activeSnipers.map(async (sniper) => {
        const meetsFilter = await this.matchesCriteria(sniper.config, migration);
        return { sniper, meetsFilter };
      })
    );

    // Collect results and dispatch jobs
    const matchedSnipers: ActiveSniper[] = [];
    const filteredSniperIds: string[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { sniper, meetsFilter } = result.value;
        if (meetsFilter) {
          matchedSnipers.push(sniper);
        } else {
          filteredSniperIds.push(sniper.id);
        }
      } else {
        console.error(`   ❌ Error evaluating sniper:`, result.reason);
      }
    }

    // Dispatch jobs for matched snipers (in parallel for speed)
    const dispatchResults = await Promise.allSettled(
      matchedSnipers.map(async (sniper) => {
        const wasDispatched = await this.dispatchSnipeJob(sniper, migration);
        return { sniper, wasDispatched };
      })
    );

    let dispatched = 0;
    for (const result of dispatchResults) {
      if (result.status === 'fulfilled' && result.value.wasDispatched) {
        dispatched++;
        console.log(`   📤 Snipe job DISPATCHED for "${result.value.sniper.name}"`);
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`\n   📊 SUMMARY: ${dispatched}/${matchedSnipers.length} jobs dispatched, ${filteredSniperIds.length} filtered (${processingTime}ms)`);

    // Batch update stats (single query each instead of per-sniper)
    const updatePromises: Promise<unknown>[] = [];

    if (dispatched > 0) {
      updatePromises.push(
        prisma.migrationEvent.updateMany({
          where: { tokenMint: migration.tokenMint },
          data: { totalSnipesAttempted: { increment: dispatched } },
        })
      );
    }

    if (filteredSniperIds.length > 0) {
      updatePromises.push(
        prisma.sniperConfig.updateMany({
          where: { id: { in: filteredSniperIds } },
          data: { tokensFiltered: { increment: 1 } },
        })
      );
    }

    // Run stat updates in background - don't block the response
    Promise.allSettled(updatePromises).catch(console.error);

    // Clear token data cache for this migration (no longer needed)
    this.tokenDataCache.delete(migration.tokenMint);
  }

  /**
   * Pre-fetch token data ONCE for all snipers that need it
   * This prevents 100+ redundant API calls
   */
  private async prefetchTokenData(
    snipers: ActiveSniper[],
    migration: MigrationEvent
  ): Promise<void> {
    const needsVolume = snipers.some(s => s.config.minVolumeUsd);
    const needsMarketCap = snipers.some(s => s.config.maxMarketCapUsd);
    const needsAnalysis = snipers.some(s =>
      s.config.minHolderCount ||
      s.config.maxDevHoldingsPct ||
      s.config.maxTop10HoldingsPct ||
      s.config.requireTwitter ||
      s.config.requireTelegram ||
      s.config.requireWebsite
    );

    if (!needsVolume && !needsMarketCap && !needsAnalysis) {
      return; // No external data needed
    }

    console.log(`   🔄 Pre-fetching token data (volume: ${needsVolume}, mcap: ${needsMarketCap}, analysis: ${needsAnalysis})...`);
    const fetchStart = Date.now();

    const cache: typeof this.tokenDataCache extends Map<string, infer V> ? V : never = {
      fetchedAt: Date.now(),
    };

    // Fetch all needed data in parallel
    const fetchPromises: Promise<void>[] = [];

    if (needsVolume) {
      fetchPromises.push(
        tokenInfoService.getTokenVolume(migration.tokenMint).then(data => {
          cache.volumeData = data;
        }).catch(err => {
          console.warn(`   ⚠️ Volume fetch failed:`, err);
        })
      );
    }

    if (needsMarketCap) {
      fetchPromises.push(
        tokenInfoService.getTokenMarketData(migration.tokenMint).then(data => {
          cache.marketData = data;
        }).catch(err => {
          console.warn(`   ⚠️ Market data fetch failed:`, err);
        })
      );
    }

    if (needsAnalysis) {
      fetchPromises.push(
        tokenAnalysisService.getTokenAnalysis(migration.tokenMint).then(data => {
          cache.analysisData = data;
        }).catch(err => {
          console.warn(`   ⚠️ Analysis fetch failed:`, err);
        })
      );
    }

    await Promise.allSettled(fetchPromises);
    this.tokenDataCache.set(migration.tokenMint, cache);
    console.log(`   ✓ Token data pre-fetched in ${Date.now() - fetchStart}ms`);
  }

  /**
   * Get cached token data (populated by prefetchTokenData)
   */
  private getCachedTokenData(tokenMint: string) {
    return this.tokenDataCache.get(tokenMint);
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

    // NOTE: Liquidity check removed - PumpFun tokens always graduate with ~85 SOL
    // The migration detection itself (via "Instruction: Migrate" log) is sufficient validation

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

    // OPTIMIZATION: Use pre-fetched cached data instead of making N API calls for N snipers
    // The data was fetched ONCE in prefetchTokenData() before parallel sniper evaluation
    const cachedData = this.getCachedTokenData(migration.tokenMint);

    // Check volume filter
    if (config.minVolumeUsd) {
      // Use cached data if available, otherwise fetch (fallback for edge cases)
      const volumeData = cachedData?.volumeData ?? await tokenInfoService.getTokenVolume(migration.tokenMint);

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
      // Use cached data if available
      const marketData = cachedData?.marketData ?? await tokenInfoService.getTokenMarketData(migration.tokenMint);

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
      // Use cached data if available
      const tokenAnalysis = cachedData?.analysisData ?? await tokenAnalysisService.getTokenAnalysis(migration.tokenMint);

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
   * Uses TWO-LAYER locking to prevent duplicates:
   * 1. Wallet-level lock - prevents ANY sniper from sniping same token with same wallet
   * 2. Sniper-level lock - prevents same sniper from dispatching twice
   */
  private async dispatchSnipeJob(
    sniper: ActiveSniper,
    migration: MigrationEvent & { detectedBy: string; detectedAt: number }
  ): Promise<boolean> {
    const tokenLabel = migration.tokenSymbol || migration.tokenMint.slice(0, 12);

    // LAYER 1: WALLET-LEVEL LOCK (most critical)
    // This prevents the same wallet from sniping the same token via different snipers
    const walletLockKey = `snipe-wallet-dispatch:${sniper.walletId}:${migration.tokenMint}`;
    const walletLockAcquired = await redis.set(walletLockKey, sniper.id, 'EX', this.SNIPE_LOCK_TTL_SECONDS, 'NX');

    if (!walletLockAcquired) {
      const existingSniper = await redis.get(walletLockKey);
      console.log(
        `   🔒 Wallet dispatch blocked: ${tokenLabel} - wallet ${sniper.walletId.slice(0, 8)} ` +
        `already dispatching via sniper ${existingSniper?.slice(0, 8) || 'unknown'}`
      );
      return false;
    }

    // LAYER 2: SNIPER-LEVEL LOCK (additional safety)
    // Uses Redis SETNX (set if not exists) for atomic check-and-set
    const lockKey = `${this.SNIPE_LOCK_PREFIX}${sniper.id}:${migration.tokenMint}`;
    const acquired = await redis.set(lockKey, '1', 'EX', this.SNIPE_LOCK_TTL_SECONDS, 'NX');

    if (!acquired) {
      // Release wallet lock since we couldn't get sniper lock
      await redis.del(walletLockKey);
      console.log(
        `   🔒 Sniper dispatch blocked: ${tokenLabel} ` +
        `already dispatched by sniper "${sniper.name}"`
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
