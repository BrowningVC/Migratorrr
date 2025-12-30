import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';

import { authRoutes } from './routes/auth.js';
import { walletRoutes } from './routes/wallet.js';
import { sniperRoutes } from './routes/sniper.js';
import { positionRoutes } from './routes/position.js';
import { statsRoutes } from './routes/stats.js';
import { adminRoutes } from './routes/admin.js';
import { setupSocketHandlers } from './websocket/handlers.js';
import { prisma } from './db/client.js';
import { redis } from './db/redis.js';

// Services
import { migrationDetector } from './services/migration-detector.js';
import { snipeOrchestrator } from './services/snipe-orchestrator.js';

// Workers
import { snipeWorker } from './workers/snipe-worker.js';
import { automationWorker } from './workers/automation-worker.js';
import { performanceWorker } from './workers/performance-worker.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

// Validate critical environment variables at startup
function validateEnvironment(): void {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Critical - will prevent snipes from executing
  if (!process.env.PLATFORM_FEE_WALLET || process.env.PLATFORM_FEE_WALLET === '11111111111111111111111111111111') {
    errors.push('PLATFORM_FEE_WALLET must be set to a valid Solana wallet address');
  }

  if (!process.env.HELIUS_API_KEY) {
    errors.push('HELIUS_API_KEY is required for RPC access and transaction execution');
  }

  if (!process.env.MASTER_ENCRYPTION_KEY) {
    errors.push('MASTER_ENCRYPTION_KEY is required for wallet encryption');
  }

  // Warnings - will affect functionality but won't prevent startup
  if (!process.env.BACKUP_RPC_URL) {
    warnings.push('BACKUP_RPC_URL not set - no fallback RPC if Helius fails');
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your-jwt-secret-change-in-production') {
    warnings.push('JWT_SECRET should be set to a secure random value in production');
  }

  // Print warnings
  if (warnings.length > 0) {
    console.warn('\n⚠️  Configuration Warnings:');
    warnings.forEach(w => console.warn(`   - ${w}`));
    console.warn('');
  }

  // Print errors and exit if critical config is missing
  if (errors.length > 0) {
    console.error('\n❌ Critical Configuration Errors:');
    errors.forEach(e => console.error(`   - ${e}`));
    console.error('\nPlease set these environment variables before starting the server.\n');
    process.exit(1);
  }
}

// Store io instance globally for access in routes
let ioInstance: Server | null = null;

export function getIO(): Server | null {
  return ioInstance;
}

async function main() {
  // Validate environment before starting
  validateEnvironment();

  // Create Fastify instance
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  // Register plugins
  await fastify.register(cors, {
    origin: CORS_ORIGIN,
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false, // Disable for development
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Register routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(walletRoutes, { prefix: '/api/wallet' });
  await fastify.register(sniperRoutes, { prefix: '/api/sniper' });
  await fastify.register(positionRoutes, { prefix: '/api/position' });
  await fastify.register(statsRoutes, { prefix: '/api/stats' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  // Start core services
  await migrationDetector.start();
  fastify.log.info('Migration Detector started');

  await snipeOrchestrator.start();
  fastify.log.info('Snipe Orchestrator started');

  await snipeWorker.start();
  fastify.log.info('Snipe Worker started');

  await automationWorker.start();
  fastify.log.info('Automation Worker started');

  await performanceWorker.start();
  fastify.log.info('Performance Worker started');

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');

    // Stop workers first
    await performanceWorker.stop();
    await automationWorker.stop();
    await snipeWorker.stop();

    // Stop services
    await snipeOrchestrator.stop();
    await migrationDetector.stop();

    await fastify.close();
    await prisma.$disconnect();
    await redis.quit();

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Server running on http://${HOST}:${PORT}`);

    // Setup Socket.IO after Fastify starts (attach to Fastify's server)
    ioInstance = new Server(fastify.server, {
      cors: {
        origin: CORS_ORIGIN,
        credentials: true,
      },
    });

    setupSocketHandlers(ioInstance);

    fastify.log.info(`Socket.IO ready`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
