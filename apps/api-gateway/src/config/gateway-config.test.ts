import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGatewayConfig } from './gateway-config.js';

const UPSTASH_URL = 'rediss://default:token@example.upstash.io:6379';
const SUPABASE_URL =
  'postgresql://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

test('defaults complete the configuration around the Supabase URL', () => {
  const config = loadGatewayConfig({
    DATABASE_URL: SUPABASE_URL,
    REDIS_URL: UPSTASH_URL,
  });
  assert.equal(config.redisUrl, UPSTASH_URL);
  assert.equal(config.databaseUrl, SUPABASE_URL);
  assert.equal(config.port, 4000);
  assert.equal(config.driftThreshold, 0.15);
  assert.equal(config.canaryPercent, 10);
  assert.equal(config.gemini.model, 'gemini-3.5-flash-lite');
  assert.equal(config.gemini.apiKey, undefined);
  assert.ok(config.serviceEndpoints['user-service']);
});

test('missing hosted service URLs fail with a pointer to the provider', () => {
  assert.throws(
    () => loadGatewayConfig({ REDIS_URL: UPSTASH_URL }),
    /SUPABASE_PROJECT_REF/,
  );
  assert.throws(
    () => loadGatewayConfig({ DATABASE_URL: SUPABASE_URL }),
    /Upstash/,
  );
});

test('invalid values fail at startup instead of mid-request', () => {
  assert.throws(
    () =>
      loadGatewayConfig({
        DATABASE_URL: SUPABASE_URL,
        REDIS_URL: UPSTASH_URL,
        GATEWAY_PORT: '4000.5',
      }),
    /GATEWAY_PORT/,
  );
  assert.throws(
    () =>
      loadGatewayConfig({
        DATABASE_URL: SUPABASE_URL,
        REDIS_URL: UPSTASH_URL,
        DRIFT_SIMILARITY_THRESHOLD: '2',
      }),
    /DRIFT_SIMILARITY_THRESHOLD/,
  );
  assert.throws(
    () =>
      loadGatewayConfig({
        DATABASE_URL: SUPABASE_URL,
        REDIS_URL: UPSTASH_URL,
        CANARY_TRAFFIC_PERCENTAGE: 'ten',
      }),
    /CANARY_TRAFFIC_PERCENTAGE/,
  );
  assert.throws(
    () =>
      loadGatewayConfig({ DATABASE_URL: SUPABASE_URL, REDIS_URL: 'http://x' }),
    /REDIS_URL/,
  );
  assert.throws(
    () => loadGatewayConfig({ DATABASE_URL: 'nope', REDIS_URL: UPSTASH_URL }),
    /DATABASE_URL/,
  );
});
