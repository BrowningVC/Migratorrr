import { prisma } from '../db/client.js';
import { emitToUser } from '../websocket/handlers.js';
import { redis } from '../db/redis.js';

export type ActivityEventType =
  | 'sniper:created'
  | 'sniper:activated'
  | 'sniper:paused'
  | 'sniper:deleted'
  | 'sniper:updated'
  | 'migration:detected'
  | 'migration:matched'
  | 'snipe:started'
  | 'snipe:submitted'
  | 'snipe:success'
  | 'snipe:failed'
  | 'snipe:retrying'
  | 'snipe:skipped'
  | 'position:opened'
  | 'position:selling'
  | 'position:closed'
  | 'position:sell_failed'
  | 'position:take_profit'
  | 'position:stop_loss'
  | 'position:trailing_stop'
  | 'price:update'
  | 'wallet:connected'
  | 'wallet:generated'
  | 'wallet:exported';

interface ActivityLogEntry {
  userId: string;
  sniperId?: string;
  eventType: ActivityEventType;
  eventData: Record<string, unknown>;
  timestamp?: Date;
}

/**
 * ActivityLogger - Centralized logging and real-time notification service
 *
 * Features:
 * - Log all significant events to database
 * - Emit real-time updates via WebSocket
 * - Support toast notifications with correct types
 * - Aggregate activity for dashboard views
 */
export class ActivityLogger {
  /**
   * Log an activity event and notify the user
   */
  async log(entry: ActivityLogEntry): Promise<void> {
    const { userId, sniperId, eventType, eventData, timestamp } = entry;

    // Store in database
    await prisma.activityLog.create({
      data: {
        userId,
        sniperId,
        eventType,
        eventData: eventData as Record<string, any>,
        createdAt: timestamp || new Date(),
      },
    });

    // Emit to user in real-time
    await emitToUser(userId, eventType, {
      ...eventData,
      timestamp: (timestamp || new Date()).toISOString(),
    });

    // Store in Redis for quick access (last 100 events per user)
    const redisKey = `activity:${userId}`;
    const activityEntry = JSON.stringify({
      eventType,
      eventData,
      timestamp: (timestamp || new Date()).toISOString(),
    });

    await redis.lpush(redisKey, activityEntry);
    await redis.ltrim(redisKey, 0, 99); // Keep only last 100
    await redis.expire(redisKey, 86400); // Expire after 24 hours

    // Log to console for debugging
    console.log(`[Activity] ${eventType} for user ${userId}:`, eventData);
  }

  /**
   * Log multiple events in batch
   */
  async logBatch(entries: ActivityLogEntry[]): Promise<void> {
    await Promise.all(entries.map((entry) => this.log(entry)));
  }

  /**
   * Get recent activity for a user
   */
  async getRecentActivity(
    userId: string,
    limit = 50
  ): Promise<Array<{ eventType: string; eventData: unknown; timestamp: string }>> {
    // Try Redis first (faster)
    const redisKey = `activity:${userId}`;
    const cached = await redis.lrange(redisKey, 0, limit - 1);

    if (cached.length > 0) {
      return cached.map((entry) => JSON.parse(entry));
    }

    // Fall back to database
    const activities = await prisma.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        eventType: true,
        eventData: true,
        createdAt: true,
      },
    });

    return activities.map((a: { eventType: string; eventData: unknown; createdAt: Date }) => ({
      eventType: a.eventType,
      eventData: a.eventData,
      timestamp: a.createdAt.toISOString(),
    }));
  }

  /**
   * Get activity stats for dashboard
   */
  async getActivityStats(
    userId: string,
    period: 'hour' | 'day' | 'week' = 'day'
  ): Promise<{
    totalSnipes: number;
    successfulSnipes: number;
    failedSnipes: number;
    migrationsDetected: number;
    positionsOpened: number;
    positionsClosed: number;
    profitablePositions: number;
  }> {
    const periodMs = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
    };

    const since = new Date(Date.now() - periodMs[period]);

    const activities = await prisma.activityLog.findMany({
      where: {
        userId,
        createdAt: { gte: since },
      },
      select: {
        eventType: true,
        eventData: true,
      },
    });

    const stats = {
      totalSnipes: 0,
      successfulSnipes: 0,
      failedSnipes: 0,
      migrationsDetected: 0,
      positionsOpened: 0,
      positionsClosed: 0,
      profitablePositions: 0,
    };

    for (const activity of activities) {
      switch (activity.eventType) {
        case 'snipe:started':
          stats.totalSnipes++;
          break;
        case 'snipe:success':
          stats.successfulSnipes++;
          break;
        case 'snipe:failed':
          stats.failedSnipes++;
          break;
        case 'migration:detected':
          stats.migrationsDetected++;
          break;
        case 'position:opened':
          stats.positionsOpened++;
          break;
        case 'position:closed':
        case 'position:take_profit':
        case 'position:stop_loss':
        case 'position:trailing_stop':
          stats.positionsClosed++;
          // Check if profitable
          const data = activity.eventData as { pnlPct?: number };
          if (data.pnlPct && data.pnlPct > 0) {
            stats.profitablePositions++;
          }
          break;
      }
    }

    return stats;
  }

  /**
   * Clear old activity logs
   */
  async cleanupOldLogs(daysToKeep = 30): Promise<number> {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

    const result = await prisma.activityLog.deleteMany({
      where: {
        createdAt: { lt: cutoff },
      },
    });

    console.log(`Cleaned up ${result.count} old activity logs`);
    return result.count;
  }
}

// Singleton instance
export const activityLogger = new ActivityLogger();

// Helper functions for common events
export async function logSniperCreated(
  userId: string,
  sniperId: string,
  sniperName: string
): Promise<void> {
  await activityLogger.log({
    userId,
    sniperId,
    eventType: 'sniper:created',
    eventData: { sniperName },
  });
}

export async function logSniperActivated(
  userId: string,
  sniperId: string,
  sniperName: string
): Promise<void> {
  await activityLogger.log({
    userId,
    sniperId,
    eventType: 'sniper:activated',
    eventData: { sniperName },
  });
}

export async function logSniperPaused(
  userId: string,
  sniperId: string,
  sniperName: string
): Promise<void> {
  await activityLogger.log({
    userId,
    sniperId,
    eventType: 'sniper:paused',
    eventData: { sniperName },
  });
}

export async function logMigrationDetected(
  userId: string,
  data: {
    tokenMint: string;
    tokenName?: string;
    tokenSymbol?: string;
    poolAddress: string;
    liquiditySol: number;
    source: string;
  }
): Promise<void> {
  await activityLogger.log({
    userId,
    eventType: 'migration:detected',
    eventData: data,
  });
}

export async function logSnipeStarted(
  userId: string,
  sniperId: string,
  data: {
    tokenMint: string;
    tokenSymbol?: string;
    amountSol: number;
  }
): Promise<void> {
  await activityLogger.log({
    userId,
    sniperId,
    eventType: 'snipe:started',
    eventData: data,
  });
}

export async function logSnipeSuccess(
  userId: string,
  sniperId: string,
  data: {
    signature: string;
    tokenMint: string;
    tokenSymbol?: string;
    tokenAmount: number;
    solSpent: number;
  }
): Promise<void> {
  await activityLogger.log({
    userId,
    sniperId,
    eventType: 'snipe:success',
    eventData: data,
  });
}

export async function logSnipeFailed(
  userId: string,
  sniperId: string,
  data: {
    tokenMint: string;
    tokenSymbol?: string;
    error: string;
  }
): Promise<void> {
  await activityLogger.log({
    userId,
    sniperId,
    eventType: 'snipe:failed',
    eventData: data,
  });
}
