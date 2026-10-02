import { sql } from 'drizzle-orm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
assert.ok(
  databaseUrl && redisUrl,
  'Use disposable TEST_DATABASE_URL and TEST_REDIS_URL services',
);
process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;

// A local JWKS stands in for Supabase Auth so the real guard and verifier are exercised.
const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwks = {
  keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' }],
};
const authServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(jwks));
});
await new Promise((done) => authServer.listen(0, '127.0.0.1', done));
const supabaseUrl = `http://127.0.0.1:${authServer.address().port}`;
process.env.SUPABASE_URL = supabaseUrl;
const accessToken = await new SignJWT({ email: 'reviewer@example.com' })
  .setProtectedHeader({ alg: 'ES256', kid: 'test' })
  .setSubject('reviewer-id')
  .setIssuer(`${supabaseUrl}/auth/v1`)
  .setAudience('authenticated')
  .setExpirationTime('10m')
  .sign(privateKey);
const auth = { authorization: `Bearer ${accessToken}` };
test.after(() => {
  authServer.closeAllConnections();
  authServer.close();
});

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
    for (const url of ['/api/governance/overview', '/api/demo/services']) {
      const anonymous = await http.inject({ method: 'GET', url });
      assert.equal(anonymous.statusCode, 401, url);
    }
    const forged = await http.inject({
      method: 'GET',
      url: '/api/governance/stats',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(forged.statusCode, 401);
    const overview = await http.inject({
      method: 'GET',
      url: '/api/governance/overview',
      headers: auth,
    });
    assert.equal(overview.statusCode, 200);
    assert.ok(Array.isArray(overview.json().services));
    for (const url of [
      '/api/governance/stats',
      '/api/governance/config',
      '/api/governance/services',
      '/api/governance/drift-events?limit=5',
      '/api/governance/patches?status=CANARY',
      '/api/governance/audits?limit=5',
    ]) {
      const response = await http.inject({ method: 'GET', url, headers: auth });
      assert.equal(response.statusCode, 200, url);
    }
    const config = await http.inject({
      method: 'GET',
      url: '/api/governance/config',
      headers: auth,
    });
    assert.equal(JSON.stringify(config.json()).includes('apiKey'), false);
    const badFilter = await http.inject({
      method: 'GET',
      url: '/api/governance/drift-events?type=NOPE&limit=1000',
      headers: auth,
    });
    assert.equal(badFilter.statusCode, 400);
    const cors = await http.inject({
      method: 'OPTIONS',
      url: '/api/governance/stats',
      headers: {
        origin: 'http://localhost:5100',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    assert.equal(
      cors.headers['access-control-allow-origin'],
      'http://localhost:5100',
    );
    const foreign = await http.inject({
      method: 'GET',
      url: '/api/v1/unregistered/users',
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(foreign.headers['access-control-allow-origin'], undefined);
    const badUuid = await http.inject({
      method: 'POST',
      url: '/api/governance/patches/invalid/promote',
      payload: { serviceName: 'user-service' },
      headers: auth,
    });
    assert.equal(badUuid.statusCode, 400);
    const badBody = await http.inject({
      method: 'POST',
      url: '/api/governance/patches/00000000-0000-4000-8000-000000000001/promote',
      payload: { serviceName: 42, unexpected: true },
      headers: auth,
    });
    assert.equal(badBody.statusCode, 400);
    const missingPatch = await http.inject({
      method: 'POST',
      url: '/api/governance/patches/00000000-0000-4000-8000-000000000001/promote',
      payload: { serviceName: 'user-service' },
      headers: auth,
    });
    assert.equal(missingPatch.statusCode, 404);
    const missingRollback = await http.inject({
      method: 'POST',
      url: '/api/governance/patches/00000000-0000-4000-8000-000000000001/rollback',
      payload: { serviceName: 'user-service' },
      headers: auth,
    });
    assert.equal(missingRollback.statusCode, 404);
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
