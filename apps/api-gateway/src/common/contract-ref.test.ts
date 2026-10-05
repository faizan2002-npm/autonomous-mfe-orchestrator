import test from 'node:test';
import assert from 'node:assert/strict';
import { contractKey, normalizeEndpointPath } from './contract-ref.js';

test('numeric path segments normalize while alphanumeric IDs are preserved', () => {
  assert.equal(
    normalizeEndpointPath('/users/123/orders/4'),
    '/users/:id/orders/:id',
  );
  assert.equal(normalizeEndpointPath('/users/123abc'), '/users/123abc');
});

const base = {
  orgId: 'org-a',
  consumerId: 'web',
  consumerName: 'web',
  serviceName: 'user-service',
  httpMethod: 'GET',
  endpointPath: '/api/v1/users/:id',
};

test('contract keys are stable across concrete IDs and method casing', () => {
  assert.equal(
    contractKey({
      ...base,
      httpMethod: 'get',
      endpointPath: '/api/v1/users/7',
    }),
    contractKey(base),
  );
});

test('contracts are isolated per organization and per consumer', () => {
  assert.notEqual(contractKey(base), contractKey({ ...base, orgId: 'org-b' }));
  assert.notEqual(
    contractKey(base),
    contractKey({ ...base, consumerId: 'billing-worker' }),
  );
});
