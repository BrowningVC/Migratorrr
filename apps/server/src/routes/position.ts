import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { transactionExecutor } from '../services/transaction-executor.js';
import { emitToUser } from '../websocket/handlers.js';

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

  // Update position metadata (token symbol, market cap, etc.)
  fastify.patch('/:positionId/metadata', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { positionId } = request.params as { positionId: string };

    const body = z
      .object({
        tokenSymbol: z.string().optional(),
        tokenName: z.string().optional(),
        entryMarketCap: z.number().optional(),
      })
      .parse(request.body);

    // First verify the position belongs to this user
    const position = await prisma.position.findFirst({
      where: { id: positionId, userId },
    });

    if (!position) {
      return reply.status(404).send({
        success: false,
        error: 'Position not found',
      });
    }

    // Only update fields that are currently null/empty and new values are provided
    const updates: Record<string, unknown> = {};

    if (body.tokenSymbol && !position.tokenSymbol) {
      updates.tokenSymbol = body.tokenSymbol;
    }
    if (body.tokenName && !position.tokenName) {
      updates.tokenName = body.tokenName;
    }
    if (body.entryMarketCap && !position.entryMarketCap) {
      updates.entryMarketCap = body.entryMarketCap;
    }

    if (Object.keys(updates).length === 0) {
      return {
        success: true,
        data: position,
        message: 'No updates needed',
      };
    }

    const updated = await prisma.position.update({
      where: { id: positionId },
      data: updates,
    });

    return {
      success: true,
      data: updated,
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
          currentTokenAmount: true,
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

  // Manual close position (sell all tokens)
  fastify.post('/:positionId/close', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { positionId } = request.params as { positionId: string };

    // Get position with sniper config for slippage/priority settings
    const position = await prisma.position.findFirst({
      where: { id: positionId, userId, status: 'open' },
      include: {
        sniper: {
          select: {
            id: true,
            name: true,
            walletId: true,
            config: true,
          },
        },
      },
    });

    if (!position) {
      return reply.status(404).send({
        success: false,
        error: 'Open position not found',
      });
    }

    // Atomically set status to 'selling' to prevent duplicate sells
    const updateResult = await prisma.position.updateMany({
      where: {
        id: positionId,
        userId,
        status: 'open', // Only update if still open
      },
      data: {
        status: 'selling',
      },
    });

    if (updateResult.count === 0) {
      return reply.status(409).send({
        success: false,
        error: 'Position is already being sold or closed',
      });
    }

    fastify.log.info(`Manual close initiated for position ${positionId}`);

    // Get sniper config for slippage/priority settings
    const config = (position.sniper?.config as Record<string, unknown>) || {};
    const slippageBps = (config.slippageBps as number) || 2000; // 20% default for manual sells (volatile meme tokens)
    const priorityFeeSol = (config.priorityFeeSol as number) || 0.001;

    // Determine wallet ID - use sniper's wallet or fall back to finding user's generated wallet
    let walletId = position.sniper?.walletId;
    if (!walletId) {
      // Find user's generated wallet as fallback
      const generatedWallet = await prisma.wallet.findFirst({
        where: { userId, walletType: 'generated' },
        select: { id: true },
      });
      if (!generatedWallet) {
        // Revert status if we can't find a wallet
        await prisma.position.update({
          where: { id: positionId },
          data: { status: 'open' },
        });
        return reply.status(400).send({
          success: false,
          error: 'No trading wallet found for this position',
        });
      }
      walletId = generatedWallet.id;
    }

    try {
      // Execute the sell transaction
      const result = await transactionExecutor.executeSell({
        userId,
        walletId,
        positionId,
        tokenMint: position.tokenMint,
        tokenAmount: position.currentTokenAmount,
        slippageBps,
        priorityFeeSol,
        reason: 'manual',
        tokenSymbol: position.tokenSymbol || undefined,
      });

      if (result.success) {
        // Update position to closed with exit details
        await prisma.position.update({
          where: { id: positionId },
          data: {
            status: 'closed',
            exitPrice: result.solReceived ? result.solReceived / position.currentTokenAmount : null,
            exitSol: result.solReceived || null,
            closedAt: new Date(),
          },
        });

        // Log activity
        await prisma.activityLog.create({
          data: {
            userId,
            eventType: 'position:closed',
            eventData: {
              positionId,
              tokenMint: position.tokenMint,
              tokenSymbol: position.tokenSymbol,
              exitSol: result.solReceived,
              signature: result.signature,
            },
          },
        });

        // Emit socket event so frontend can update in real-time
        // Emit manual_sell event first (for activity log to show "Manual Sell")
        await emitToUser(userId, 'position:manual_sell', {
          positionId,
          tokenMint: position.tokenMint,
          tokenSymbol: position.tokenSymbol,
          sniperName: position.sniper?.name || 'Manual',
          exitSol: result.solReceived,
          signature: result.signature,
        });

        // Then emit closed event for position state update
        await emitToUser(userId, 'position:closed', {
          positionId,
          tokenMint: position.tokenMint,
          tokenSymbol: position.tokenSymbol,
          reason: 'manual',
          exitSol: result.solReceived,
          signature: result.signature,
        });

        fastify.log.info(`Manual close successful for position ${positionId}, signature: ${result.signature}`);

        return {
          success: true,
          data: {
            message: 'Position closed successfully',
            positionId,
            exitSol: result.solReceived,
            signature: result.signature,
          },
        };
      } else {
        // Sell failed - revert status back to open so user can retry
        await prisma.position.update({
          where: { id: positionId },
          data: { status: 'open' },
        });

        fastify.log.error(`Manual close failed for position ${positionId}: ${result.error}`);

        return reply.status(500).send({
          success: false,
          error: result.error || 'Failed to execute sell transaction',
        });
      }
    } catch (error) {
      // Revert status on unexpected error
      await prisma.position.update({
        where: { id: positionId },
        data: { status: 'open' },
      });

      fastify.log.error(`Manual close error for position ${positionId}: ${error instanceof Error ? error.message : String(error)}`);

      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unexpected error during sell',
      });
    }
  });
};
