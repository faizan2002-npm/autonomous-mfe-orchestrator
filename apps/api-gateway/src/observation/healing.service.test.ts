import test from 'node:test';
import assert from 'node:assert/strict';
import { HealingService } from './healing.service.js';
import {
  CognitiveService,
  type PatchGenerationTask,
} from '../cognitive/cognitive.service.js';
import { CanaryService } from '../canary/canary.service.js';

const task = {
  contractId: 'contract',
  serviceName: 'users',
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
  const deployments: unknown[][] = [];
  const service = new HealingService(
    {
      generateAndValidatePatch: async () => {
        calls++;
        return result;
      },
    } as unknown as CognitiveService,
    {
      deployPatch: async (...args: unknown[]) => {
        deployments.push(args);
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
    ['users', 'persisted-patch', '(data) => data'],
  ]);
  service.schedule(task);
  await tick();
  assert.equal(calls, 2);
});
