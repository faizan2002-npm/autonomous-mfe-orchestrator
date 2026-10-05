import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeInSandbox,
  validateAdapterAst,
} from '@orchestrator/adapter-runtime';
import { assessDrift, flattenPayload } from '@orchestrator/core';
import { buildRenameAdapter } from './fallback-adapter.js';

test('fallback adapter restores renamed and flattened nested fields', () => {
  const stable = {
    id: 1,
    firstName: 'Ada',
    profile: { avatarUrl: 'a.png', bio: 'hi' },
  };
  const drifted = { id: 1, first_name: 'Ada', avatar_url: 'a.png', bio: 'hi' };
  const expected = [...flattenPayload(stable)];
  const drift = assessDrift(expected, drifted, 0);
  assert.ok(drift);

  const adapter = buildRenameAdapter(drift.diff);
  assert.deepEqual(validateAdapterAst(adapter), { valid: true, errors: [] });
  const result = executeInSandbox(adapter, drifted);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(
    (result.transformedOutput as typeof stable).profile,
    stable.profile,
  );
  assert.equal(
    assessDrift(expected, result.transformedOutput, 0)?.isBreaking,
    false,
  );
});

test('fallback adapter skips array and prototype paths', () => {
  const adapter = buildRenameAdapter({
    missingFields: ['items[].sku', '__proto__.x'],
    addedFields: ['line_items[].sku', 'x'],
    typeMismatches: [],
  });
  assert.equal(adapter.includes('set(['), false);
});
