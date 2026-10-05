import test from 'node:test';
import assert from 'node:assert/strict';
import type { OrgSettingsService } from '../orgs/org-settings.service.js';
import { InferenceService } from './inference.service.js';
import type { PatchGenerationTask } from './patch-generation.js';

test('without a Gemini key for the org the deterministic fallback is used and no request is made', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    throw new Error('unexpected network call');
  }) as typeof fetch;
  try {
    const settings = {
      effective: async () => ({
        driftThreshold: 0.15,
        canaryPercent: 10,
        gemini: { model: 'gemini-test' },
      }),
    } as unknown as OrgSettingsService;
    const service = new InferenceService(settings);
    const task: PatchGenerationTask = {
      driftEventId: 'event',
      contractId: 'contract',
      orgId: 'org',
      consumerId: 'consumer',
      consumerName: 'web',
      serviceName: 'user-service',
      httpMethod: 'GET',
      endpointPath: '/api/v1/users/:id',
      expectedSchema: ['firstName:string'],
      diffDetails: {
        missingFields: ['firstName'],
        addedFields: ['first_name'],
        typeMismatches: [],
      },
      samplePayload: { first_name: 'Ada' },
    };
    const result = await service.generate(task);
    assert.match(result.reasoningTrace, /Fallback/);
    assert.match(result.adapterCode, /firstName/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
