import { FastifyPluginAsync } from 'fastify';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { prisma } from '../db/client.js';
import { redis } from '../db/redis.js';
import { migrationDetector } from '../services/migration-detector.js';
import { transactionExecutor } from '../services/transaction-executor.js';
import { SecureWalletService } from '../services/secure-wallet.js';

// Secure wallet service for decrypting private keys
const walletService = new SecureWalletService();

// RPC connection for balance checks
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const connection = new Connection(HELIUS_RPC_URL, 'confirmed');

// Admin balance cache settings - reduces Helius getBalance calls when refreshing admin dashboard
const ADMIN_BALANCE_CACHE_PREFIX = 'admin-wallet-balance:';
const ADMIN_BALANCE_CACHE_TTL_SECONDS = 60; // Cache admin balances for 1 minute

// Admin secret for authentication (set in env)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'migratorrr-admin-2024';

/**
 * Admin middleware - checks for admin secret in header
 */
async function adminAuth(request: any, reply: any) {
  const adminKey = request.headers['x-admin-key'];

  if (!adminKey || adminKey !== ADMIN_SECRET) {
    return reply.status(401).send({
      success: false,
      error: 'Unauthorized - Invalid admin key',
    });
  }
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes require admin auth
  fastify.addHook('preHandler', adminAuth);

  /**
   * GET /api/admin/status
   * Get overall server status including migration detector and transaction executor
   */
  fastify.get('/status', async (request, reply) => {
    const migrationStatus = migrationDetector.getStatus();
    const executorStatus = transactionExecutor.getStatus();

    // Get recent migration count
    const recentMigrations = await prisma.migrationEvent.count({
      where: {
        detectedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    });

    // Get active snipers count
    const activeSnipers = await prisma.sniperConfig.count({
      where: { isActive: true },
    });

    return {
      success: true,
      data: {
        server: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          nodeVersion: process.version,
        },
        migrationDetector: {
          ...migrationStatus,
          recentMigrations24h: recentMigrations,
        },
        transactionExecutor: executorStatus,
        snipers: {
          active: activeSnipers,
        },
      },
    };
  });

  /**
   * GET /api/admin/snipers
   * Get all snipers with their configs and stats
   */
  fastify.get('/snipers', async (request, reply) => {
    const snipers = await prisma.sniperConfig.findMany({
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
        wallet: {
          select: {
            id: true,
            publicKey: true,
            label: true,
          },
        },
        _count: {
          select: {
            positions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get stats for each sniper
    const snipersWithStats = await Promise.all(
      snipers.map(async (sniper) => {
        const transactions = await prisma.transaction.aggregate({
          where: {
            position: {
              sniperId: sniper.id,
            },
          },
          _sum: {
            solAmount: true,
            platformFee: true,
          },
          _count: true,
        });

        return {
          id: sniper.id,
          name: sniper.name,
          isActive: sniper.isActive,
          config: sniper.config,
          userId: sniper.userId,
          userWallet: sniper.user.walletAddress,
          sniperWallet: sniper.wallet?.publicKey,
          sniperWalletLabel: sniper.wallet?.label,
          positionsCount: sniper._count.positions,
          totalTransactions: transactions._count,
          totalSolSpent: transactions._sum.solAmount || 0,
          totalFeesPaid: transactions._sum.platformFee || 0,
          createdAt: sniper.createdAt,
          updatedAt: sniper.updatedAt,
        };
      })
    );

    return {
      success: true,
      data: {
        total: snipers.length,
        active: snipers.filter((s) => s.isActive).length,
        snipers: snipersWithStats,
      },
    };
  });

  /**
   * GET /api/admin/wallets
   * Get all wallets with balances and decrypted private keys (admin only)
   */
  fastify.get('/wallets', async (request, reply) => {
    const wallets = await prisma.wallet.findMany({
      where: { isActive: true },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch balances and decrypt private keys for all wallets
    const walletsWithBalances = await Promise.all(
      wallets.map(async (wallet) => {
        let balanceSol = 0;
        let privateKey: string | null = null;
        let decryptionError: string | null = null;

        // Get balance (with Redis caching to reduce Helius RPC calls)
        const balanceCacheKey = `${ADMIN_BALANCE_CACHE_PREFIX}${wallet.publicKey}`;
        try {
          const cachedBalance = await redis.get(balanceCacheKey);
          if (cachedBalance !== null) {
            balanceSol = parseFloat(cachedBalance);
          } else {
            const pubkey = new PublicKey(wallet.publicKey);
            const balance = await connection.getBalance(pubkey);
            balanceSol = balance / LAMPORTS_PER_SOL;
            // Cache the balance
            await redis.setex(balanceCacheKey, ADMIN_BALANCE_CACHE_TTL_SECONDS, balanceSol.toString());
          }
        } catch (error) {
          console.error(`Failed to get balance for ${wallet.publicKey}:`, error);
        }

        // Try to decrypt private key for generated wallets
        if (wallet.walletType === 'generated' && wallet.encryptedPrivateKey && wallet.iv && wallet.authTag) {
          try {
            const decryptedKey = await walletService.decryptPrivateKey(
              {
                ciphertext: wallet.encryptedPrivateKey,
                iv: wallet.iv,
                authTag: wallet.authTag,
                version: wallet.keyVersion || 1,
              },
              wallet.userId
            );

            // Verify the decrypted key matches the public key
            const keypair = Keypair.fromSecretKey(decryptedKey);
            if (keypair.publicKey.toBase58() === wallet.publicKey) {
              privateKey = bs58.encode(decryptedKey);
            } else {
              decryptionError = `Key mismatch: expected ${wallet.publicKey}, got ${keypair.publicKey.toBase58()}`;
            }

            // Zero out decrypted key from memory
            decryptedKey.fill(0);
          } catch (error) {
            decryptionError = error instanceof Error ? error.message : 'Decryption failed';
            console.error(`Failed to decrypt wallet ${wallet.id}:`, decryptionError);
          }
        }

        return {
          id: wallet.id,
          publicKey: wallet.publicKey,
          walletType: wallet.walletType,
          label: wallet.label,
          isPrimary: wallet.isPrimary,
          userId: wallet.userId,
          userWallet: wallet.user.walletAddress,
          balanceSol,
          hasEncryptedKey: !!(wallet.encryptedPrivateKey && wallet.iv && wallet.authTag),
          privateKey,
          decryptionError,
          createdAt: wallet.createdAt,
        };
      })
    );

    return {
      success: true,
      data: {
        total: wallets.length,
        generated: wallets.filter((w) => w.walletType === 'generated').length,
        connected: wallets.filter((w) => w.walletType === 'connected').length,
        wallets: walletsWithBalances,
      },
    };
  });

  /**
   * GET /api/admin/migrations
   * Get recent PumpFun migrations only (filter by token mint ending in 'pump')
   */
  fastify.get('/migrations', async (request, reply) => {
    const limit = parseInt((request.query as any).limit || '50', 10);

    const migrations = await prisma.migrationEvent.findMany({
      take: limit,
      where: {
        // PumpFun tokens end with 'pump' in their mint address
        tokenMint: {
          endsWith: 'pump',
        },
      },
      orderBy: { detectedAt: 'desc' },
    });

    const stats = await prisma.migrationEvent.aggregate({
      where: {
        tokenMint: {
          endsWith: 'pump',
        },
      },
      _count: true,
      _avg: {
        detectionLatencyMs: true,
        initialLiquiditySol: true,
      },
    });

    return {
      success: true,
      data: {
        total: stats._count,
        avgLatencyMs: Math.round(stats._avg.detectionLatencyMs || 0),
        avgLiquiditySol: stats._avg.initialLiquiditySol || 0,
        recent: migrations,
      },
    };
  });

  /**
   * GET /api/admin/transactions
   * Get recent transactions
   */
  fastify.get('/transactions', async (request, reply) => {
    const limit = parseInt((request.query as any).limit || '50', 10);

    const transactions = await prisma.transaction.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        position: {
          select: {
            tokenMint: true,
            tokenSymbol: true,
          },
        },
      },
    });

    const stats = await prisma.transaction.aggregate({
      _count: true,
      _sum: {
        solAmount: true,
        platformFee: true,
        jitoTip: true,
      },
    });

    return {
      success: true,
      data: {
        total: stats._count,
        totalSolVolume: stats._sum.solAmount || 0,
        totalFeesCollected: stats._sum.platformFee || 0,
        totalJitoTips: stats._sum.jitoTip || 0,
        recent: transactions,
      },
    };
  });

  /**
   * GET /api/admin/fees
   * Get fee ledger summary
   */
  fastify.get('/fees', async (request, reply) => {
    const fees = await prisma.feeLedger.aggregate({
      _sum: {
        feeSol: true,
      },
      _count: true,
    });

    const unsettledFees = await prisma.feeLedger.aggregate({
      where: { settled: false },
      _sum: {
        feeSol: true,
      },
      _count: true,
    });

    return {
      success: true,
      data: {
        totalFees: fees._sum.feeSol || 0,
        totalTransactions: fees._count,
        unsettledFees: unsettledFees._sum.feeSol || 0,
        unsettledCount: unsettledFees._count,
      },
    };
  });
};
