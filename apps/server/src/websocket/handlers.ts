import { Server, Socket } from 'socket.io';
import { jwtVerify } from 'jose';
import { redis, redisSub } from '../db/redis.js';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
);

export function setupSocketHandlers(io: Server) {
  // Middleware for authentication
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      const userId = payload.userId as string;

      // Verify session
      const session = await redis.get(`session:${userId}`);
      if (!session) {
        return next(new Error('Session expired'));
      }

      // Attach user info to socket
      (socket as any).userId = userId;
      (socket as any).walletAddress = payload.walletAddress;

      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    console.log(`User connected: ${userId}`);

    // Join user-specific room
    socket.join(`user:${userId}`);

    // Handle ping (for connection health)
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // Subscribe to user's activity updates
    socket.on('subscribe:activity', () => {
      console.log(`User ${userId} subscribed to activity`);
    });

    // Unsubscribe from activity
    socket.on('unsubscribe:activity', () => {
      console.log(`User ${userId} unsubscribed from activity`);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`User disconnected: ${userId} (${reason})`);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for user ${userId}:`, error);
    });
  });

  // Subscribe to Redis pub/sub for broadcasting events
  setupRedisPubSub(io);

  console.log('Socket.IO handlers initialized');
}

function setupRedisPubSub(io: Server) {
  // Subscribe to migration events channel
  redisSub.subscribe('migrations', (err) => {
    if (err) {
      console.error('Failed to subscribe to migrations channel:', err);
    } else {
      console.log('Subscribed to migrations channel');
    }
  });

  // Subscribe to user events channel
  redisSub.subscribe('user-events', (err) => {
    if (err) {
      console.error('Failed to subscribe to user-events channel:', err);
    } else {
      console.log('Subscribed to user-events channel');
    }
  });

  // Handle incoming messages
  redisSub.on('message', (channel, message) => {
    try {
      const event = JSON.parse(message);

      switch (channel) {
        case 'migrations':
          // Broadcast to all connected users
          io.emit('migration:detected', event);
          break;

        case 'user-events':
          // Send to specific user
          if (event.userId) {
            io.to(`user:${event.userId}`).emit(event.type, event);
          }
          break;

        default:
          console.warn(`Unknown channel: ${channel}`);
      }
    } catch (error) {
      console.error('Failed to process Redis message:', error);
    }
  });
}

/**
 * Helper function to emit events to a specific user
 * Can be used from any service
 */
export async function emitToUser(
  userId: string,
  eventType: string,
  eventData: any
) {
  const event = {
    type: eventType,
    timestamp: Date.now(),
    userId,
    ...eventData,
  };

  // Publish to Redis for distribution
  await redis.publish('user-events', JSON.stringify(event));
}

/**
 * Helper function to broadcast migration events
 */
export async function broadcastMigration(migrationData: any) {
  const event = {
    type: 'migration:detected',
    timestamp: Date.now(),
    ...migrationData,
  };

  await redis.publish('migrations', JSON.stringify(event));
}
