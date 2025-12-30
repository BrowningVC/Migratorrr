import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { prisma } from '../db/client.js';
import { redis } from '../db/redis.js';
import { authenticate } from '../middleware/auth.js';
import { SecureWalletService } from '../services/secure-wallet.js';

const walletService = new SecureWalletService();

// Solana connection for balance checks
const RPC_URL = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Balance cache settings - reduces Helius getBalance calls from user dashboard refreshes
const USER_BALANCE_CACHE_PREFIX = 'user-wallet-balance:';
const USER_BALANCE_CACHE_TTL_SECONDS = 15; // Cache for 15 seconds (user dashboard can refresh frequently)

const connectWalletSchema = z.object({
  publicKey: z.string().min(32).max(44),
  label: z.string().max(100).optional(),
  isPrimary: z.boolean().optional(),
});

const generateWalletSchema = z.object({
  label: z.string().max(100).optional(),
  isPrimary: z.boolean().optional(),
});

export const walletRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all wallets for user
  fastify.get('/', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;

    const wallets = await prisma.wallet.findMany({
      where: { userId, isActive: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        publicKey: true,
        walletType: true,
        label: true,
        isPrimary: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      data: wallets,
    };
  });

  // Get wallet balance(s)
  fastify.get('/balances', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;

    const wallets = await prisma.wallet.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        publicKey: true,
        label: true,
        walletType: true,
      },
    });

    // Fetch balances in parallel (with Redis caching to reduce Helius RPC calls)
    const balancePromises = wallets.map(async (wallet) => {
      const cacheKey = `${USER_BALANCE_CACHE_PREFIX}${wallet.publicKey}`;
      try {
        // Check cache first
        const cachedBalance = await redis.get(cacheKey);
        let balance: number;

        if (cachedBalance !== null) {
          balance = Math.round(parseFloat(cachedBalance) * LAMPORTS_PER_SOL);
        } else {
          const pubkey = new PublicKey(wallet.publicKey);
          balance = await connection.getBalance(pubkey);
          // Cache the balance in SOL
          await redis.setex(cacheKey, USER_BALANCE_CACHE_TTL_SECONDS, (balance / LAMPORTS_PER_SOL).toString());
        }

        return {
          walletId: wallet.id,
          publicKey: wallet.publicKey,
          label: wallet.label,
          walletType: wallet.walletType,
          balanceLamports: balance,
          balanceSol: balance / LAMPORTS_PER_SOL,
        };
      } catch (error) {
        fastify.log.error(`Failed to fetch balance for ${wallet.publicKey}:`, error);
        return {
          walletId: wallet.id,
          publicKey: wallet.publicKey,
          label: wallet.label,
          walletType: wallet.walletType,
          balanceLamports: 0,
          balanceSol: 0,
          error: 'Failed to fetch balance',
        };
      }
    });

    const balances = await Promise.all(balancePromises);

    return {
      success: true,
      data: balances,
    };
  });

  // Get single wallet balance
  fastify.get('/:walletId/balance', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { walletId } = request.params as { walletId: string };

    const wallet = await prisma.wallet.findFirst({
      where: { id: walletId, userId, isActive: true },
      select: {
        id: true,
        publicKey: true,
        label: true,
        walletType: true,
      },
    });

    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: 'Wallet not found',
      });
    }

    const cacheKey = `${USER_BALANCE_CACHE_PREFIX}${wallet.publicKey}`;
    try {
      // Check cache first
      const cachedBalance = await redis.get(cacheKey);
      let balance: number;

      if (cachedBalance !== null) {
        balance = Math.round(parseFloat(cachedBalance) * LAMPORTS_PER_SOL);
      } else {
        const pubkey = new PublicKey(wallet.publicKey);
        balance = await connection.getBalance(pubkey);
        // Cache the balance
        await redis.setex(cacheKey, USER_BALANCE_CACHE_TTL_SECONDS, (balance / LAMPORTS_PER_SOL).toString());
      }

      return {
        success: true,
        data: {
          walletId: wallet.id,
          publicKey: wallet.publicKey,
          label: wallet.label,
          walletType: wallet.walletType,
          balanceLamports: balance,
          balanceSol: balance / LAMPORTS_PER_SOL,
        },
      };
    } catch (error) {
      fastify.log.error(`Failed to fetch balance for ${wallet.publicKey}:`, error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch balance from Solana network',
      });
    }
  });

  // Connect external wallet
  fastify.post('/connect', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const body = connectWalletSchema.parse(request.body);

    // Check if wallet already connected
    const existing = await prisma.wallet.findFirst({
      where: { publicKey: body.publicKey },
    });

    if (existing) {
      if (existing.userId === userId) {
        return reply.status(400).send({
          success: false,
          error: 'Wallet already connected to your account',
        });
      }
      return reply.status(400).send({
        success: false,
        error: 'Wallet already connected to another account',
      });
    }

    // If setting as primary, unset other primary wallets
    if (body.isPrimary) {
      await prisma.wallet.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        publicKey: body.publicKey,
        walletType: 'connected',
        label: body.label,
        isPrimary: body.isPrimary ?? false,
      },
      select: {
        id: true,
        publicKey: true,
        walletType: true,
        label: true,
        isPrimary: true,
        createdAt: true,
      },
    });

    fastify.log.info(`Wallet connected: ${body.publicKey} for user ${userId}`);

    return {
      success: true,
      data: wallet,
    };
  });

  // Generate new wallet
  fastify.post('/generate', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const body = generateWalletSchema.parse(request.body);

    // Generate keypair
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();

    // Encrypt and store private key
    const encrypted = await walletService.encryptPrivateKey(
      keypair.secretKey,
      userId
    );

    // If setting as primary, unset other primary wallets
    if (body.isPrimary) {
      await prisma.wallet.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        publicKey,
        walletType: 'generated',
        label: body.label || 'Generated Wallet',
        isPrimary: body.isPrimary ?? false,
        encryptedPrivateKey: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.version,
      },
      select: {
        id: true,
        publicKey: true,
        walletType: true,
        label: true,
        isPrimary: true,
        createdAt: true,
      },
    });

    fastify.log.info(`Wallet generated: ${publicKey} for user ${userId}`);

    return {
      success: true,
      data: wallet,
    };
  });

  // Export private key (generated wallets only)
  fastify.post('/:walletId/export', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { walletId } = request.params as { walletId: string };

    const wallet = await prisma.wallet.findFirst({
      where: { id: walletId, userId },
    });

    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: 'Wallet not found',
      });
    }

    if (wallet.walletType !== 'generated') {
      return reply.status(400).send({
        success: false,
        error: 'Can only export generated wallets. Connected wallets are managed by your external wallet.',
      });
    }

    if (!wallet.encryptedPrivateKey || !wallet.iv || !wallet.authTag) {
      return reply.status(500).send({
        success: false,
        error: 'Wallet encryption data not found',
      });
    }

    // Decrypt private key
    const privateKey = await walletService.decryptPrivateKey(
      {
        ciphertext: wallet.encryptedPrivateKey,
        iv: wallet.iv,
        authTag: wallet.authTag,
        version: wallet.keyVersion || 1,
      },
      userId
    );

    const privateKeyBase58 = bs58.encode(privateKey);

    // Zero out the decrypted key
    privateKey.fill(0);

    // Log audit event
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'PRIVATE_KEY_EXPORTED',
        resourceType: 'wallet',
        resourceId: walletId,
        ipAddress: request.ip,
      },
    });

    fastify.log.warn(`Private key exported for wallet ${walletId} by user ${userId}`);

    return {
      success: true,
      data: {
        privateKey: privateKeyBase58,
        warning: 'Store this securely. Anyone with this key has full control of the wallet.',
      },
    };
  });

  // Set wallet as primary
  fastify.patch('/:walletId/primary', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { walletId } = request.params as { walletId: string };

    const wallet = await prisma.wallet.findFirst({
      where: { id: walletId, userId },
    });

    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: 'Wallet not found',
      });
    }

    // Unset other primary wallets
    await prisma.wallet.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });

    // Set this wallet as primary
    const updated = await prisma.wallet.update({
      where: { id: walletId },
      data: { isPrimary: true },
      select: {
        id: true,
        publicKey: true,
        walletType: true,
        label: true,
        isPrimary: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      data: updated,
    };
  });

  // Update wallet label
  fastify.patch('/:walletId', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { walletId } = request.params as { walletId: string };
    const body = z.object({ label: z.string().max(100) }).parse(request.body);

    const wallet = await prisma.wallet.findFirst({
      where: { id: walletId, userId },
    });

    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: 'Wallet not found',
      });
    }

    const updated = await prisma.wallet.update({
      where: { id: walletId },
      data: { label: body.label },
      select: {
        id: true,
        publicKey: true,
        walletType: true,
        label: true,
        isPrimary: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      data: updated,
    };
  });

  // Deactivate wallet (soft delete)
  fastify.delete('/:walletId', { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId;
    const { walletId } = request.params as { walletId: string };

    const wallet = await prisma.wallet.findFirst({
      where: { id: walletId, userId },
    });

    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: 'Wallet not found',
      });
    }

    // Check if wallet has active snipers
    const activeSnipers = await prisma.sniperConfig.count({
      where: { walletId, isActive: true },
    });

    if (activeSnipers > 0) {
      return reply.status(400).send({
        success: false,
        error: `Cannot delete wallet with ${activeSnipers} active sniper(s). Deactivate them first.`,
      });
    }

    await prisma.wallet.update({
      where: { id: walletId },
      data: { isActive: false },
    });

    fastify.log.info(`Wallet deactivated: ${walletId} by user ${userId}`);

    return {
      success: true,
      data: { message: 'Wallet deactivated successfully' },
    };
  });
};
