import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '../db/client.js';
import { redis } from '../db/redis.js';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
);

// Validation schemas
const getNonceSchema = z.object({
  walletAddress: z.string().min(32).max(44),
});

const verifySignatureSchema = z.object({
  walletAddress: z.string().min(32).max(44),
  signature: z.string(),
  message: z.string(),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Get nonce for wallet authentication
  fastify.post('/nonce', async (request, reply) => {
    const body = getNonceSchema.parse(request.body);
    const { walletAddress } = body;

    // Generate random nonce
    const nonce = bs58.encode(nacl.randomBytes(32));
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store nonce in Redis
    await redis.set(
      `auth:nonce:${walletAddress}`,
      JSON.stringify({ nonce, expiresAt }),
      'EX',
      300 // 5 minutes TTL
    );

    // Create message to sign
    const message = `Sign this message to authenticate with Migratorrr.\n\nNonce: ${nonce}\nWallet: ${walletAddress}\nTimestamp: ${Date.now()}`;

    return {
      success: true,
      data: {
        nonce,
        message,
        expiresAt,
      },
    };
  });

  // Verify signature and create session
  fastify.post('/verify', async (request, reply) => {
    const body = verifySignatureSchema.parse(request.body);
    const { walletAddress, signature, message } = body;

    // Get stored nonce
    const storedData = await redis.get(`auth:nonce:${walletAddress}`);
    if (!storedData) {
      return reply.status(401).send({
        success: false,
        error: 'Nonce expired or not found. Please request a new one.',
      });
    }

    const { nonce, expiresAt } = JSON.parse(storedData);

    // Check if nonce expired
    if (Date.now() > expiresAt) {
      await redis.del(`auth:nonce:${walletAddress}`);
      return reply.status(401).send({
        success: false,
        error: 'Nonce expired. Please request a new one.',
      });
    }

    // Verify message contains the nonce
    if (!message.includes(nonce)) {
      return reply.status(401).send({
        success: false,
        error: 'Invalid message. Nonce mismatch.',
      });
    }

    // Verify signature
    try {
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      const publicKeyBytes = bs58.decode(walletAddress);

      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKeyBytes
      );

      if (!isValid) {
        return reply.status(401).send({
          success: false,
          error: 'Invalid signature.',
        });
      }
    } catch (error) {
      return reply.status(401).send({
        success: false,
        error: 'Failed to verify signature.',
      });
    }

    // Delete used nonce
    await redis.del(`auth:nonce:${walletAddress}`);

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { walletAddress },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          walletAddress,
        },
      });
      fastify.log.info(`New user created: ${walletAddress}`);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Generate JWT
    const token = await new SignJWT({
      userId: user.id,
      walletAddress: user.walletAddress,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(JWT_SECRET);

    // Store session in Redis
    await redis.set(
      `session:${user.id}`,
      JSON.stringify({
        userId: user.id,
        walletAddress: user.walletAddress,
        createdAt: Date.now(),
      }),
      'EX',
      86400 // 24 hours
    );

    return {
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
        },
      },
    };
  });

  // Verify token
  fastify.get('/me', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: 'Missing authorization header',
      });
    }

    const token = authHeader.slice(7);

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      const userId = payload.userId as string;

      // Check session exists
      const session = await redis.get(`session:${userId}`);
      if (!session) {
        return reply.status(401).send({
          success: false,
          error: 'Session expired',
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return reply.status(401).send({
          success: false,
          error: 'User not found',
        });
      }

      return {
        success: true,
        data: {
          id: user.id,
          walletAddress: user.walletAddress,
          createdAt: user.createdAt,
        },
      };
    } catch (error) {
      return reply.status(401).send({
        success: false,
        error: 'Invalid token',
      });
    }
  });

  // Logout
  fastify.post('/logout', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: 'Missing authorization header',
      });
    }

    const token = authHeader.slice(7);

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      const userId = payload.userId as string;

      // Delete session
      await redis.del(`session:${userId}`);

      return {
        success: true,
        data: { message: 'Logged out successfully' },
      };
    } catch (error) {
      return {
        success: true,
        data: { message: 'Logged out' },
      };
    }
  });
};
