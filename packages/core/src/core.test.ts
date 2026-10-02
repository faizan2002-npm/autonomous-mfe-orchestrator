import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenPayload,
  computeJaccardSimilarity,
  computeDriftCoefficient,
  analyzeSchemaDiff,
  assessDrift,
} from './index.js';

test('flattenPayload flattens simple and nested objects', () => {
  const payload = {
    id: 101,
    name: 'Order 101',
    customer: {
      firstName: 'Alice',
      address: {
        city: 'Metropolis',
      },
    },
    tags: ['urgent', 'pending'],
  };

  const tokens = flattenPayload(payload);
  assert.ok(tokens.has('id:number'));
  assert.ok(tokens.has('name:string'));
  assert.ok(tokens.has('customer.firstName:string'));
  assert.ok(tokens.has('customer.address.city:string'));
  assert.ok(tokens.has('tags[]:string'));
});

test('Jaccard similarity and drift coefficient calculation', () => {
  const schemaA = new Set(['id:number', 'firstName:string', 'email:string']);
  const schemaB = new Set(['id:number', 'first_name:string', 'email:string']);

  const similarity = computeJaccardSimilarity(schemaA, schemaB);
  const driftCoeff = computeDriftCoefficient(schemaA, schemaB);

  // Common: 2 (id:number, email:string). Union: 4
  assert.equal(similarity, 0.5);
  assert.equal(driftCoeff, 0.5);
});

test('analyzeSchemaDiff detects missing, added, and type changed fields', () => {
  const oldSchema = new Set([
    'id:number',
    'firstName:string',
    'active:boolean',
  ]);
  const newSchema = new Set([
    'id:number',
    'first_name:string',
    'active:string',
  ]);

  const diff = analyzeSchemaDiff(oldSchema, newSchema);
  assert.deepEqual(diff.missingFields, ['firstName']);
  assert.deepEqual(diff.addedFields, ['first_name']);
  assert.deepEqual(diff.typeMismatches, [
    { path: 'active', expected: 'boolean', observed: 'string' },
  ]);
});

test('analyzeSchemaDiff keeps field names that contain a colon', () => {
  const diff = analyzeSchemaDiff(
    new Set(['meta:tag:string']),
    new Set(['meta:tag:number']),
  );
  assert.deepEqual(diff.typeMismatches, [
    { path: 'meta:tag', expected: 'string', observed: 'number' },
  ]);
});

test('unchanged payloads and drift at the threshold are not reported', () => {
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

test('type changes are classified as TYPE_CHANGED', () => {
  assert.equal(
    assessDrift(['id:number'], { id: '12' }, 0)?.type,
    'TYPE_CHANGED',
  );
});
