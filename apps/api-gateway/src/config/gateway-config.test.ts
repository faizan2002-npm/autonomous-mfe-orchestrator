import test from 'node:test';
import assert from 'node:assert/strict';
import { testEnv } from '../testing/fixtures.js';
import { loadGatewayConfig } from './gateway-config.js';

const UPSTASH_URL = 'rediss://default:token@example.upstash.io:6379';
const SUPABASE_URL =
  'postgresql://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

test('defaults complete the configuration around the hosted services', () => {
  const config = loadGatewayConfig(
    testEnv({ DATABASE_URL: SUPABASE_URL, REDIS_URL: UPSTASH_URL }),
  );
  assert.equal(config.redisUrl, UPSTASH_URL);
  assert.equal(config.databaseUrl, SUPABASE_URL);
  assert.equal(config.port, 4000);
  assert.equal(config.driftThreshold, 0.15);
  assert.equal(config.canaryPercent, 10);
  assert.equal(config.gemini.model, 'gemini-3.5-flash-lite');
  assert.equal(config.gemini.apiKey, undefined);
  assert.equal(config.allowPrivateUpstreams, false);
  assert.equal(config.rateLimitPerMinute, 600);
  assert.equal(config.appUrl, 'http://localhost:5100');
  assert.equal(config.encryptionKey.length, 32);
});

test('missing hosted services and secrets fail with a pointer to the fix', () => {
  assert.throws(
    () =>
      loadGatewayConfig(
        testEnv({ DATABASE_URL: undefined, REDIS_URL: UPSTASH_URL }),
      ),
    /SUPABASE_PROJECT_REF/,
  );
  assert.throws(
    () => loadGatewayConfig(testEnv({ REDIS_URL: undefined })),
    /Upstash/,
  );
  assert.throws(
    () => loadGatewayConfig(testEnv({ ENCRYPTION_KEY: undefined })),
    /ENCRYPTION_KEY is required/,
  );
  assert.throws(
    () => loadGatewayConfig(testEnv({ KEY_PEPPER: 'c2hvcnQ=' })),
    /KEY_PEPPER must be 32 bytes/,
  );
});

test('invalid values fail at startup instead of mid-request', () => {
  for (const [name, value] of [
    ['GATEWAY_PORT', '4000.5'],
    ['DRIFT_SIMILARITY_THRESHOLD', '2'],
    ['CANARY_TRAFFIC_PERCENTAGE', 'ten'],
    ['REDIS_URL', 'http://x'],
    ['DATABASE_URL', 'nope'],
    ['ALLOW_PRIVATE_UPSTREAMS', 'maybe'],
    ['APP_URL', 'ftp://x'],
    ['RATE_LIMIT_PER_MINUTE', '0'],
  ])
    assert.throws(
      () => loadGatewayConfig(testEnv({ [name]: value })),
      new RegExp(name),
      name,
    );
  assert.equal(
    loadGatewayConfig(testEnv({ ALLOW_PRIVATE_UPSTREAMS: 'true' }))
      .allowPrivateUpstreams,
    true,
  );
});
