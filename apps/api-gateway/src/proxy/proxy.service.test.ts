import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProxyService } from './proxy.service.js';
import type { ObservationService } from '../observation/observation.service.js';
import type { CanaryService } from '../canary/canary.service.js';

test('proxy observes successful JSON only and forwards body/query through the service', async () => {
  const previous = process.env.USER_SERVICE_URL;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.writeHead(req.url?.includes('failure') ? 500 : 200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({ url: req.url, body }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let observations = 0;
  let patches = 0;
  const service = new ProxyService(
    {
      observe: async () => {
        observations++;
      },
    } as unknown as ObservationService,
    {
      applyPatchIfActive: (_service: string, payload: unknown) => {
        patches++;
        return { payload, isPatched: false };
      },
    } as unknown as CanaryService,
  );
  try {
    const success = await service.forward({
      service: 'user-service',
      subPath: 'users',
      method: 'POST',
      query: '?page=2',
      body: { name: 'Ada' },
      isCanary: false,
    });
    assert.deepEqual(success.payload, {
      url: '/api/v1/users?page=2',
      body: '{"name":"Ada"}',
    });
    assert.equal(observations, 1);
    assert.equal(patches, 1);
    const failed = await service.forward({
      service: 'user-service',
      subPath: 'failure',
      method: 'GET',
      query: '',
      body: undefined,
      isCanary: false,
    });
    assert.equal(failed.status, 500);
    assert.equal(observations, 1);
    assert.equal(patches, 1);
    await assert.rejects(
      service.forward({
        service: 'unknown',
        subPath: '',
        method: 'GET',
        query: '',
        body: undefined,
        isCanary: false,
      }),
      /not registered/,
    );
  } finally {
    if (previous === undefined) delete process.env.USER_SERVICE_URL;
    else process.env.USER_SERVICE_URL = previous;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
