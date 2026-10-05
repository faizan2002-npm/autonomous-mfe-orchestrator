// Service registry over the real gateway: create, validation, SSRF guard, update and delete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGateway, suffix } from './helpers/gateway.mjs';

test('Services: create, update, SSRF guard, delete', async () => {
  // Private upstreams are refused unless explicitly allowed.
  const gateway = await startGateway({ ALLOW_PRIVATE_UPSTREAMS: 'false' });
  const { call } = gateway;
  const owner = await gateway.signIn('00000000-0000-4000-8000-0000000005e1', 'svc@test.dev');
  const slug = `svc-${suffix()}`;

  try {
    const org = await call('POST', '/api/orgs', {
      headers: owner,
      payload: { name: 'Service Test Org', slug },
    });
    assert.equal(org.statusCode, 201, org.body);

    // A public IP literal needs no DNS lookup.
    const created = await call('POST', `/api/orgs/${slug}/services`, {
      headers: owner,
      payload: {
        serviceName: 'valid-service',
        baseUrl: 'http://93.184.215.14/api',
        description: 'Test service',
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const service = created.json();

    const privateIp = await call('POST', `/api/orgs/${slug}/services`, {
      headers: owner,
      payload: { serviceName: 'private-svc', baseUrl: 'http://192.168.1.1/api' },
    });
    assert.equal(privateIp.statusCode, 400);
    assert.match(privateIp.json().message, /private or reserved/);

    const loopback = await call('POST', `/api/orgs/${slug}/services`, {
      headers: owner,
      payload: { serviceName: 'localhost-svc', baseUrl: 'http://127.0.0.1:3000/api' },
    });
    assert.equal(loopback.statusCode, 400);

    const invalid = await call('POST', `/api/orgs/${slug}/services`, {
      headers: owner,
      payload: { serviceName: 'bad-svc', baseUrl: 'not-a-url' },
    });
    assert.equal(invalid.statusCode, 400);

    const badName = await call('POST', `/api/orgs/${slug}/services`, {
      headers: owner,
      payload: { serviceName: 'Bad Name', baseUrl: 'http://93.184.215.14' },
    });
    assert.equal(badName.statusCode, 400);

    const updated = await call('PATCH', `/api/orgs/${slug}/services/${service.id}`, {
      headers: owner,
      payload: { description: 'Updated description', timeoutMs: 15000 },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().description, 'Updated description');
    assert.equal(updated.json().timeoutMs, 15000);

    const listed = await call('GET', `/api/orgs/${slug}/services`, { headers: owner });
    assert.deepEqual(listed.json().map((s) => s.serviceName), ['valid-service']);

    const removed = await call('DELETE', `/api/orgs/${slug}/services/${service.id}`, {
      headers: owner,
    });
    assert.equal(removed.statusCode, 204, removed.body);
    assert.deepEqual(
      (await call('GET', `/api/orgs/${slug}/services`, { headers: owner })).json(),
      [],
    );
  } finally {
    await gateway.close();
  }
});
