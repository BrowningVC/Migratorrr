import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';

// Sniper parameters validation - flexible schema
const sniperParamsSchema = z.object({
  snipeAmountSol: z.number().positive().max(1000),
  slippageBps: z.number().int().min(10).max(5000), // 0.1% - 50%
  priorityFeeSol: z.number().min(0.0001).max(1),
  takeProfitPct: z.number().min(1).max(10000).optional(), // 1% - 100x
  stopLossPct: z.number().min(1).max(100).optional(),
  trailingStopPct: z.number().min(1).max(100).optional(),
  coverInitials: z.boolean().optional(), // Sell 50% at 2x to cover initial investment
  maxMarketCapUsd: z.number().positive().optional(),
  namePatterns: z.array(z.string()).optional(),
  excludedPatterns: z.array(z.string()).optional(),
  creatorWhitelist: z.array(z.string()).optional(),
  // Migration time filter (minutes from token creation to migration)
  maxMigrationTimeMinutes: z.number().int().min(1).max(1440).optional(), // 1 min - 24 hours
  // Volume filter (minimum volume in USD since token deployment)
  minVolumeUsd: z.number().positive().optional(),
  // MEV Protection - use Jito bundles for sandwich attack protection
  mevProtection: z.boolean().optional(),
  // Holder count filter - minimum unique holders
  minHolderCount: z.number().int().min(1).optional(), // 25, 50, 100, 250
  // Dev wallet holdings filter - max % of supply held by dev/creator
  maxDevHoldingsPct: z.number().min(0).max(100).optional(), // 5, 15, 30, 50
  // Social presence filters
  requireTwitter: z.boolean().optional(),
  requireTelegram: z.boolean().optional(),
  requireWebsite: z.boolean().optional(),
  // Top 10 wallet concentration - max % of supply held by top 10 wallets
  maxTop10HoldingsPct: z.number().min(0).max(100).optional(), // 30, 50, 70, 90
}).passthrough(); // Allow additional custom parameters

const createSniperSchema = z.object({
  walletId: z.string().uuid(),
  name: z.string().min(1).max(100),
  config: sniperParamsSchema,
  isActive: z.boolean().optional(),
});

const updateSniperSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: sniperParamsSchema.optional(),
  isActive: z.boolean().optional(),
});

export const sniperRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all snipers for user
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;

    const snipers = await prisma.sniperConfig.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        wallet: {
          select: {
            id: true,
            publicKey: true,
            label: true,
          },
        },
        _count: {
          select: {
            positions: { where: { status: 'open' } },
          },
        },
      },
    });

    return {
      success: true,
      data: snipers.map((s: typeof snipers[number]) => ({
        id: s.id,
        name: s.name,
        isActive: s.isActive,
        config: s.config,
        walletId: s.walletId, // Include walletId directly for frontend store
        wallet: s.wallet,
        openPositions: s._count.positions,
        // Include stats
        totalSnipes: s.totalSnipes,
        successfulSnipes: s.successfulSnipes,
        failedSnipes: s.failedSnipes,
        totalSolSpent: s.totalSolSpent,
        tokensFiltered: s.tokensFiltered,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    };
  });

  // Get single sniper
  fastify.get('/:sniperId', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { sniperId } = request.params as { sniperId: string };

    const sniper = await prisma.sniperConfig.findFirst({
      where: { id: sniperId, userId },
      include: {
        wallet: {
          select: {
            id: true,
            publicKey: true,
            label: true,
          },
        },
        positions: {
          where: { status: 'open' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!sniper) {
      return reply.status(404).send({
        success: false,
        error: 'Sniper not found',
      });
    }

    return {
      success: true,
      data: sniper,
    };
  });

  // Create sniper
  fastify.post('/', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const body = createSniperSchema.parse(request.body);

    // LIMIT: Maximum 5 snipers per user
    const MAX_SNIPERS_PER_USER = 5;
    const existingSniperCount = await prisma.sniperConfig.count({
      where: { userId },
    });

    if (existingSniperCount >= MAX_SNIPERS_PER_USER) {
      return reply.status(400).send({
        success: false,
        error: `Maximum ${MAX_SNIPERS_PER_USER} snipers allowed per account. Please delete an existing sniper to create a new one.`,
      });
    }

    // Verify wallet belongs to user
    const wallet = await prisma.wallet.findFirst({
      where: { id: body.walletId, userId, isActive: true },
    });

    if (!wallet) {
      return reply.status(400).send({
        success: false,
        error: 'Wallet not found or not active',
      });
    }

    const sniper = await prisma.sniperConfig.create({
      data: {
        userId,
        walletId: body.walletId,
        name: body.name,
        config: body.config as object,
        isActive: body.isActive ?? false,
      },
      include: {
        wallet: {
          select: {
            id: true,
            publicKey: true,
            label: true,
          },
        },
      },
    });

    fastify.log.info(`Sniper created: ${sniper.id} by user ${userId}`);

    // Emit event via Socket.IO
    const io = (fastify as any).io;
    io?.to(`user:${userId}`).emit('sniper:created', {
      type: 'sniper:created',
      timestamp: Date.now(),
      userId,
      sniperId: sniper.id,
      sniperName: sniper.name,
    });

    return {
      success: true,
      data: sniper,
    };
  });

  // Update sniper
  fastify.patch('/:sniperId', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { sniperId } = request.params as { sniperId: string };
    const body = updateSniperSchema.parse(request.body);

    const existing = await prisma.sniperConfig.findFirst({
      where: { id: sniperId, userId },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: 'Sniper not found',
      });
    }

    const sniper = await prisma.sniperConfig.update({
      where: { id: sniperId },
      data: {
        name: body.name,
        config: (body.config as object | undefined) ?? (existing.config as object),
        isActive: body.isActive,
        updatedAt: new Date(),
      },
      include: {
        wallet: {
          select: {
            id: true,
            publicKey: true,
            label: true,
          },
        },
      },
    });

    fastify.log.info(`Sniper updated: ${sniperId} by user ${userId}`);

    // Emit event
    const io = (fastify as any).io;
    if (body.isActive !== undefined && body.isActive !== existing.isActive) {
      io?.to(`user:${userId}`).emit(body.isActive ? 'sniper:activated' : 'sniper:paused', {
        type: body.isActive ? 'sniper:activated' : 'sniper:paused',
        timestamp: Date.now(),
        userId,
        sniperId: sniper.id,
        sniperName: sniper.name,
      });
    }

    return {
      success: true,
      data: sniper,
    };
  });

  // Toggle sniper active state
  fastify.post('/:sniperId/toggle', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { sniperId } = request.params as { sniperId: string };

    const existing = await prisma.sniperConfig.findFirst({
      where: { id: sniperId, userId },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: 'Sniper not found',
      });
    }

    const sniper = await prisma.sniperConfig.update({
      where: { id: sniperId },
      data: {
        isActive: !existing.isActive,
        updatedAt: new Date(),
      },
    });

    fastify.log.info(`Sniper ${sniper.isActive ? 'activated' : 'paused'}: ${sniperId}`);

    // Emit event
    const io = (fastify as any).io;
    io?.to(`user:${userId}`).emit(sniper.isActive ? 'sniper:activated' : 'sniper:paused', {
      type: sniper.isActive ? 'sniper:activated' : 'sniper:paused',
      timestamp: Date.now(),
      userId,
      sniperId: sniper.id,
      sniperName: sniper.name,
    });

    return {
      success: true,
      data: {
        id: sniper.id,
        isActive: sniper.isActive,
      },
    };
  });

  // Delete sniper
  fastify.delete('/:sniperId', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { sniperId } = request.params as { sniperId: string };

    const existing = await prisma.sniperConfig.findFirst({
      where: { id: sniperId, userId },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: 'Sniper not found',
      });
    }

    // Check for open positions
    const openPositions = await prisma.position.count({
      where: { sniperId, status: 'open' },
    });

    if (openPositions > 0) {
      return reply.status(400).send({
        success: false,
        error: `Cannot delete sniper with ${openPositions} open position(s). Close them first.`,
      });
    }

    await prisma.sniperConfig.delete({
      where: { id: sniperId },
    });

    fastify.log.info(`Sniper deleted: ${sniperId} by user ${userId}`);

    // Emit event
    const io = (fastify as any).io;
    io?.to(`user:${userId}`).emit('sniper:deleted', {
      type: 'sniper:deleted',
      timestamp: Date.now(),
      userId,
      sniperId,
      sniperName: existing.name,
    });

    return {
      success: true,
      data: { message: 'Sniper deleted successfully' },
    };
  });

  // Get sniper stats
  fastify.get('/:sniperId/stats', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { sniperId } = request.params as { sniperId: string };

    const sniper = await prisma.sniperConfig.findFirst({
      where: { id: sniperId, userId },
    });

    if (!sniper) {
      return reply.status(404).send({
        success: false,
        error: 'Sniper not found',
      });
    }

    // Calculate stats
    const [openPositions, closedPositions, totalTrades] = await Promise.all([
      prisma.position.count({ where: { sniperId, status: 'open' } }),
      prisma.position.findMany({
        where: { sniperId, status: 'closed' },
        select: { entrySol: true, exitSol: true },
      }),
      prisma.transaction.count({ where: { position: { sniperId } } }),
    ]);

    const totalPnlSol = closedPositions.reduce((sum: number, p: { entrySol: number; exitSol: number | null }) => {
      return sum + ((p.exitSol || 0) - p.entrySol);
    }, 0);

    const winningTrades = closedPositions.filter(
      (p: { entrySol: number; exitSol: number | null }) => (p.exitSol || 0) > p.entrySol
    ).length;

    const winRate =
      closedPositions.length > 0
        ? (winningTrades / closedPositions.length) * 100
        : 0;

    return {
      success: true,
      data: {
        openPositions,
        closedPositions: closedPositions.length,
        totalTrades,
        totalPnlSol,
        winRate,
      },
    };
  });

  /**
   * Get recent activity for the user's snipers
   * Returns activity log entries and recent transactions
   */
  fastify.get('/activity', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const limit = Math.min(parseInt((request.query as any).limit || '50', 10), 100);

    try {
      // Fetch both activity log entries and recent transactions in parallel
      const [activityLogs, recentTransactions] = await Promise.all([
        // Activity log entries (sniper events)
        prisma.activityLog.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            eventType: true,
            eventData: true,
            createdAt: true,
          },
        }),
        // Recent transactions (actual trades)
        prisma.transaction.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            signature: true,
            txType: true,
            tokenMint: true,
            solAmount: true,
            tokenAmount: true,
            pricePerToken: true,
            status: true,
            createdAt: true,
            position: {
              select: {
                tokenSymbol: true,
                tokenName: true,
                sniper: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      // Convert to unified activity format
      const activities = [
        // Activity log entries
        ...activityLogs.map((log) => ({
          id: log.id,
          eventType: log.eventType,
          eventData: log.eventData as Record<string, unknown>,
          timestamp: log.createdAt.toISOString(),
        })),
        // Transactions as activity entries
        ...recentTransactions.map((tx) => ({
          id: `tx-${tx.id}`,
          eventType: tx.txType === 'buy' ? 'snipe:success' : `position:${tx.txType}`,
          eventData: {
            signature: tx.signature,
            tokenMint: tx.tokenMint,
            tokenSymbol: tx.position?.tokenSymbol,
            tokenName: tx.position?.tokenName,
            solAmount: tx.solAmount,
            tokenAmount: tx.tokenAmount,
            pricePerToken: tx.pricePerToken,
            status: tx.status,
            sniperId: tx.position?.sniper?.id,
            sniperName: tx.position?.sniper?.name,
          },
          timestamp: tx.createdAt.toISOString(),
        })),
      ]
        // Sort by timestamp descending
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        // Remove duplicates (same eventType within 1 second)
        .filter((item, index, arr) => {
          if (index === 0) return true;
          const prev = arr[index - 1];
          const timeDiff = Math.abs(
            new Date(prev.timestamp).getTime() - new Date(item.timestamp).getTime()
          );
          return !(prev.eventType === item.eventType && timeDiff < 1000);
        })
        .slice(0, limit);

      return {
        success: true,
        data: activities,
      };
    } catch (error) {
      console.error('Failed to fetch activity:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch activity',
      });
    }
  });
};
