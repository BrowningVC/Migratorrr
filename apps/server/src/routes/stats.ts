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
   */
  fastify.get('/top-performers', async (request, reply) => {
    try {
      const topByMultiplier = await prisma.migrationEvent.findMany({
        where: {
          initialPriceSol: { not: null },
          highestPriceSol: { not: null },
        },
        orderBy: { highestPriceSol: 'desc' },
        take: 10,
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
        },
      });

      // Calculate multipliers
      const performers = topByMultiplier
        .map((m) => ({
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
        }))
        .filter((p) => p.multiplier > 1)
        .sort((a, b) => b.multiplier - a.multiplier)
        .slice(0, 5);

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
};
