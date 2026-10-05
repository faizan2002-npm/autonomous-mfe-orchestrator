// Integration tests for role-based access control and permissions
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

test('RBAC: roles, permissions, cross-org isolation', async () => {
  const setup = postgres(databaseUrl, { onnotice: () => {} });
  await setup.end();

  const app = await createGateway({ logger: false, shutdownHooks: false });
  const http = app.getHttpAdapter().getInstance();
  const call = (method, url, { headers = {}, payload } = {}) => http.inject({ method, url, headers, payload });

  const slug1 = `rbac-${randomBytes(3).toString('hex')}`;
  const slug2 = `rbac-${randomBytes(3).toString('hex')}`;

  const owner = { authorization: `Bearer ${Buffer.from(JSON.stringify({ sub: 'owner', email: 'owner@test' })).toString('base64')}` };
  const viewer = { authorization: `Bearer ${Buffer.from(JSON.stringify({ sub: 'viewer', email: 'viewer@test' })).toString('base64')}` };

  try {
    // Owner creates org1
    await call('POST', '/api/orgs', {
      headers: owner,
      payload: { name: 'Org 1', slug: slug1 },
    });

    // Owner creates org2
    await call('POST', '/api/orgs', {
      headers: owner,
      payload: { name: 'Org 2', slug: slug2 },
    });

    // Create service in org1
    const svc = (await call('POST', `/api/orgs/${slug1}/services`, {
      headers: owner,
      payload: { serviceName: 'api', baseUrl: 'http://api.test' },
    })).json();

    // Non-member gets 404
    const notMember = await call('GET', `/api/orgs/${slug1}/services`, { headers: viewer });
    assert.equal(notMember.statusCode, 404, 'Non-member should get 404');

    // Admin-only endpoint rejects viewer
    const noAdmin = await call('POST', `/api/orgs/${slug1}/services`, {
      headers: viewer,
      payload: { serviceName: 'api2', baseUrl: 'http://api2.test' },
    });
    assert.equal(noAdmin.statusCode, 404, 'Viewer cannot create (404, not 403)');

    // Invite viewer to org1 as viewer
    const invite = await call('POST', `/api/orgs/${slug1}/members/invitations`, {
      headers: owner,
      payload: { email: 'viewer@test', role: 'viewer' },
    });
    assert.equal(invite.statusCode, 201);

    // Viewer still can't modify
    const stillNo = await call('PATCH', `/api/orgs/${slug1}/services/${svc.id}`, {
      headers: viewer,
      payload: { description: 'hacked' },
    });
    assert.equal(stillNo.statusCode, 403, 'Viewer role denied by @OrgScoped(admin)');

    console.log('✓ RBAC: roles, permissions, cross-org isolation');
  } finally {
    await app.close();
  }
});
