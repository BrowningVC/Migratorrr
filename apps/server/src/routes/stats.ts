import { FastifyPluginAsync } from 'fastify';
import { performanceTracker } from '../services/performance-tracker.js';
import { prisma } from '../db/client.js';

export const statsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get public platform statistics
   * This endpoint is publicly accessible (no auth required)
   * Used for displaying stats on the landing page
   */
  fastify.get('/platform', async (request, reply) => {
    try {
      const stats = await performanceTracker.getStats();

      return {
        success: true,
        data: {
          totalMigrations: stats.totalMigrations,
          performance: {
            pct2x: Math.round(stats.pctReached2x * 10) / 10,
            pct5x: Math.round(stats.pctReached5x * 10) / 10,
            pct10x: Math.round(stats.pctReached10x * 10) / 10,
            pct50x: Math.round(stats.pctReached50x * 10) / 10,
            pct100x: Math.round(stats.pctReached100x * 10) / 10,
          },
          topPerformers: {
            highestMultiplier: Math.round(stats.highestMultiplier * 10) / 10,
            highestMultiplierToken: stats.highestMultiplierToken,
            highestMarketCap: stats.highestMarketCap,
            highestMarketCapToken: stats.highestMarketCapToken,
          },
          avgTimeToReach2x: stats.avgTimeToReach2x
            ? Math.round(stats.avgTimeToReach2x)
            : null,
          lastUpdated: stats.lastUpdated,
        },
      };
    } catch (error) {
      console.error('Failed to fetch platform stats:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch platform statistics',
      });
    }
  });

  /**
   * Get recent top performing migrations
   * Public endpoint for showcasing success stories
   *
   * Includes legitimacy filters to exclude fake/botted tokens:
   * - Minimum 24h volume of $10k
   * - Minimum 50 holders
   * - Minimum 100 transactions in 24h
   * - Must have both buys and sells (not just one-way wash trading)
   * - Not marked as rugged
   */
  fastify.get('/top-performers', async (request, reply) => {
    try {
      // Get migrations from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Minimum thresholds to filter out fake/botted tokens
      const MIN_VOLUME_24H = 10000; // $10k minimum 24h volume
      const MIN_HOLDERS = 50; // At least 50 unique holders
      const MIN_TX_COUNT = 100; // At least 100 transactions in 24h
      const MIN_BUY_SELL_RATIO = 0.2; // Buy/sell ratio between 0.2 and 5 (not heavily one-sided)
      const MAX_BUY_SELL_RATIO = 5;

      const topByMultiplier = await prisma.migrationEvent.findMany({
        where: {
          initialPriceSol: { not: null },
          highestPriceSol: { not: null },
          detectedAt: { gte: thirtyDaysAgo },
          isRugged: false,
          // Volume and legitimacy checks
          OR: [
            // Either verified manually
            { isVerified: true },
            // Or passes automated checks
            {
              AND: [
                { volumeUsd24h: { gte: MIN_VOLUME_24H } },
                { holderCount: { gte: MIN_HOLDERS } },
                { txCount24h: { gte: MIN_TX_COUNT } },
              ],
            },
            // Fallback: if no volume data yet, allow but will filter by other metrics
            {
              AND: [
                { volumeUsd24h: null },
                { highestMarketCapUsd: { gte: 100000 } }, // At least $100k market cap
              ],
            },
          ],
        },
        orderBy: { highestPriceSol: 'desc' },
        take: 50, // Fetch more to filter down
        select: {
          tokenMint: true,
          tokenName: true,
          tokenSymbol: true,
          initialPriceSol: true,
          highestPriceSol: true,
          highestMarketCapUsd: true,
          reached10x: true,
          reached100x: true,
          detectedAt: true,
          volumeUsd24h: true,
          holderCount: true,
          txCount24h: true,
          buyTxCount24h: true,
          sellTxCount24h: true,
          isVerified: true,
        },
      });

      // Calculate multipliers and apply additional filtering
      const performers = topByMultiplier
        .map((m) => {
          // Calculate buy/sell ratio if data available
          let buySellRatioValid = true;
          if (m.buyTxCount24h && m.sellTxCount24h && m.sellTxCount24h > 0) {
            const ratio = m.buyTxCount24h / m.sellTxCount24h;
            buySellRatioValid = ratio >= MIN_BUY_SELL_RATIO && ratio <= MAX_BUY_SELL_RATIO;
          }

          return {
            tokenSymbol: m.tokenSymbol || 'Unknown',
            tokenName: m.tokenName,
            tokenMint: m.tokenMint,
            multiplier: m.initialPriceSol
              ? Math.round((m.highestPriceSol! / m.initialPriceSol) * 10) / 10
              : 0,
            highestMarketCap: m.highestMarketCapUsd,
            reached10x: m.reached10x,
            reached100x: m.reached100x,
            migrationDate: m.detectedAt,
            // Include legitimacy metrics for transparency
            volumeUsd24h: m.volumeUsd24h,
            holderCount: m.holderCount,
            isVerified: m.isVerified,
            buySellRatioValid,
          };
        })
        // Filter out tokens with suspicious buy/sell ratios
        .filter((p) => p.multiplier > 1 && p.buySellRatioValid)
        .sort((a, b) => b.multiplier - a.multiplier)
        .slice(0, 10)
        // Remove internal fields from response
        .map(({ buySellRatioValid, ...rest }) => rest);

      return {
        success: true,
        data: performers,
      };
    } catch (error) {
      console.error('Failed to fetch top performers:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch top performers',
      });
    }
  });

  /**
   * Get recent migrations feed
   * Public endpoint showing live activity
   */
  fastify.get('/recent-migrations', async (request, reply) => {
    try {
      const recentMigrations = await prisma.migrationEvent.findMany({
        orderBy: { detectedAt: 'desc' },
        take: 20,
        select: {
          tokenMint: true,
          tokenSymbol: true,
          tokenName: true,
          initialLiquiditySol: true,
          initialMarketCapUsd: true,
          reached2x: true,
          reached5x: true,
          reached10x: true,
          detectedAt: true,
          totalSnipesSuccessful: true,
        },
      });

      return {
        success: true,
        data: recentMigrations.map((m) => ({
          tokenSymbol: m.tokenSymbol || 'Unknown',
          tokenName: m.tokenName,
          tokenMint: m.tokenMint.slice(0, 8) + '...',
          initialLiquidity: m.initialLiquiditySol,
          initialMarketCap: m.initialMarketCapUsd,
          milestones: {
            reached2x: m.reached2x,
            reached5x: m.reached5x,
            reached10x: m.reached10x,
          },
          snipedCount: m.totalSnipesSuccessful,
          migrationTime: m.detectedAt,
        })),
      };
    } catch (error) {
      console.error('Failed to fetch recent migrations:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch recent migrations',
      });
    }
  });

  /**
   * Get PumpFun migrations for dashboard
   * Public endpoint - returns recent PumpFun migrations with full token mints
   * Used by dashboard Activity Log to show live migrations
   */
  fastify.get('/pumpfun-migrations', async (request, reply) => {
    try {
      const limit = Math.min(parseInt((request.query as any).limit || '50', 10), 100);

      const migrations = await prisma.migrationEvent.findMany({
        where: {
          // PumpFun tokens end with 'pump' in their mint address
          tokenMint: {
            endsWith: 'pump',
          },
        },
        orderBy: { detectedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          tokenMint: true,
          tokenSymbol: true,
          tokenName: true,
          poolAddress: true,
          detectionLatencyMs: true,
          source: true,
          detectedAt: true,
          totalSnipesSuccessful: true,
        },
      });

      return {
        success: true,
        data: migrations.map((m) => ({
          id: m.id,
          tokenMint: m.tokenMint,
          tokenSymbol: m.tokenSymbol,
          tokenName: m.tokenName,
          poolAddress: m.poolAddress,
          detectionLatencyMs: m.detectionLatencyMs,
          source: m.source,
          timestamp: m.detectedAt.toISOString(),
          sniped: (m.totalSnipesSuccessful || 0) > 0,
          snipeSuccess: (m.totalSnipesSuccessful || 0) > 0 ? true : undefined,
        })),
      };
    } catch (error) {
      console.error('Failed to fetch PumpFun migrations:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch PumpFun migrations',
      });
    }
  });
};
