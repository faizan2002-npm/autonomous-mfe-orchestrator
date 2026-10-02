import { QueryClient } from '@tanstack/react-query';
import type { StreamedEvent } from '@orchestrator/shared-types';
import { expect, test, vi } from 'vitest';

vi.mock('./supabase', () => ({ accessToken: vi.fn(), supabase: { auth: {} } }));
const { invalidateFor } = await import('./events');

const contract = {
  serviceName: 'user-service',
  httpMethod: 'GET',
  endpointPath: '/api/v1/users/:id',
  consumerId: 'c1',
  consumerName: 'web',
};

function invalidatedKeys(event: StreamedEvent) {
  const queries = new QueryClient();
  const spy = vi.spyOn(queries, 'invalidateQueries');
  invalidateFor(event, queries);
  return spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
}

test('patch events refresh the patch, lists, stats and audits', () => {
  const keys = invalidatedKeys({
    type: 'patch.promoted',
    at: new Date().toISOString(),
    orgId: 'org-1',
    patchId: 'p1',
    contract,
    canaryPercent: 100,
  });
  expect(keys).toEqual(
    expect.arrayContaining(['["stats"]', '["patches"]', '["patch","p1"]', '["audits"]', '["drift-events"]']),
  );
});

test('drift events refresh stats, services and drift lists only', () => {
  const keys = invalidatedKeys({
    type: 'drift.detected',
    at: new Date().toISOString(),
    orgId: 'org-1',
    driftEventId: 'd1',
    contract,
    driftType: 'FIELD_RENAMED',
    severity: 'CRITICAL',
    coefficient: 0.73,
    isBreaking: true,
  });
  expect(keys.sort()).toEqual(['["drift-events"]', '["services"]', '["stats"]']);
});
