import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { MetricsGuard } from './metrics.guard.js';

const TOKEN = 'scrape-token-0123456789abcdef';

const verifier = {
  verify: async (token: string) => {
    if (token !== 'session') throw new Error('invalid');
    return { id: 'user-1' };
  },
} as unknown as TokenVerifier;

function contextWith(authorization?: string): ExecutionContext {
  const request = { headers: authorization ? { authorization } : {} };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

test('the configured metrics token opens /metrics', async () => {
  const guard = new MetricsGuard(verifier, { metricsToken: TOKEN });
  assert.equal(await guard.canActivate(contextWith(`Bearer ${TOKEN}`)), true);
});

test('a wrong token falls back to session auth and is rejected', async () => {
  const guard = new MetricsGuard(verifier, { metricsToken: TOKEN });
  await assert.rejects(guard.canActivate(contextWith(`Bearer ${TOKEN}x`)), /Invalid or expired/);
  await assert.rejects(guard.canActivate(contextWith()), /Sign in/);
});

test('signed-in users still read metrics, with or without a token configured', async () => {
  assert.equal(await new MetricsGuard(verifier, {}).canActivate(contextWith('Bearer session')), true);
  assert.equal(
    await new MetricsGuard(verifier, { metricsToken: TOKEN }).canActivate(contextWith('Bearer session')),
    true,
  );
});
