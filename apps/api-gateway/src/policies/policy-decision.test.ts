import assert from 'node:assert/strict';
import test from 'node:test';
import { decide, matchPolicy, type PolicyRules } from './policy-decision.js';

const rules: PolicyRules = {
  name: 'Default',
  minCanaryRequests: 20,
  minCanaryMinutes: 10,
  maxFailureRate: 0.01,
  rollbackFailureRate: 0.2,
  rollbackMinRequests: 10,
  allowedGenerators: ['gemini', 'fallback'],
};
const now = new Date('2026-10-02T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const traffic = (patchedRequests: number, adapterFailures = 0) => ({ patchedRequests, adapterFailures, baselineRequests: 0 });

test('waits until both the request and the time thresholds are met', () => {
  const early = decide(rules, traffic(5), minutesAgo(3), 'gemini', now);
  assert.equal(early.action, 'wait');
  assert.match(early.reason, /5\/20 canary requests and 3\/10 minutes/);
  assert.equal(decide(rules, traffic(25), minutesAgo(3), 'gemini', now).action, 'wait');
  assert.equal(decide(rules, traffic(5), minutesAgo(30), 'gemini', now).action, 'wait');
});

test('promotes healthy patches once thresholds are met, with the reasoning for the audit', () => {
  const decision = decide(rules, traffic(40), minutesAgo(12), 'gemini', now);
  assert.equal(decision.action, 'promote');
  assert.match(decision.reason, /Policy "Default": 40 canary requests over 12 minutes/);
  assert.deepEqual(decision.progress, { canaryRequests: 40, adapterFailures: 0, failureRate: 0, minutesInCanary: 12 });
});

test('rolls back failing patches before they are old enough to promote', () => {
  const decision = decide(rules, traffic(7, 3), minutesAgo(1), 'gemini', now);
  assert.equal(decision.action, 'rollback');
  assert.match(decision.reason, /30\.0% over 10 canary requests/);
  // Too few requests to trust the rate yet.
  assert.equal(decide(rules, traffic(2, 2), minutesAgo(1), 'gemini', now).action, 'wait');
  // Rollback disabled.
  assert.equal(decide({ ...rules, rollbackFailureRate: null }, traffic(7, 3), minutesAgo(1), 'gemini', now).action, 'wait');
});

test('a failure rate between the limits needs a reviewer', () => {
  const decision = decide(rules, traffic(45, 5), minutesAgo(20), 'gemini', now);
  assert.equal(decision.action, 'blocked');
  assert.match(decision.reason, /10\.0% is above the policy's 1\.0% limit/);
});

test('only allowed generators are auto-promoted', () => {
  const geminiOnly = { ...rules, allowedGenerators: ['gemini'] };
  assert.equal(decide(geminiOnly, traffic(40), minutesAgo(30), 'fallback', now).action, 'blocked');
  assert.equal(decide(geminiOnly, traffic(40), minutesAgo(30), 'gemini', now).action, 'promote');
  // Rollback still applies to generators that can't be auto-promoted.
  assert.equal(decide(geminiOnly, traffic(5, 5), minutesAgo(30), 'fallback', now).action, 'rollback');
});

test('a patch never deployed has spent no time in canary', () => {
  assert.equal(decide({ ...rules, minCanaryRequests: 0 }, traffic(0), null, 'gemini', now).action, 'wait');
});

test('the most specific enabled policy wins', () => {
  const policies = [
    { id: 'org', serviceId: null, consumerId: null, enabled: true },
    { id: 'service', serviceId: 's1', consumerId: null, enabled: true },
    { id: 'consumer', serviceId: null, consumerId: 'c1', enabled: true },
    { id: 'both', serviceId: 's1', consumerId: 'c1', enabled: false },
  ];
  assert.equal(matchPolicy(policies, 's1', 'c1')?.id, 'service');
  assert.equal(matchPolicy(policies, 's2', 'c1')?.id, 'consumer');
  assert.equal(matchPolicy(policies, 's2', 'c2')?.id, 'org');
  policies[3]!.enabled = true;
  assert.equal(matchPolicy(policies, 's1', 'c1')?.id, 'both');
  assert.equal(matchPolicy([], 's1', 'c1'), null);
});
