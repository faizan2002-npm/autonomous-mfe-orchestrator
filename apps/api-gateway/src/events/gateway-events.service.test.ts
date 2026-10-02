import test from 'node:test';
import assert from 'node:assert/strict';
import type { GatewayEvent } from '@orchestrator/shared-types';
import { GatewayEventsService } from './gateway-events.service.js';

test('published events are timestamped and delivered to subscribers', () => {
  const events = new GatewayEventsService();
  const received: GatewayEvent[] = [];
  const subscription = events
    .stream()
    .subscribe((event) => received.push(event));
  events.publish({
    type: 'patch.promoted',
    patchId: 'p1',
    contract: { serviceName: 's', httpMethod: 'GET', endpointPath: '/x' },
    canaryPercent: 100,
  });
  subscription.unsubscribe();
  events.publish({
    type: 'patch.rolledBack',
    patchId: 'p1',
    contract: { serviceName: 's', httpMethod: 'GET', endpointPath: '/x' },
    canaryPercent: 0,
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'patch.promoted');
  assert.ok(!Number.isNaN(Date.parse(received[0].at)));
});
