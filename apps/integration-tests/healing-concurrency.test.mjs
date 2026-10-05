import { test } from 'node:test';
import assert from 'node:assert';
import { createGateway } from '../api-gateway/src/application.js';
import { query } from './helpers/db.mjs';

// Test that distributed healing lock works correctly with 2 concurrent instances.
// Verifies: only 1 patch generated when 2 instances race on same contract drift.

const PORT_1 = 4001;
const PORT_2 = 4002;

test.describe('Healing Service Concurrency', async () => {
  let app1, app2;
  let orgId, contractId;

  test.before(async () => {
    // Start 2 gateway instances
    process.env.GATEWAY_PORT = PORT_1;
    app1 = await createGateway();
    await app1.listen(PORT_1);

    process.env.GATEWAY_PORT = PORT_2;
    app2 = await createGateway();
    await app2.listen(PORT_2);

    // Create test org and contract
    const orgRes = await query(`
      INSERT INTO orgs (name, slug, tier)
      VALUES ('Test Org', 'test-' || random(), 'pro')
      RETURNING id
    `);
    orgId = orgRes[0].id;

    const contractRes = await query(`
      INSERT INTO contracts (org_id, consumer, service, method, path, status)
      VALUES ($1, 'app', 'api', 'GET', '/users', 'drifted')
      RETURNING id
    `, [orgId]);
    contractId = contractRes[0].id;
  });

  test.after(async () => {
    await app1.close();
    await app2.close();
  });

  test('should generate only 1 patch when 2 instances race on same contract', async () => {
    // Trigger healing on both instances simultaneously
    const promise1 = fetch(`http://localhost:${PORT_1}/api/v1/healing/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contractId }),
    }).then((r) => r.json());

    const promise2 = fetch(`http://localhost:${PORT_2}/api/v1/healing/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contractId }),
    }).then((r) => r.json());

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // One should succeed (acquire lock), one should return without generating patch
    const successCount = [result1, result2].filter((r) => r.patchId).length;
    assert.equal(
      successCount,
      1,
      `Expected exactly 1 patch generated, got ${successCount}`,
    );

    // Verify database: only 1 patch row for this contract
    const patchesRes = await query(`
      SELECT id FROM patches WHERE contract_id = $1
    `, [contractId]);

    assert.equal(
      patchesRes.length,
      1,
      `Expected 1 patch in database, found ${patchesRes.length}`,
    );

    // Check Redis lock was released
    const lockKey = `healing:${contractId}`;
    const lock = await app1.get('RedisService').client.get(lockKey);
    assert.equal(lock, null, 'Lock should be released after healing completes');
  });

  test('should allow both instances to read same patch', async () => {
    // Get patch from instance 1
    const patchRes1 = await fetch(
      `http://localhost:${PORT_1}/api/v1/patches?contract=${contractId}`,
    ).then((r) => r.json());

    // Get patch from instance 2
    const patchRes2 = await fetch(
      `http://localhost:${PORT_2}/api/v1/patches?contract=${contractId}`,
    ).then((r) => r.json());

    assert.equal(
      patchRes1.data[0].id,
      patchRes2.data[0].id,
      'Both instances should see the same patch',
    );
  });
});
