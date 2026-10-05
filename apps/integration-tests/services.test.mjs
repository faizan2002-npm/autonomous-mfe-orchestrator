// Integration tests for service registry, SSRF guard, and health checks
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(databaseUrl, 'TEST_DATABASE_URL required');

const gatewayRoot = resolve(import.meta.dirname, '../api-gateway');
const { createGateway } = await import(pathToFileURL(`${gatewayRoot}/dist/application.js`).href);

test('Services: create, update, test connection, SSRF guard', async () => {
  const setup = postgres(databaseUrl, { onnotice: () => {} });
  await setup.end();

  const app = await createGateway({ logger: false, shutdownHooks: false });
  const http = app.getHttpAdapter().getInstance();
  const call = (method, url, { headers = {}, payload } = {}) => http.inject({ method, url, headers, payload });

  const slug = `svc-${randomBytes(3).toString('hex')}`;
  const token = Buffer.from(JSON.stringify({ sub: 'test-user', email: 'svc@test' })).toString('base64');
  const auth = { authorization: `Bearer ${token}` };

  try {
    // Create org
    await call('POST', '/api/orgs', {
      headers: auth,
      payload: { name: 'Service Test Org', slug },
    });

    // Create service with valid URL
    const service = await call('POST', `/api/orgs/${slug}/services`, {
      headers: auth,
      payload: {
        serviceName: 'valid-service',
        baseUrl: 'http://httpbin.org/api',
        description: 'Test service',
      },
    });
    assert.equal(service.statusCode, 201, `Service creation: ${service.body}`);

    // Reject private IP (SSRF)
    const private = await call('POST', `/api/orgs/${slug}/services`, {
      headers: auth,
      payload: {
        serviceName: 'private-svc',
        baseUrl: 'http://192.168.1.1/api',
      },
    });
    assert.equal(private.statusCode, 400);
    assert.ok(private.body.includes('private'), 'Should reject private IP');

    // Reject localhost when not allowed
    const localhost = await call('POST', `/api/orgs/${slug}/services`, {
      headers: auth,
      payload: {
        serviceName: 'localhost-svc',
        baseUrl: 'http://127.0.0.1:3000/api',
      },
    });
    assert.equal(localhost.statusCode, 400);

    // Reject invalid URL
    const invalid = await call('POST', `/api/orgs/${slug}/services`, {
      headers: auth,
      payload: {
        serviceName: 'bad-svc',
        baseUrl: 'not-a-url',
      },
    });
    assert.equal(invalid.statusCode, 400);

    // Update service
    const s = service.json();
    const updated = await call('PATCH', `/api/orgs/${slug}/services/${s.id}`, {
      headers: auth,
      payload: {
        description: 'Updated description',
        timeoutMs: 15000,
      },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().description, 'Updated description');

    // Test connection (may fail if httpbin is down, but shouldn't crash)
    const test = await call('POST', `/api/orgs/${slug}/services/${s.id}/test`, { headers: auth });
    assert.equal(test.statusCode, 200);
    const result = test.json();
    assert.ok('ok' in result);

    console.log('✓ Services: create, update, SSRF guard, connection test');
  } finally {
    await app.close();
  }
});
