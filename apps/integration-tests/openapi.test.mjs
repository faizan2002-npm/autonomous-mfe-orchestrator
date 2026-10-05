// OpenAPI import: specs (JSON, YAML or URL) become contract baselines, so even a consumer's
// first response is checked; learned contracts can be compared with and moved onto the spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
assert.ok(databaseUrl && redisUrl, 'Use disposable TEST_DATABASE_URL and TEST_REDIS_URL services');

const listen = async (server) => {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${server.address().port}`;
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' }] };
const authServer = createServer((_req, res) => res.end(JSON.stringify(jwks)));
const supabaseUrl = await listen(authServer);
const signIn = async (id, email) => ({
  authorization: `Bearer ${await new SignJWT({ email })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setSubject(id)
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setAudience('authenticated')
    .setExpirationTime('10m')
    .sign(privateKey)}`,
});
const owner = await signIn('00000000-0000-4000-8000-0000000000d1', 'owner@openapi.test');

// The upstream already serves the renamed field the spec does not declare.
const yamlSpec = `
openapi: 3.0.3
info: { title: Users API, version: 2.0.0 }
servers: [{ url: /api/v1 }]
paths:
  /users/{id}:
    get:
      operationId: getUser
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/User' }
  /users:
    delete:
      responses: { '204': { description: gone } }
components:
  schemas:
    User:
      type: object
      properties:
        id: { type: integer }
        firstName: { type: string }
`;
let body = { id: 1, first_name: 'Ada' };
const upstream = createServer((req, res) => {
  if (req.url === '/openapi.yaml') {
    res.writeHead(200, { 'content-type': 'application/yaml' });
    return res.end(yamlSpec);
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(req.url.startsWith('/api/v1/orders') ? { id: 9, total: 3 } : body));
});
const upstreamUrl = await listen(upstream);

Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  SUPABASE_URL: supabaseUrl,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  KEY_PEPPER: randomBytes(32).toString('base64'),
  ALLOW_PRIVATE_UPSTREAMS: 'true',
  EMAIL_PROVIDER: 'log',
  GEMINI_API_KEY: '',
});

const gatewayRoot = resolve(import.meta.dirname, '../api-gateway');
const { createGateway } = await import(pathToFileURL(`${gatewayRoot}/dist/application.js`).href);

test.after(() => {
  for (const server of [authServer, upstream]) {
    server.closeAllConnections();
    server.close();
  }
});

test('OpenAPI import: spec baselines, first-response drift, comparison and adoption', async () => {
  const setup = postgres(databaseUrl, { onnotice: () => {} });
  await migrate(drizzle(setup), { migrationsFolder: resolve(gatewayRoot, '../../packages/database/migrations') });
  await setup.end();

  const app = await createGateway({ logger: false, shutdownHooks: false });
  const http = app.getHttpAdapter().getInstance();
  const call = (method, url, { headers = {}, payload } = {}) => http.inject({ method, url, headers, payload });
  const slug = `openapi-${randomBytes(3).toString('hex')}`;
  const org = `/api/orgs/${slug}`;

  try {
    await call('POST', '/api/orgs', { headers: owner, payload: { name: 'Spec Co', slug } });
    const service = (await call('POST', `${org}/services`, { headers: owner, payload: { serviceName: 'users', baseUrl: upstreamUrl } })).json();
    const spec = `${org}/services/${service.id}/openapi`;
    const keyFor = async (name) => {
      const consumer = (await call('POST', `${org}/consumers`, { headers: owner, payload: { name, kind: 'backend', serviceIds: [service.id] } })).json();
      const { key } = (await call('POST', `${org}/consumers/${consumer.id}/keys`, { headers: owner, payload: { type: 'secret' } })).json();
      return { 'x-orchestrator-key': key, 'x-mfe-canary': 'true' };
    };
    const early = await keyFor('early');

    // Before any spec: the first response is learned as the baseline (it already has first_name).
    await call('GET', '/api/v1/users/users/1', { headers: early });

    // Bad input is rejected clearly.
    for (const payload of [{ document: 'not: [valid' }, { document: { hello: 'world' } }, { url: 'ftp://example.com/spec' }, {}]) {
      const response = await call('PUT', spec, { headers: owner, payload });
      assert.equal(response.statusCode, 400, `${JSON.stringify(payload)} → ${response.body}`);
    }

    // Import from a URL (YAML), through the SSRF-guarded fetcher.
    const imported = await call('PUT', spec, { headers: owner, payload: { url: `${upstreamUrl}/openapi.yaml` } });
    assert.equal(imported.statusCode, 200, imported.body);
    const state = imported.json();
    assert.equal(state.import.title, 'Users API');
    assert.equal(state.import.operations, 1);
    assert.deepEqual(state.import.skipped, ['DELETE /api/v1/users']);
    assert.deepEqual(state.operations.map((o) => [o.httpMethod, o.pathTemplate, o.schemaTokens]), [
      ['GET', '/api/v1/users/{id}', ['firstName:string', 'id:number']],
    ]);
    assert.equal((await call('GET', `${org}/services`, { headers: owner })).json()[0].openapi.version, '2.0.0');

    // The learned contract is compared with the spec.
    const [comparison] = state.comparisons;
    assert.equal(comparison.consumerName, 'early');
    assert.equal(comparison.source, 'traffic');
    assert.deepEqual(comparison.missingFromContract, ['firstName:string']);
    assert.deepEqual(comparison.notInSpec, ['first_name:string']);

    // A new consumer starts from the spec: its very first response is already drift.
    const late = await keyFor('late');
    await call('GET', '/api/v1/users/users/1', { headers: late });
    let drift = [];
    for (let attempt = 0; attempt < 30 && !drift.length; attempt++) {
      await sleep(100);
      drift = (await call('GET', `${org}/governance/drift-events`, { headers: owner })).json().items;
    }
    assert.deepEqual(drift.map((d) => [d.contract.consumerName, d.driftType]), [['late', 'FIELD_RENAMED']]);
    const contracts = (await call('GET', `${org}/governance/services/users`, { headers: owner })).json().contracts;
    assert.equal(contracts.find((c) => c.consumerName === 'late').source, 'openapi');

    // Endpoints the spec doesn't cover are still learned from traffic.
    await call('GET', '/api/v1/orders/9', { headers: late });

    // Adopting the spec for the early consumer re-baselines it as a new contract version.
    const adopted = await call('POST', `${spec}/adopt`, { headers: owner, payload: { contractId: comparison.contractId } });
    assert.equal(adopted.statusCode, 200, adopted.body);
    const after = adopted.json().comparisons.find((c) => c.consumerName === 'early');
    assert.equal(after.source, 'openapi');
    assert.deepEqual([after.missingFromContract, after.notInSpec], [[], []]);
    assert.notEqual(after.contractId, comparison.contractId);
    assert.equal((await call('POST', `${spec}/adopt`, { headers: owner, payload: { contractId: comparison.contractId } })).statusCode, 404);

    // Re-import from an inline JSON document with requiredOnly; then remove.
    const json = await call('PUT', spec, {
      headers: owner,
      payload: {
        requiredOnly: true,
        document: JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Users API', version: '3.0.0' },
          paths: {
            '/api/v1/users/{id}': {
              get: {
                responses: {
                  200: {
                    content: {
                      'application/json': {
                        schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, nick: { type: ['string', 'null'] } } },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      },
    });
    assert.equal(json.statusCode, 200, json.body);
    assert.deepEqual(json.json().operations[0].schemaTokens, ['id:number']);
    assert.equal((await call('DELETE', spec, { headers: owner })).statusCode, 204);
    const cleared = (await call('GET', spec, { headers: owner })).json();
    assert.deepEqual([cleared.import, cleared.operations, cleared.comparisons], [null, [], []]);
  } finally {
    await app.close();
  }
});
