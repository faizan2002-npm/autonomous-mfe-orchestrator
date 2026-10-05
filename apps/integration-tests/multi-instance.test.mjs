import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import Redis from 'ioredis';

// Integration tests for multi-instance healing with distributed Redis locks

let redis;
let redis2; // Simulated second instance

const lockName = 'healing:org:consumer:service:GET:/users';
const lockTtl = 5000; // 5 second TTL

describe('Multi-Instance Healing (Integration)', () => {
  before(async () => {
    redis = new Redis(process.env.TEST_REDIS_URL || 'redis://localhost:6379');
    redis2 = new Redis(process.env.TEST_REDIS_URL || 'redis://localhost:6379');
  });

  after(async () => {
    await redis.quit();
    await redis2.quit();
  });

  describe('Distributed Healing Lock', () => {
    test('only one instance should acquire lock for contract healing', async (t) => {
      // Clear lock state
      await redis.del(lockName);

      // Instance 1 tries to acquire lock
      const lock1 = await redis.set(
        lockName,
        'instance-1',
        'EX',
        Math.ceil(lockTtl / 1000),
        'NX'
      );
      assert.equal(lock1, 'OK', 'Instance 1 should acquire lock');

      // Instance 2 tries to acquire same lock (should fail)
      const lock2 = await redis2.set(
        lockName,
        'instance-2',
        'EX',
        Math.ceil(lockTtl / 1000),
        'NX'
      );
      assert.equal(lock2, null, 'Instance 2 should NOT acquire lock');

      // Verify lock is held by instance 1
      const owner = await redis.get(lockName);
      assert.equal(owner, 'instance-1', 'Lock should be held by instance 1');

      // Cleanup
      await redis.del(lockName);
    });

    test('lock should be released after TTL expires', async (t) => {
      await redis.del(lockName);

      // Acquire lock with short TTL (1 second)
      const lock1 = await redis.set(
        lockName,
        'instance-1',
        'EX',
        '1',
        'NX'
      );
      assert.equal(lock1, 'OK', 'Should acquire lock');

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 1200));

      // Lock should be released
      const lock2 = await redis2.set(
        lockName,
        'instance-2',
        'EX',
        '1',
        'NX'
      );
      assert.equal(lock2, 'OK', 'Should acquire lock after TTL expires');

      await redis.del(lockName);
    });

    test('should handle lock contention with backoff', async (t) => {
      await redis.del(lockName);

      const attempts = [];

      // Both instances attempt to acquire lock with backoff
      for (let i = 0; i < 5; i++) {
        const [lock1, lock2] = await Promise.all([
          redis.set(lockName, 'instance-1', 'EX', '10', 'NX'),
          redis2.set(lockName, 'instance-2', 'EX', '10', 'NX'),
        ]);

        attempts.push({ lock1: lock1 === 'OK', lock2: lock2 === 'OK' });

        // One should succeed (OR both fail if already held), never both succeed
        const successCount = [lock1 === 'OK', lock2 === 'OK'].filter(Boolean).length;
        assert(successCount <= 1, 'Only one instance should succeed');

        // Backoff before retry
        if (i < 4) {
          await new Promise((r) => setTimeout(r, 100 * Math.pow(1.5, i)));
        }

        // Release if held, for next iteration
        if (lock1 === 'OK') await redis.del(lockName);
        if (lock2 === 'OK') await redis2.del(lockName);
      }

      assert(attempts.length > 0, 'Should have made attempts');
      await redis.del(lockName);
    });
  });

  describe('Event Propagation (Redis Pub/Sub)', () => {
    test('healing events should propagate via pub/sub', async (t) => {
      const channel = 'healing:events';
      const eventData = JSON.stringify({
        event: 'healing.completed',
        contractRef: 'org:consumer:service:GET:/users',
      });

      const subscriber = new Redis(
        process.env.TEST_REDIS_URL || 'redis://localhost:6379'
      );

      let receivedMessage = null;

      // Subscribe to channel
      await subscriber.subscribe(channel);
      subscriber.on('message', (ch, message) => {
        if (ch === channel) {
          receivedMessage = message;
        }
      });

      // Give subscriber time to connect
      await new Promise((r) => setTimeout(r, 100));

      // Publish event from "other instance"
      await redis.publish(channel, eventData);

      // Wait for message
      await new Promise((r) => setTimeout(r, 200));

      assert.equal(
        receivedMessage,
        eventData,
        'Should receive published event'
      );

      await subscriber.unsubscribe();
      await subscriber.quit();
    });

    test('multiple subscribers should receive same event', async (t) => {
      const channel = 'healing:events:test';
      const eventData = JSON.stringify({ event: 'test' });

      const sub1 = new Redis(
        process.env.TEST_REDIS_URL || 'redis://localhost:6379'
      );
      const sub2 = new Redis(
        process.env.TEST_REDIS_URL || 'redis://localhost:6379'
      );

      const messages1 = [];
      const messages2 = [];

      sub1.on('message', (ch, msg) => {
        if (ch === channel) messages1.push(msg);
      });
      sub2.on('message', (ch, msg) => {
        if (ch === channel) messages2.push(msg);
      });

      await sub1.subscribe(channel);
      await sub2.subscribe(channel);

      // Wait for subscriptions
      await new Promise((r) => setTimeout(r, 100));

      // Publish event
      await redis.publish(channel, eventData);

      // Wait for delivery
      await new Promise((r) => setTimeout(r, 200));

      assert.equal(messages1.length, 1, 'Sub1 should receive message');
      assert.equal(messages2.length, 1, 'Sub2 should receive message');
      assert.equal(messages1[0], eventData, 'Messages should match');
      assert.equal(messages2[0], eventData, 'Messages should match');

      await sub1.unsubscribe();
      await sub2.unsubscribe();
      await sub1.quit();
      await sub2.quit();
    });
  });
});
