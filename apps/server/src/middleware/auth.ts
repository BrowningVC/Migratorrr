import { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import { redis } from '../db/redis.js';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
);

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
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

    // Verify session exists in Redis
    const session = await redis.get(`session:${userId}`);
    if (!session) {
      return reply.status(401).send({
        success: false,
        error: 'Session expired. Please log in again.',
      });
    }

    // Attach userId to request
    (request as any).userId = userId;
    (request as any).walletAddress = payload.walletAddress;
  } catch (error) {
    return reply.status(401).send({
      success: false,
      error: 'Invalid or expired token',
    });
  }
}
