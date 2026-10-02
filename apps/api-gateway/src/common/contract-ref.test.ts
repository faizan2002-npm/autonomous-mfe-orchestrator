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

test('contract keys are stable across concrete IDs and method casing', () => {
  assert.equal(
    contractKey({
      serviceName: 'user-service',
      httpMethod: 'get',
      endpointPath: '/api/v1/users/7',
    }),
    contractKey({
      serviceName: 'user-service',
      httpMethod: 'GET',
      endpointPath: '/api/v1/users/:id',
    }),
  );
});
