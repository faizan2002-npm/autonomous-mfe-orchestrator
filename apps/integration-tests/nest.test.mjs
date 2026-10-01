import { sql } from 'drizzle-orm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
assert.ok(
  databaseUrl && redisUrl,
  'Use disposable TEST_DATABASE_URL and TEST_REDIS_URL services',
);
process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;

// Source mode checks tsx development startup; default checks compiled production code.
const gatewayRoot = resolve(import.meta.dirname, '../api-gateway');
const source = process.env.TEST_GATEWAY_SOURCE === 'true';
const loadGateway = (path) =>
  import(
    pathToFileURL(
      `${gatewayRoot}/${source ? 'src' : 'dist'}/${path}.${source ? 'ts' : 'js'}`,
    ).href
  );
const { createGateway } = await loadGateway('application');
const { DRIZZLE_DB } = await loadGateway('database/database.tokens');
const { REDIS_CLIENT } = await loadGateway('redis/redis.tokens');

test('Nest resolves real providers, serves database-backed routes, validates DTOs and closes connections', async () => {
  const setup = postgres(databaseUrl);
  try {
    await migrate(drizzle(setup), {
      migrationsFolder: resolve(
        gatewayRoot,
        '../../packages/database/migrations',
      ),
    });
  } finally {
    await setup.end();
  }

  const app = await createGateway({ logger: false, shutdownHooks: false });
  const redis = app.get(REDIS_CLIENT);
  const db = app.get(DRIZZLE_DB);
  try {
    assert.equal(await redis.ping(), 'PONG');
    await db.execute(sql`select 1`);
    const http = app.getHttpAdapter().getInstance();
    const overview = await http.inject({
      method: 'GET',
      url: '/api/governance/overview',
    });
    assert.equal(overview.statusCode, 200);
    assert.ok(Array.isArray(overview.json().services));
    const badUuid = await http.inject({
      method: 'POST',
      url: '/api/governance/patches/invalid/promote',
      payload: { serviceName: 'user-service' },
    });
    assert.equal(badUuid.statusCode, 400);
    const badBody = await http.inject({
      method: 'POST',
      url: '/api/governance/patches/00000000-0000-4000-8000-000000000001/promote',
      payload: { serviceName: 42, unexpected: true },
    });
    assert.equal(badBody.statusCode, 400);
    const missingPatch = await http.inject({
      method: 'POST',
      url: '/api/governance/patches/00000000-0000-4000-8000-000000000001/promote',
      payload: { serviceName: 'user-service' },
    });
    assert.equal(missingPatch.statusCode, 404);
    const missingService = await http.inject({
      method: 'GET',
      url: '/api/v1/unregistered/users',
    });
    assert.equal(missingService.statusCode, 404);
    const remoteEntry = await http.inject({
      method: 'GET',
      url: '/patches/user-service/remoteEntry.js',
    });
    assert.equal(remoteEntry.statusCode, 200);
  } finally {
    await app.close();
  }
  assert.equal(redis.status, 'end');
  await assert.rejects(db.execute(sql`select 1`));
});
