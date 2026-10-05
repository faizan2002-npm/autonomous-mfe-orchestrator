// Role-based access control over the real gateway: non-members, viewer limits, cross-org isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGateway, suffix } from './helpers/gateway.mjs';

test('RBAC: roles, permissions, cross-org isolation', async () => {
  const gateway = await startGateway();
  const { call } = gateway;
  const owner = await gateway.signIn('00000000-0000-4000-8000-0000000000a1', 'owner@rbac.test');
  const viewer = await gateway.signIn('00000000-0000-4000-8000-0000000000a2', 'viewer@rbac.test');
  const slug1 = `rbac-${suffix()}`;
  const slug2 = `rbac-${suffix()}`;

  try {
    for (const slug of [slug1, slug2]) {
      const org = await call('POST', '/api/orgs', {
        headers: owner,
        payload: { name: `Org ${slug}`, slug },
      });
      assert.equal(org.statusCode, 201, org.body);
    }
    const svc = (
      await call('POST', `/api/orgs/${slug1}/services`, {
        headers: owner,
        payload: { serviceName: 'api', baseUrl: 'http://127.0.0.1:9' },
      })
    ).json();

    // Non-members can't tell the org exists.
    assert.equal(
      (await call('GET', `/api/orgs/${slug1}/services`, { headers: viewer })).statusCode,
      404,
    );
    assert.equal(
      (
        await call('POST', `/api/orgs/${slug1}/services`, {
          headers: viewer,
          payload: { serviceName: 'api2', baseUrl: 'http://127.0.0.1:9' },
        })
      ).statusCode,
      404,
    );

    // Join org1 as a viewer.
    const invite = await call('POST', `/api/orgs/${slug1}/invitations`, {
      headers: owner,
      payload: { email: 'viewer@rbac.test', role: 'viewer' },
    });
    assert.equal(invite.statusCode, 201, invite.body);
    const token = invite.json().acceptUrl.split('/invite/')[1];
    const accepted = await call('POST', `/api/invitations/${token}/accept`, { headers: viewer });
    assert.ok(accepted.statusCode < 300, accepted.body);

    // Viewers can read but not change.
    const listed = await call('GET', `/api/orgs/${slug1}/services`, { headers: viewer });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().map((s) => s.serviceName), ['api']);
    const patch = await call('PATCH', `/api/orgs/${slug1}/services/${svc.id}`, {
      headers: viewer,
      payload: { description: 'hacked' },
    });
    assert.equal(patch.statusCode, 403);
    assert.equal(
      (await call('POST', `/api/orgs/${slug1}/services/${svc.id}/test`, { headers: viewer }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await call('POST', `/api/orgs/${slug1}/invitations`, {
          headers: viewer,
          payload: { email: 'friend@rbac.test', role: 'owner' },
        })
      ).statusCode,
      403,
    );

    // Membership of org1 grants nothing in org2, and org2 can't reach org1's service.
    assert.equal(
      (await call('GET', `/api/orgs/${slug2}/services`, { headers: viewer })).statusCode,
      404,
    );
    assert.equal(
      (
        await call('PATCH', `/api/orgs/${slug2}/services/${svc.id}`, {
          headers: owner,
          payload: { description: 'cross-org' },
        })
      ).statusCode,
      404,
    );
  } finally {
    await gateway.close();
  }
});
