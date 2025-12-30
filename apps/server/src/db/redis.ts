import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) {
      return null; // Stop retrying
    }
    return Math.min(times * 100, 3000);
  },
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

redis.on('error', (err) => {
  console.error('Redis error:', err);
});

// Pub/Sub client (separate connection required for subscriptions)
export const redisSub = new Redis(REDIS_URL);

redisSub.on('connect', () => {
  console.log('Redis subscriber connected');
});

redisSub.on('error', (err) => {
  console.error('Redis subscriber error:', err);
});
