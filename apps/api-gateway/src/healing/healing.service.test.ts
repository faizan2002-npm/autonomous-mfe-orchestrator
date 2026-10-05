import test from 'node:test';
import assert from 'node:assert/strict';
import type { Redis } from 'ioredis';
import { HealingService } from './healing.service.js';
import type { CognitiveService } from '../cognitive/cognitive.service.js';
import type { PatchGenerationTask } from '../cognitive/patch-generation.js';
import type { CanaryService } from '../canary/canary.service.js';

const task = {
  contractId: 'contract',
  orgId: 'org',
  consumerId: 'consumer',
  consumerName: 'web',
  serviceName: 'users',
  httpMethod: 'GET',
  endpointPath: '/api/v1/users/:id',
} as PatchGenerationTask;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('healing uses Redis lock to prevent duplicate healing across instances', async () => {
  let calls = 0;
  let release!: (value: { patchId: string; adapterCode: string }) => void;
  const result = new Promise<{ patchId: string; adapterCode: string }>(
    (resolve) => {
      release = resolve;
    },
  );
  const deployments: unknown[] = [];

  // Mock Redis with a simple in-memory lock
  let lockHeld = false;
  const mockRedis = {
    set: async () => {
      if (lockHeld) return undefined; // Simulate lock already held
      lockHeld = true;
      return 'OK';
    },
    eval: async () => {
      lockHeld = false;
      return 1;
    },
  } as any;

  const service = new HealingService(
    mockRedis as Redis,
    {
      generateAndValidatePatch: async () => {
        calls++;
        return result;
      },
    } as unknown as CognitiveService,
    {
      deployPatch: async (patch: unknown) => {
        deployments.push(patch);
      },
    } as unknown as CanaryService,
  );

  service.schedule(task);
  service.schedule(task); // Second call should not acquire lock
  await tick();
  assert.equal(calls, 1); // Only one should have run (the one that got the lock)
  release({ patchId: 'persisted-patch', adapterCode: '(data) => data' });
  await tick();
  assert.deepEqual(deployments, [
    {
      patchId: 'persisted-patch',
      contractId: 'contract',
      contract: {
        orgId: 'org',
        consumerId: 'consumer',
        consumerName: 'web',
        serviceName: 'users',
        httpMethod: 'GET',
        endpointPath: '/api/v1/users/:id',
      },
      adapterCode: '(data) => data',
    },
  ]);
});
