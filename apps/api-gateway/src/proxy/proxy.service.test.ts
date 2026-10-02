import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CanaryService } from '../canary/canary.service.js';
import type { ResolvedConsumer } from '../consumers/consumers.service.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import type { ObservationService } from '../observation/observation.service.js';
import type { ServiceRegistryService } from '../services/service-registry.service.js';
import { ProxyService } from './proxy.service.js';

const consumer: ResolvedConsumer = {
  keyId: 'key',
  keyType: 'secret',
  allowedOrigins: [],
  orgId: 'org-a',
  orgSlug: 'acme',
  consumerId: 'consumer-1',
  consumerName: 'billing-worker',
  kind: 'backend',
  serviceIds: ['svc-users'],
};

test('proxy forwards for granted services, observes successful JSON per consumer, and guards access', async () => {
  const seenHeaders: Array<Record<string, string | string[] | undefined>> = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seenHeaders.push(req.headers);
    res.writeHead(req.url?.includes('failure') ? 500 : 200, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({ url: req.url, body }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const registry = {
    guardedFetch: fetch,
    resolve: async (orgId: string, name: string) =>
      orgId === 'org-a' && ['user-service', 'order-service'].includes(name)
        ? {
            id: name === 'user-service' ? 'svc-users' : 'svc-orders',
            orgId,
            serviceName: name,
            baseUrl,
            timeoutMs: 2_000,
            headers: {
              'x-service-token': 'from-org',
              authorization: 'Bearer org-credential',
            },
          }
        : null,
  } as unknown as ServiceRegistryService;
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
    registry,
    new GatewayEventsService(),
  );
  const request = {
    consumer,
    service: 'user-service',
    subPath: 'users',
    method: 'POST',
    query: '?page=2',
    body: { name: 'Ada' },
    headers: {
      authorization: 'Bearer end-user',
      'x-request-id': 'r1',
      cookie: 'secret=1',
    },
  };
  try {
    const success = await service.forward(request);
    assert.deepEqual(success.payload, {
      url: '/api/v1/users?page=2',
      body: '{"name":"Ada"}',
    });
    assert.deepEqual(observed, [
      {
        orgId: 'org-a',
        consumerId: 'consumer-1',
        consumerName: 'billing-worker',
        serviceName: 'user-service',
        serviceId: 'svc-users',
        httpMethod: 'POST',
        endpointPath: '/api/v1/users',
        observedPayload: success.payload,
      },
    ]);
    assert.equal(patches, 1);
    // Tracing headers pass through; org credentials override the client's; cookies never leak.
    assert.equal(seenHeaders[0]['x-request-id'], 'r1');
    assert.equal(seenHeaders[0]['x-service-token'], 'from-org');
    assert.equal(seenHeaders[0].authorization, 'Bearer org-credential');
    assert.equal(seenHeaders[0].cookie, undefined);

    const failed = await service.forward({
      ...request,
      subPath: 'failure',
      method: 'GET',
      body: undefined,
    });
    assert.equal(failed.status, 500);
    assert.equal(observed.length, 1);
    assert.equal(patches, 1);

    await assert.rejects(
      service.forward({ ...request, service: 'order-service' }),
      /may not call/,
    );
    await assert.rejects(
      service.forward({ ...request, service: 'unknown' }),
      /not registered/,
    );
    await assert.rejects(
      service.forward({
        ...request,
        consumer: { ...consumer, orgId: 'org-b' },
      }),
      /not registered/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
