import test from 'node:test';
import assert from 'node:assert/strict';
import { HealingService } from './healing.service.js';
import type { CognitiveService } from '../cognitive/cognitive.service.js';
import type { PatchGenerationTask } from '../cognitive/patch-generation.js';
import type { CanaryService } from '../canary/canary.service.js';

const task = {
  contractId: 'contract',
  serviceName: 'users',
  httpMethod: 'GET',
  endpointPath: '/api/v1/users/:id',
} as PatchGenerationTask;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('healing coalesces pending work and deploys the returned patch ID', async () => {
  let calls = 0;
  let release!: (value: { patchId: string; adapterCode: string }) => void;
  const result = new Promise<{ patchId: string; adapterCode: string }>(
    (resolve) => {
      release = resolve;
    },
  );
  const deployments: unknown[] = [];
  const service = new HealingService(
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
  service.schedule(task);
  await tick();
  assert.equal(calls, 1);
  release({ patchId: 'persisted-patch', adapterCode: '(data) => data' });
  await tick();
  assert.deepEqual(deployments, [
    {
      patchId: 'persisted-patch',
      contractId: 'contract',
      contract: {
        serviceName: 'users',
        httpMethod: 'GET',
        endpointPath: '/api/v1/users/:id',
      },
      adapterCode: '(data) => data',
    },
  ]);
  service.schedule(task);
  await tick();
  assert.equal(calls, 2);
});
