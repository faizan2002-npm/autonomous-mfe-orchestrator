import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, Subject } from 'rxjs';
import type { GatewayEvent } from '@orchestrator/shared-types';
import { GatewayEventsService } from './gateway-events.service.js';
import type { RedisEventService } from './redis-event.service.js';

test('published events are timestamped and delivered to subscribers', () => {
  const mockRedisEvents: RedisEventService = {
    stream: () => EMPTY,
    publish: () => {},
    onApplicationBootstrap: async () => {},
    onApplicationShutdown: async () => {},
  } as any;

  const events = new GatewayEventsService(mockRedisEvents);
  events.onApplicationBootstrap();

  const received: GatewayEvent[] = [];
  const subscription = events
    .stream()
    .subscribe((event) => received.push(event));
  events.publish({
    type: 'patch.promoted',
    patchId: 'p1',
    contract: {
      serviceName: 's',
      httpMethod: 'GET',
      endpointPath: '/x',
      consumerId: 'c',
      consumerName: 'web',
    },
    orgId: 'org',
    canaryPercent: 100,
  });
  subscription.unsubscribe();
  events.publish({
    type: 'patch.rolledBack',
    patchId: 'p1',
    contract: {
      serviceName: 's',
      httpMethod: 'GET',
      endpointPath: '/x',
      consumerId: 'c',
      consumerName: 'web',
    },
    orgId: 'org',
    canaryPercent: 0,
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'patch.promoted');
  assert.ok(!Number.isNaN(Date.parse(received[0].at)));
});

test('remote events reach stream() but not localStream()', () => {
  const remote = new Subject<GatewayEvent>();
  const events = new GatewayEventsService({
    stream: () => remote.asObservable(),
    publish: () => {},
  } as unknown as RedisEventService);

  const all: string[] = [];
  const local: string[] = [];
  events.stream().subscribe((event) => all.push(event.type));
  events.localStream().subscribe((event) => local.push(event.type));

  const contract = {
    serviceName: 's',
    httpMethod: 'GET',
    endpointPath: '/x',
    consumerId: 'c',
    consumerName: 'web',
  };
  events.publish({ type: 'patch.promoted', patchId: 'p1', contract, orgId: 'org', canaryPercent: 100 });
  remote.next({
    type: 'patch.rolledBack',
    patchId: 'p2',
    contract,
    orgId: 'org',
    canaryPercent: 0,
    at: new Date().toISOString(),
  } as GatewayEvent);

  assert.deepEqual(all, ['patch.promoted', 'patch.rolledBack']);
  assert.deepEqual(local, ['patch.promoted']);
});
