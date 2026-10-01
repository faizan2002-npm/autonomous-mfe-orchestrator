import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

// Export shared singletons
export const prisma = new PrismaClient();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    return Math.min(times * 100, 3000);
  },
  lazyConnect: true,
});
