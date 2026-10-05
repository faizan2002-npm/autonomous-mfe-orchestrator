import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

// Deletes the key only if this holder still owns it, so an expired lock taken over by
// another instance is never released by the previous owner.
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * Runs `task` while holding a Redis lock (SET NX PX), so only one gateway instance does it.
 * Returns undefined without running when another instance holds the lock.
 */
export async function withRedisLock<T>(
  redis: Redis,
  key: string,
  ttlMs: number,
  task: () => Promise<T>,
): Promise<T | undefined> {
  const token = randomUUID();
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (acquired !== 'OK') return undefined;
  try {
    return await task();
  } finally {
    await redis.eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}
