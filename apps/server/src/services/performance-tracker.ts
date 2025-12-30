import { prisma } from '../db/client.js';
import { redis } from '../db/redis.js';

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  fdv: number;
  marketCap: number;
  liquidity?: {
    usd: number;
  };
  volume?: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  txns?: {
    h24: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    m5: { buys: number; sells: number };
  };
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

interface TokenPriceData {
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  fetchedAt: number;
  // Legitimacy metrics
  volumeUsd24h: number;
  txCount24h: number;
  buyTxCount24h: number;
  sellTxCount24h: number;
}

interface PerformanceStats {
  totalMigrations: number;
  pctReached2x: number;
  pctReached5x: number;
  pctReached10x: number;
  pctReached50x: number;
  pctReached100x: number;
  highestMultiplier: number;
  highestMultiplierToken: string | null;
  highestMarketCap: number;
  highestMarketCapToken: string | null;
  avgTimeToReach2x: number | null;
  lastUpdated: Date;
}

/**
 * PerformanceTrackerService - Monitors token performance after migration
 * Tracks price milestones (2x, 5x, 10x, etc.) and aggregates platform statistics
 */
class PerformanceTrackerService {
  private cachePrefix = 'token-price:';
  private statsCacheKey = 'platform-stats:current';
  private cacheTtlSeconds = 30;
  private dexScreenerBaseUrl = 'https://api.dexscreener.com/latest/dex';

  /**
   * Fetch current price data for a token from DexScreener
   */
  async getTokenPrice(tokenMint: string): Promise<TokenPriceData | null> {
    const cacheKey = `${this.cachePrefix}${tokenMint}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as TokenPriceData;
      } catch {
        // Invalid cache, continue
      }
    }

    try {
      const response = await fetch(
        `${this.dexScreenerBaseUrl}/tokens/${tokenMint}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) {
        console.error(`DexScreener API error: ${response.status}`);
        return null;
      }

      const data: DexScreenerResponse = await response.json();

      if (!data.pairs || data.pairs.length === 0) {
        return null;
      }

      // Find the primary Solana pair (highest liquidity)
      const solanaPairs = data.pairs.filter(p => p.chainId === 'solana');
      if (solanaPairs.length === 0) return null;

      const primaryPair = solanaPairs.reduce((best, current) =>
        (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best
      );

      // Aggregate legitimacy metrics across all Solana pairs
      let totalVolume24h = 0;
      let totalBuys24h = 0;
      let totalSells24h = 0;

      for (const pair of solanaPairs) {
        totalVolume24h += pair.volume?.h24 || 0;
        totalBuys24h += pair.txns?.h24?.buys || 0;
        totalSells24h += pair.txns?.h24?.sells || 0;
      }

      const priceData: TokenPriceData = {
        priceSol: parseFloat(primaryPair.priceNative) || 0,
        priceUsd: parseFloat(primaryPair.priceUsd) || 0,
        marketCapUsd: primaryPair.marketCap || primaryPair.fdv || 0,
        liquidityUsd: primaryPair.liquidity?.usd || 0,
        fetchedAt: Date.now(),
        // Legitimacy metrics
        volumeUsd24h: totalVolume24h,
        txCount24h: totalBuys24h + totalSells24h,
        buyTxCount24h: totalBuys24h,
        sellTxCount24h: totalSells24h,
      };

      await redis.setex(cacheKey, this.cacheTtlSeconds, JSON.stringify(priceData));
      return priceData;
    } catch (error) {
      console.error(`Failed to fetch price for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Update price milestones for a single migration event
   */
  async updateMigrationMilestones(migrationId: string): Promise<void> {
    const migration = await prisma.migrationEvent.findUnique({
      where: { id: migrationId },
    });

    if (!migration || !migration.initialPriceSol) return;

    const priceData = await this.getTokenPrice(migration.tokenMint);
    if (!priceData) return;

    const now = new Date();
    const multiplier = priceData.priceSol / migration.initialPriceSol;

    const updates: Record<string, unknown> = {
      currentPriceSol: priceData.priceSol,
      lastPriceCheck: now,
      // Update legitimacy metrics
      volumeUsd24h: priceData.volumeUsd24h,
      txCount24h: priceData.txCount24h,
      buyTxCount24h: priceData.buyTxCount24h,
      sellTxCount24h: priceData.sellTxCount24h,
      lastVolumeUpdate: now,
    };

    // Track highest price
    if (!migration.highestPriceSol || priceData.priceSol > migration.highestPriceSol) {
      updates.highestPriceSol = priceData.priceSol;
      updates.highestMarketCapUsd = priceData.marketCapUsd;
      updates.highestPriceAt = now;
    }

    // Check milestones (only set if not already reached)
    if (multiplier >= 2 && !migration.reached2x) {
      updates.reached2x = true;
      updates.reached2xAt = now;
    }
    if (multiplier >= 5 && !migration.reached5x) {
      updates.reached5x = true;
      updates.reached5xAt = now;
    }
    if (multiplier >= 10 && !migration.reached10x) {
      updates.reached10x = true;
      updates.reached10xAt = now;
    }
    if (multiplier >= 50 && !migration.reached50x) {
      updates.reached50x = true;
      updates.reached50xAt = now;
    }
    if (multiplier >= 100 && !migration.reached100x) {
      updates.reached100x = true;
      updates.reached100xAt = now;
    }

    // Check for rug (liquidity dropped to near zero)
    if (priceData.liquidityUsd < 100 && migration.initialLiquiditySol && migration.initialLiquiditySol > 10) {
      updates.isRugged = true;
    }

    await prisma.migrationEvent.update({
      where: { id: migrationId },
      data: updates,
    });
  }

  /**
   * Process a batch of migrations for price updates
   * Called periodically by a worker
   */
  async processBatchUpdate(batchSize: number = 50): Promise<number> {
    // Get migrations that haven't been checked recently (last 5 minutes)
    // Prioritize newer migrations and those not yet rugged
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const migrations = await prisma.migrationEvent.findMany({
      where: {
        isRugged: false,
        detectedAt: { gte: oneDayAgo }, // Only track for first 24 hours
        OR: [
          { lastPriceCheck: null },
          { lastPriceCheck: { lt: fiveMinutesAgo } },
        ],
      },
      orderBy: { detectedAt: 'desc' },
      take: batchSize,
    });

    let processed = 0;
    for (const migration of migrations) {
      try {
        await this.updateMigrationMilestones(migration.id);
        processed++;
        // Rate limit: DexScreener allows ~300 requests/minute
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`Failed to update migration ${migration.id}:`, error);
      }
    }

    return processed;
  }

  /**
   * Calculate and cache aggregate platform statistics
   */
  async calculateStats(): Promise<PerformanceStats> {
    const cached = await redis.get(this.statsCacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as PerformanceStats;
      } catch {
        // Continue to calculate
      }
    }

    // Get all migrations with initial price (required for multiplier calculation)
    const migrations = await prisma.migrationEvent.findMany({
      where: {
        initialPriceSol: { not: null },
      },
      select: {
        id: true,
        tokenMint: true,
        tokenSymbol: true,
        initialPriceSol: true,
        highestPriceSol: true,
        highestMarketCapUsd: true,
        reached2x: true,
        reached2xAt: true,
        reached5x: true,
        reached10x: true,
        reached50x: true,
        reached100x: true,
        detectedAt: true,
      },
    });

    const total = migrations.length;
    if (total === 0) {
      return this.getEmptyStats();
    }

    // Count milestones
    const count2x = migrations.filter(m => m.reached2x).length;
    const count5x = migrations.filter(m => m.reached5x).length;
    const count10x = migrations.filter(m => m.reached10x).length;
    const count50x = migrations.filter(m => m.reached50x).length;
    const count100x = migrations.filter(m => m.reached100x).length;

    // Find highest performers
    let highestMultiplier = 0;
    let highestMultiplierToken: string | null = null;
    let highestMarketCap = 0;
    let highestMarketCapToken: string | null = null;

    for (const m of migrations) {
      if (m.initialPriceSol && m.highestPriceSol) {
        const mult = m.highestPriceSol / m.initialPriceSol;
        if (mult > highestMultiplier) {
          highestMultiplier = mult;
          highestMultiplierToken = m.tokenSymbol || m.tokenMint;
        }
      }
      if (m.highestMarketCapUsd && m.highestMarketCapUsd > highestMarketCap) {
        highestMarketCap = m.highestMarketCapUsd;
        highestMarketCapToken = m.tokenSymbol || m.tokenMint;
      }
    }

    // Calculate average time to reach 2x
    const timesTo2x = migrations
      .filter(m => m.reached2x && m.reached2xAt)
      .map(m => m.reached2xAt!.getTime() - m.detectedAt.getTime());
    const avgTimeToReach2x = timesTo2x.length > 0
      ? timesTo2x.reduce((a, b) => a + b, 0) / timesTo2x.length / 60000 // Convert to minutes
      : null;

    const stats: PerformanceStats = {
      totalMigrations: total,
      pctReached2x: (count2x / total) * 100,
      pctReached5x: (count5x / total) * 100,
      pctReached10x: (count10x / total) * 100,
      pctReached50x: (count50x / total) * 100,
      pctReached100x: (count100x / total) * 100,
      highestMultiplier,
      highestMultiplierToken,
      highestMarketCap,
      highestMarketCapToken,
      avgTimeToReach2x,
      lastUpdated: new Date(),
    };

    // Cache for 5 minutes
    await redis.setex(this.statsCacheKey, 300, JSON.stringify(stats));

    // Also persist to database for historical tracking
    await this.persistStats(stats);

    return stats;
  }

  /**
   * Persist stats to database
   */
  private async persistStats(stats: PerformanceStats): Promise<void> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

    await prisma.platformStats.upsert({
      where: {
        periodType_periodStart: {
          periodType: 'all_time',
          periodStart: new Date(0), // Epoch for all_time
        },
      },
      create: {
        periodType: 'all_time',
        periodStart: new Date(0),
        periodEnd: now,
        totalMigrations: stats.totalMigrations,
        migrationsTracked: stats.totalMigrations,
        pctReached2x: stats.pctReached2x,
        pctReached5x: stats.pctReached5x,
        pctReached10x: stats.pctReached10x,
        pctReached50x: stats.pctReached50x,
        pctReached100x: stats.pctReached100x,
        highestMultiplier: stats.highestMultiplier,
        highestMultiplierMint: stats.highestMultiplierToken,
        highestMarketCapUsd: stats.highestMarketCap,
        highestMarketCapMint: stats.highestMarketCapToken,
      },
      update: {
        periodEnd: now,
        totalMigrations: stats.totalMigrations,
        migrationsTracked: stats.totalMigrations,
        pctReached2x: stats.pctReached2x,
        pctReached5x: stats.pctReached5x,
        pctReached10x: stats.pctReached10x,
        pctReached50x: stats.pctReached50x,
        pctReached100x: stats.pctReached100x,
        highestMultiplier: stats.highestMultiplier,
        highestMultiplierMint: stats.highestMultiplierToken,
        highestMarketCapUsd: stats.highestMarketCap,
        highestMarketCapMint: stats.highestMarketCapToken,
      },
    });
  }

  /**
   * Get empty stats for when no data exists
   */
  private getEmptyStats(): PerformanceStats {
    return {
      totalMigrations: 0,
      pctReached2x: 0,
      pctReached5x: 0,
      pctReached10x: 0,
      pctReached50x: 0,
      pctReached100x: 0,
      highestMultiplier: 0,
      highestMultiplierToken: null,
      highestMarketCap: 0,
      highestMarketCapToken: null,
      avgTimeToReach2x: null,
      lastUpdated: new Date(),
    };
  }

  /**
   * Get current stats (from cache or calculate)
   */
  async getStats(): Promise<PerformanceStats> {
    return this.calculateStats();
  }

  /**
   * Clear the stats cache (force recalculation)
   */
  async clearStatsCache(): Promise<void> {
    await redis.del(this.statsCacheKey);
  }
}

export const performanceTracker = new PerformanceTrackerService();
