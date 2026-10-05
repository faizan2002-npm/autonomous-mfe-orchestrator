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

test('validator accepts pure transformations', () => {
  for (const code of [
    '(data) => ({ ...data, firstName: data.first_name })',
    '(data) => ({ fetch: data?.fetch ?? null, items: data.items.map((i) => i.sku) })',
    'function (data) { const out = { ...data }; out.at = new Date(0).toISOString(); return out; }',
  ]) {
    assert.deepEqual(
      validateAdapterAst(code),
      { valid: true, errors: [] },
      code,
    );
  }
});

test('validator rejects code execution, I/O and prototype access', () => {
  for (const code of [
    '(data) => eval(data)',
    '(data) => { fetch("http://evil.com"); return data; }',
    '(data) => new Function("return process")()',
    '(data) => data.constructor.constructor("return this")()',
    '(data) => data["__proto__"]',
    '(data) => globalThis.process',
    '(data) => import("fs")',
    'async (data) => data',
    'const x = 1',
    '(data) => data; fetch("x")',
  ]) {
    assert.equal(validateAdapterAst(code).valid, false, code);
  }
});
