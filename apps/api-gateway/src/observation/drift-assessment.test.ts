import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDrift } from './drift-assessment.js';
import { ObservationService } from './observation.service.js';

test('unchanged payloads and drift at the threshold do not trigger healing', () => {
  assert.equal(assessDrift(['name:string'], { name: 'Ada' }, 0), null);
  assert.equal(assessDrift(['name:string'], { renamed: 'Ada' }, 1), null);
});

test('renames are breaking while additional fields are not', () => {
  const renamed = assessDrift(['firstName:string'], { first_name: 'Ada' }, 0);
  assert.equal(renamed?.type, 'FIELD_RENAMED');
  assert.equal(renamed?.isBreaking, true);
  assert.equal(renamed?.severity, 'CRITICAL');
  const added = assessDrift(['name:string'], { name: 'Ada', active: true }, 0);
  assert.equal(added?.type, 'FIELD_ADDED');
  assert.equal(added?.isBreaking, false);
  assert.equal(added?.severity, 'LOW');
});

test('type changes are classified and numeric path normalization preserves alphanumeric IDs', () => {
  assert.equal(
    assessDrift(['id:number'], { id: '12' }, 0)?.type,
    'TYPE_CHANGED',
  );
  assert.equal(
    ObservationService.prototype.normalizePath('/users/123/orders/4'),
    '/users/:id/orders/:id',
  );
  assert.equal(
    ObservationService.prototype.normalizePath('/users/123abc'),
    '/users/123abc',
  );
});
