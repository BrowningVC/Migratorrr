import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';

export const positionRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all positions for user
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const query = z
      .object({
        status: z.enum(['open', 'closed', 'all']).optional(),
        sniperId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);

    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const where: any = { userId };
    if (query.status && query.status !== 'all') {
      where.status = query.status;
    }
    if (query.sniperId) {
      where.sniperId = query.sniperId;
    }

    const [positions, total] = await Promise.all([
      prisma.position.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sniper: {
            select: { id: true, name: true },
          },
          wallet: {
            select: { id: true, publicKey: true, label: true },
          },
        },
      }),
      prisma.position.count({ where }),
    ]);

    return {
      success: true,
      data: {
        items: positions,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      },
    };
  });

  // Get single position
  fastify.get('/:positionId', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { positionId } = request.params as { positionId: string };

    const position = await prisma.position.findFirst({
      where: { id: positionId, userId },
      include: {
        sniper: {
          select: { id: true, name: true },
        },
        wallet: {
          select: { id: true, publicKey: true, label: true },
        },
        transactions: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!position) {
      return reply.status(404).send({
        success: false,
        error: 'Position not found',
      });
    }

    return {
      success: true,
      data: position,
    };
  });

  // Get portfolio summary
  fastify.get('/portfolio/summary', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;

    const [openPositions, closedPositions, totalFees] = await Promise.all([
      prisma.position.findMany({
        where: { userId, status: 'open' },
        select: {
          id: true,
          tokenMint: true,
          tokenSymbol: true,
          entryPrice: true,
          entrySol: true,
          currentAmount: true,
        },
      }),
      prisma.position.findMany({
        where: { userId, status: 'closed' },
        select: {
          entrySol: true,
          exitSol: true,
        },
      }),
      prisma.transaction.aggregate({
        where: { userId },
        _sum: { platformFee: true },
      }),
    ]);

    // Calculate totals
    const totalInvestedSol = openPositions.reduce((sum: number, p: { entrySol: number }) => sum + p.entrySol, 0);

    const realizedPnlSol = closedPositions.reduce((sum: number, p: { entrySol: number; exitSol: number | null }) => {
      return sum + ((p.exitSol || 0) - p.entrySol);
    }, 0);

    const winningTrades = closedPositions.filter(
      (p: { entrySol: number; exitSol: number | null }) => (p.exitSol || 0) > p.entrySol
    ).length;

    const losingTrades = closedPositions.length - winningTrades;

    return {
      success: true,
      data: {
        openPositions: openPositions.length,
        closedPositions: closedPositions.length,
        totalInvestedSol,
        realizedPnlSol,
        unrealizedPnlSol: 0, // Will be calculated with live prices
        totalFeesPaid: totalFees._sum.platformFee || 0,
        winningTrades,
        losingTrades,
        winRate:
          closedPositions.length > 0
            ? (winningTrades / closedPositions.length) * 100
            : 0,
      },
    };
  });

  // Get activity log
  fastify.get('/activity/log', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);

    const page = query.page || 1;
    const pageSize = query.pageSize || 50;

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.activityLog.count({ where: { userId } }),
    ]);

    return {
      success: true,
      data: {
        items: logs,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      },
    };
  });

  // Get transactions for position
  fastify.get('/:positionId/transactions', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { positionId } = request.params as { positionId: string };

    // Verify ownership
    const position = await prisma.position.findFirst({
      where: { id: positionId, userId },
    });

    if (!position) {
      return reply.status(404).send({
        success: false,
        error: 'Position not found',
      });
    }

    const transactions = await prisma.transaction.findMany({
      where: { positionId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: transactions,
    };
  });

  // Manual close position (emergency)
  fastify.post('/:positionId/close', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { positionId } = request.params as { positionId: string };

    const position = await prisma.position.findFirst({
      where: { id: positionId, userId, status: 'open' },
    });

    if (!position) {
      return reply.status(404).send({
        success: false,
        error: 'Open position not found',
      });
    }

    // TODO: Execute sell transaction via TransactionExecutor
    // For now, just mark as closed (will be implemented with tx executor)

    fastify.log.info(`Manual close requested for position ${positionId}`);

    return {
      success: true,
      data: {
        message: 'Close position request submitted',
        positionId,
      },
    };
  });
};
