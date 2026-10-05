// Contract pinning over the real gateway: baselines learned from traffic, pins stored and
// shown, ignored fields never drift and required fields do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startGateway, suffix } from './helpers/gateway.mjs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let payload = { id: 1, name: 'Ada', email: 'ada@pin.test', internal_id: 'x1' };
const upstream = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
});
await new Promise((done) => upstream.listen(0, '127.0.0.1', done));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
test.after(() => {
  upstream.closeAllConnections();
  upstream.close();
});

test('Contracts: pinning, versioning, field masking', async () => {
  const gateway = await startGateway();
  const { call } = gateway;
  const owner = await gateway.signIn('00000000-0000-4000-8000-0000000000c1', 'pin@pin.test');
  const slug = `pin-${suffix()}`;

  try {
    assert.equal(
      (await call('POST', '/api/orgs', { headers: owner, payload: { name: 'Pinning', slug } }))
        .statusCode,
      201,
    );
    const svc = (
      await call('POST', `/api/orgs/${slug}/services`, {
        headers: owner,
        payload: { serviceName: 'users', baseUrl: upstreamUrl },
      })
    ).json();
    const consumer = (
      await call('POST', `/api/orgs/${slug}/consumers`, {
        headers: owner,
        payload: { name: 'worker', kind: 'backend', serviceIds: [svc.id] },
      })
    ).json();
    const key = (
      await call('POST', `/api/orgs/${slug}/consumers/${consumer.id}/keys`, {
        headers: owner,
        payload: { type: 'secret' },
      })
    ).json().key;
    const fetchUser = () =>
      call('GET', '/api/v1/users/users/1', { headers: { 'x-orchestrator-key': key } });
    const contracts = async () =>
      (await call('GET', `/api/orgs/${slug}/governance/services/users`, { headers: owner }))
        .json().contracts;
    const driftCount = async () =>
      (await call('GET', `/api/orgs/${slug}/governance/drift-events?service=users`, {
        headers: owner,
      })).json().items.length;

    // The first response becomes the baseline contract.
    assert.equal((await fetchUser()).statusCode, 200);
    let contract;
    for (let attempt = 0; attempt < 20 && !contract; attempt++) {
      await sleep(100);
      contract = (await contracts())[0];
    }
    assert.ok(contract, 'baseline contract is learned from traffic');
    assert.equal(contract.pinnedFields, null);
    assert.equal(contract.version, 1);

    const pins = { required: ['id', 'name', 'email'], ignored: ['internal_id'] };
    const pinned = await call(
      'PUT',
      `/api/orgs/${slug}/governance/contracts/${contract.id}/pins`,
      { headers: owner, payload: pins },
    );
    assert.equal(pinned.statusCode, 200, pinned.body);
    assert.deepEqual((await contracts())[0].pinnedFields, pins);
    assert.equal(
      (
        await call('PUT', `/api/orgs/${slug}/governance/contracts/${contract.id}/pins`, {
          headers: owner,
          payload: { required: 'id' },
        })
      ).statusCode,
      400,
    );

    // Changes to ignored or unpinned fields are not drift for this consumer.
    payload = { id: 1, name: 'Ada', email: 'ada@pin.test', internalId: 'x1', extra: true };
    await fetchUser();
    await sleep(300);
    assert.equal(await driftCount(), 0);

    // Losing a required field is.
    payload = { id: 1, full_name: 'Ada', email: 'ada@pin.test' };
    await fetchUser();
    let drifts = 0;
    for (let attempt = 0; attempt < 20 && !drifts; attempt++) {
      await sleep(100);
      drifts = await driftCount();
    }
    assert.equal(drifts, 1, 'renaming a required field is recorded as drift');

    // Clearing the pins stores null again.
    const cleared = await call(
      'PUT',
      `/api/orgs/${slug}/governance/contracts/${contract.id}/pins`,
      { headers: owner, payload: { required: [], ignored: [] } },
    );
    assert.deepEqual(cleared.json(), { pinnedFields: null });
  } finally {
    await gateway.close();
  }
});
