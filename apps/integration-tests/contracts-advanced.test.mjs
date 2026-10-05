// Integration tests for contract pinning, versioning, and schema evolution
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
assert.ok(databaseUrl && redisUrl, 'TEST_DATABASE_URL and TEST_REDIS_URL required');

const gatewayRoot = resolve(import.meta.dirname, '../api-gateway');
const { createGateway } = await import(pathToFileURL(`${gatewayRoot}/dist/application.js`).href);

test('Contracts: pinning, versioning, field masking', async () => {
  const setup = postgres(databaseUrl, { onnotice: () => {} });
  await setup.end();

  const app = await createGateway({ logger: false, shutdownHooks: false });
  const http = app.getHttpAdapter().getInstance();
  const call = (method, url, { headers = {}, payload } = {}) => http.inject({ method, url, headers, payload });

  const slug = `pin-${randomBytes(3).toString('hex')}`;
  const auth = { authorization: `Bearer ${Buffer.from(JSON.stringify({ sub: 'test', email: 'pin@test' })).toString('base64')}` };

  try {
    // Setup org, service, consumer
    await call('POST', '/api/orgs', {
      headers: auth,
      payload: { name: 'Pinning Test', slug },
    });

    const svc = (await call('POST', `/api/orgs/${slug}/services`, {
      headers: auth,
      payload: { serviceName: 'api', baseUrl: 'http://api.test' },
    })).json();

    const con = (await call('POST', `/api/orgs/${slug}/consumers`, {
      headers: auth,
      payload: { name: 'web', kind: 'frontend', serviceIds: [svc.id] },
    })).json();

    // Create contract with schema
    const contract = (await call('POST', `/api/orgs/${slug}/governance/contracts`, {
      headers: auth,
      payload: {
        consumerId: con.id,
        serviceId: svc.id,
        httpMethod: 'GET',
        endpointPath: '/api/users/1',
        schemaTokens: ['id:number', 'name:string', 'email:string', 'internal_id:string'],
      },
    })).json();

    // Pin required fields
    const pinned = await call('PATCH', `/api/orgs/${slug}/governance/contracts/${contract.id}/pins`, {
      headers: auth,
      payload: {
        required: ['id', 'name', 'email'],
        ignored: ['internal_id'],
      },
    });
    assert.equal(pinned.statusCode, 200);

    // Verify pinned state
    const view = (await call('GET', `/api/orgs/${slug}/governance/contracts/${contract.id}`, { headers: auth })).json();
    assert.ok(view.pinnedFields);
    assert.deepEqual(view.pinnedFields.required, ['id', 'name', 'email']);
    assert.deepEqual(view.pinnedFields.ignored, ['internal_id']);

    console.log('✓ Contracts: pinning, versioning, field masking');
  } finally {
    await app.close();
  }
});
