import test from 'node:test';
import assert from 'node:assert/strict';
import { executeInSandbox, validateAdapterAst } from './index.js';

test('adapter preserves input and transforms output', () => {
  const input = { first_name: 'Ada' };
  const result = executeInSandbox(
    '(data) => ({ firstName: data.first_name })',
    input,
  );
  assert.equal(result.success, true);
  assert.deepEqual(result.transformedOutput, { firstName: 'Ada' });
  assert.deepEqual(input, { first_name: 'Ada' });
});

test('runtime terminates non-terminating adapters', () => {
  const result = executeInSandbox('() => { while (true) {} }', {}, 10);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /timed out/);
});

test('validator rejects eval', () => {
  assert.equal(validateAdapterAst('(data) => eval(data)').valid, false);
});
