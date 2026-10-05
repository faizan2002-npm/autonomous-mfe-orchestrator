// Shared harness for gateway integration tests: migrated disposable Postgres, Redis, a local
// JWKS standing in for Supabase Auth, and the compiled gateway. Each test file runs in its own
// process, so setting process.env here is safe.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import postgres from 'postgres';

export const databaseUrl = process.env.TEST_DATABASE_URL;
export const redisUrl = process.env.TEST_REDIS_URL;
assert.ok(
  databaseUrl && redisUrl,
  'Use disposable TEST_DATABASE_URL and TEST_REDIS_URL services',
);

export const gatewayRoot = resolve(import.meta.dirname, '../../api-gateway');

/** Imports a compiled gateway module, e.g. `dist('common/redis-lock.js')`. */
export const dist = (path) =>
  import(pathToFileURL(`${gatewayRoot}/dist/${path}`).href);

export const suffix = () => randomBytes(3).toString('hex');

/** Applies migrations; an advisory lock serializes test files that run concurrently. */
export async function migrateDatabase() {
  // One connection, so the session lock and the migration share it.
  const setup = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await setup`select pg_advisory_lock(727274)`;
    await migrate(drizzle(setup), {
      migrationsFolder: resolve(gatewayRoot, '../../packages/database/migrations'),
    });
  } finally {
    await setup.end();
  }
}

/**
 * Starts the gateway against the test services. `env` overrides the defaults (for example
 * ALLOW_PRIVATE_UPSTREAMS). Returns an in-process HTTP caller and a sign-in helper.
 */
export async function startGateway(env = {}) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwks = {
    keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' }],
  };
  const authServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(jwks));
  });
  await new Promise((done) => authServer.listen(0, '127.0.0.1', done));
  const supabaseUrl = `http://127.0.0.1:${authServer.address().port}`;

  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    SUPABASE_URL: supabaseUrl,
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    KEY_PEPPER: randomBytes(32).toString('base64'),
    ALLOW_PRIVATE_UPSTREAMS: 'true',
    APP_URL: 'http://dashboard.test',
    GEMINI_API_KEY: '',
    ...env,
  });

  let app;
  try {
    await migrateDatabase();
    const { createGateway } = await dist('application.js');
    app = await createGateway({ logger: false, shutdownHooks: false });
  } catch (error) {
    // An open auth server would keep the test process alive.
    authServer.close();
    throw error;
  }
  const http = app.getHttpAdapter().getInstance();

  const signIn = async (id, email) => {
    const token = await new SignJWT({ email })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject(id)
      .setIssuer(`${supabaseUrl}/auth/v1`)
      .setAudience('authenticated')
      .setExpirationTime('10m')
      .sign(privateKey);
    return { authorization: `Bearer ${token}` };
  };

  return {
    app,
    signIn,
    call: (method, url, { headers = {}, payload } = {}) =>
      http.inject({ method, url, headers, payload }),
    async close() {
      await app.close();
      authServer.closeAllConnections();
      authServer.close();
    },
  };
}
