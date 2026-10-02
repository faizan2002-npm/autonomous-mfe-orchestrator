import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGatewayConfig } from '../config/gateway-config.js';
import { InferenceService } from './inference.service.js';
import type { PatchGenerationTask } from './patch-generation.js';

test('without a Gemini key the deterministic fallback is used and no request is made', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    throw new Error('unexpected network call');
  }) as typeof fetch;
  try {
    const service = new InferenceService(
      loadGatewayConfig({
        DATABASE_URL: 'postgresql://localhost/unused',
        REDIS_URL: 'redis://localhost/unused',
      }),
    );
    const task: PatchGenerationTask = {
      driftEventId: 'event',
      contractId: 'contract',
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
