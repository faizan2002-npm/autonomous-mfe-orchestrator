import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenPayload,
  computeJaccardSimilarity,
  computeDriftCoefficient,
  analyzeSchemaDiff,
  validateAdapterAst,
} from './comparator.js';
import { executeInSandbox } from './sandbox.js';

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
  const oldSchema = new Set(['id:number', 'firstName:string', 'active:boolean']);
  const newSchema = new Set(['id:number', 'first_name:string', 'active:string']);

  const diff = analyzeSchemaDiff(oldSchema, newSchema);
  assert.deepEqual(diff.missingFields, ['firstName']);
  assert.deepEqual(diff.addedFields, ['first_name']);
  assert.deepEqual(diff.typeMismatches, [{ path: 'active', expected: 'boolean', observed: 'string' }]);
});

test('validateAdapterAst blocks unsafe code', () => {
  const safeCode = `(data) => ({ ...data, firstName: data.first_name })`;
  assert.equal(validateAdapterAst(safeCode).valid, true);

  const unsafeEval = `(data) => { eval("console.log(1)"); return data; }`;
  assert.equal(validateAdapterAst(unsafeEval).valid, false);

  const unsafeFetch = `(data) => { fetch("http://evil.com"); return data; }`;
  assert.equal(validateAdapterAst(unsafeFetch).valid, false);
});

test('executeInSandbox runs adapter pure transformation within limits', () => {
  const adapter = `(data) => ({
    id: data.id,
    firstName: data.first_name,
    email: data.email ?? 'no-email@domain.com'
  })`;

  const input = { id: 1, first_name: 'Bob' };
  const res = executeInSandbox(adapter, input);

  assert.equal(res.success, true);
  assert.deepEqual(res.transformedOutput, {
    id: 1,
    firstName: 'Bob',
    email: 'no-email@domain.com',
  });
});
