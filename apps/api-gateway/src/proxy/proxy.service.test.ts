import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadGatewayConfig } from '../config/gateway-config.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { ProxyService } from './proxy.service.js';
import type { ObservationService } from '../observation/observation.service.js';
import type { CanaryService } from '../canary/canary.service.js';

test('proxy observes successful JSON only and forwards body/query through the service', async () => {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.writeHead(req.url?.includes('failure') ? 500 : 200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({ url: req.url, body }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const config = loadGatewayConfig({
    DATABASE_URL: 'postgresql://localhost/unused',
    REDIS_URL: 'redis://localhost/unused',
    USER_SERVICE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  });
  const observed: unknown[] = [];
  let patches = 0;
  const service = new ProxyService(
    {
      observe: async (observation: unknown) => {
        observed.push(observation);
      },
    } as unknown as ObservationService,
    {
      applyPatch: (_contract: unknown, payload: unknown) => {
        patches++;
        return { payload, isPatched: false };
      },
    } as unknown as CanaryService,
    config,
    new GatewayEventsService(),
  );
  try {
    const success = await service.forward({
      service: 'user-service',
      subPath: 'users',
      method: 'POST',
      query: '?page=2',
      body: { name: 'Ada' },
    });
    assert.deepEqual(success.payload, {
      url: '/api/v1/users?page=2',
      body: '{"name":"Ada"}',
    });
    assert.deepEqual(observed, [
      {
        serviceName: 'user-service',
        httpMethod: 'POST',
        endpointPath: '/api/v1/users',
        observedPayload: success.payload,
      },
    ]);
    assert.equal(patches, 1);
    const failed = await service.forward({
      service: 'user-service',
      subPath: 'failure',
      method: 'GET',
      query: '',
      body: undefined,
    });
    assert.equal(failed.status, 500);
    assert.equal(observed.length, 1);
    assert.equal(patches, 1);
    await assert.rejects(
      service.forward({
        service: 'unknown',
        subPath: '',
        method: 'GET',
        query: '',
        body: undefined,
      }),
      /not registered/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
