// Distributed healing lock: two gateway instances racing on the same drift generate one patch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { dist, redisUrl, suffix } from './helpers/gateway.mjs';

const { HealingService } = await dist('healing/healing.service.js');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let redis1;
let redis2;
before(() => {
  redis1 = new Redis(redisUrl);
  redis2 = new Redis(redisUrl);
});
after(async () => {
  await redis1.quit();
  await redis2.quit();
});

/** A gateway instance's HealingService with a slow, counting patch generator. */
function instance(redis, generated, deployed) {
  const cognitive = {
    async generateAndValidatePatch(task) {
      generated.push(task.contractId);
      await sleep(200);
      return { patchId: `patch-${generated.length}`, adapterCode: 'return payload;' };
    },
  };
  const canary = {
    async deployPatch(patch) {
      deployed.push(patch.patchId);
    },
  };
  return new HealingService(redis, cognitive, canary);
}

const task = (contractId) => ({
  driftEventId: 'drift-1',
  contractId,
  orgId: 'org-1',
  consumerId: 'consumer-1',
  consumerName: 'web',
  serviceName: 'users',
  httpMethod: 'GET',
  endpointPath: '/api/v1/users',
  expectedSchema: ['id:number'],
  diffDetails: {},
  samplePayload: { id: 1 },
});

test('only one instance heals a contract when both race on the same drift', async () => {
  const generated = [];
  const deployed = [];
  const first = instance(redis1, generated, deployed);
  const second = instance(redis2, generated, deployed);
  const contractId = `contract-${suffix()}`;

  first.schedule(task(contractId));
  second.schedule(task(contractId));
  // Waits for the scheduled work, as on shutdown.
  await Promise.all([first.onModuleDestroy(), second.onModuleDestroy()]);

  assert.deepEqual(generated, [contractId]);
  assert.equal(deployed.length, 1);
  assert.equal(await redis1.get(`healing:${contractId}`), null, 'lock is released');
});

test('a contract can be healed again once the previous run finished', async () => {
  const generated = [];
  const deployed = [];
  const contractId = `contract-${suffix()}`;
  for (const redis of [redis1, redis2]) {
    const healing = instance(redis, generated, deployed);
    healing.schedule(task(contractId));
    await healing.onModuleDestroy();
  }
  assert.equal(generated.length, 2);
  assert.equal(deployed.length, 2);
});

test('different contracts heal in parallel', async () => {
  const generated = [];
  const deployed = [];
  const healing = instance(redis1, generated, deployed);
  healing.schedule(task(`contract-${suffix()}`));
  healing.schedule(task(`contract-${suffix()}`));
  await healing.onModuleDestroy();
  assert.equal(generated.length, 2);
  assert.equal(deployed.length, 2);
});
