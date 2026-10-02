import test from 'node:test';
import assert from 'node:assert/strict';
import type { Redis } from 'ioredis';
import { testConfig } from '../testing/fixtures.js';
import { ConsumerAuthService } from './consumer-auth.service.js';
import type {
  ConsumersService,
  ResolvedConsumer,
} from './consumers.service.js';

const publishable: ResolvedConsumer = {
  keyId: 'k1',
  keyType: 'publishable',
  allowedOrigins: ['https://app.example'],
  orgId: 'org',
  orgSlug: 'acme',
  consumerId: 'c1',
  consumerName: 'web',
  kind: 'frontend',
  serviceIds: [],
};

function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    multi() {
      let key = '';
      const chain = {
        incr(name: string) {
          key = name;
          return chain;
        },
        expire() {
          return chain;
        },
        async exec() {
          counts.set(key, (counts.get(key) ?? 0) + 1);
          return [
            [null, counts.get(key)],
            [null, 1],
          ];
        },
      };
      return chain;
    },
  } as unknown as Redis;
}

function service(resolved: ResolvedConsumer | null, limit = '2') {
  const consumers = {
    resolveKey: async () => resolved,
    touchKey: async () => undefined,
  } as unknown as ConsumersService;
  return new ConsumerAuthService(
    consumers,
    fakeRedis(),
    testConfig({ RATE_LIMIT_PER_MINUTE: limit }),
  );
}

test('missing, malformed and unknown keys are rejected with 401', async () => {
  await assert.rejects(
    service(publishable).authenticate(undefined, undefined),
    { status: 401 },
  );
  await assert.rejects(
    service(publishable).authenticate('not-a-key', undefined),
    { status: 401 },
  );
  await assert.rejects(service(null).authenticate('sk_unknown', undefined), {
    status: 401,
  });
});

test('publishable keys only work from their allowed origins', async () => {
  const auth = service(publishable);
  await assert.rejects(auth.authenticate('pk_x', undefined), { status: 403 });
  await assert.rejects(auth.authenticate('pk_x', 'https://evil.example'), {
    status: 403,
  });
  assert.equal(
    (await auth.authenticate('pk_x', 'https://app.example')).consumerId,
    'c1',
  );
});

test('each key is rate limited per minute', async () => {
  const auth = service({
    ...publishable,
    keyType: 'secret',
    allowedOrigins: [],
  });
  await auth.authenticate('sk_x', undefined);
  await auth.authenticate('sk_x', undefined);
  await assert.rejects(auth.authenticate('sk_x', undefined), { status: 429 });
});
