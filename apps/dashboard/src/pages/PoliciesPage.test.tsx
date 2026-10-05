import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';

const policy = {
  id: 'p1',
  name: 'Default',
  enabled: true,
  serviceId: null,
  serviceName: null,
  consumerId: null,
  consumerName: null,
  minCanaryRequests: 50,
  minCanaryMinutes: 30,
  maxFailureRate: 0,
  rollbackFailureRate: 0.25,
  rollbackMinRequests: 20,
  allowedGenerators: ['gemini', 'fallback'],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const api = {
  policies: vi.fn(async () => [policy]),
  policyOutlook: vi.fn(async () => [
    {
      patchId: 'patch-1',
      contract: { serviceName: 'user-service', httpMethod: 'GET', endpointPath: '/users/:id', consumerId: 'c1', consumerName: 'acme-portal' },
      generator: 'gemini',
      deployedAt: '2026-10-02T11:50:00Z',
      policy: { id: 'p1', name: 'Default', minCanaryRequests: 50, minCanaryMinutes: 30, maxFailureRate: 0, rollbackFailureRate: 0.25 },
      decision: {
        action: 'wait',
        reason: 'Waiting for 12/50 canary requests and 10/30 minutes in canary.',
        progress: { canaryRequests: 12, adapterFailures: 0, failureRate: 0, minutesInCanary: 10.4 },
      },
    },
  ]),
  createPolicy: vi.fn(async (input: { name: string }) => ({ ...policy, id: 'p2', name: input.name })),
  updatePolicy: vi.fn(),
  deletePolicy: vi.fn(),
  registry: vi.fn(async () => [{ id: 's1', serviceName: 'user-service' }]),
  consumers: vi.fn(async () => [{ id: 'c1', name: 'acme-portal' }]),
};

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} }, accessToken: vi.fn() }));
vi.mock('@/lib/org', () => ({
  useOrg: () => ({ slug: 'acme', api, can: () => true }),
  useOrgPath: () => (path: string) => `/o/acme${path}`,
}));
const { PoliciesPage } = await import('./PoliciesPage');

function renderPage() {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queries}>
      <MemoryRouter>
        <PoliciesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test('canary patches show progress toward the policy and the next step', async () => {
  renderPage();
  expect(await screen.findByText('Gathering evidence')).toBeInTheDocument();
  expect(screen.getByText(/12\/50 canary requests/)).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Requests' })).toHaveAttribute('aria-valuenow', '24');
  expect(screen.getByRole('progressbar', { name: 'Minutes' })).toHaveAttribute('aria-valuenow', '33');
  expect(screen.getByRole('link', { name: /user-service/ })).toHaveAttribute('href', '/o/acme/patches/patch-1');
  expect(screen.getByText('≥ 25.0% after 20 requests')).toBeInTheDocument();
});

test('creating a policy converts percentages to rates and can disable rollback', async () => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'New policy' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Name'), 'Fast lane');
  const requests = within(dialog).getByLabelText('Canary requests ≥');
  await userEvent.clear(requests);
  await userEvent.type(requests, '10');
  const failures = within(dialog).getByLabelText('Adapter failures ≤ (%)');
  await userEvent.clear(failures);
  await userEvent.type(failures, '2.5');
  await userEvent.click(within(dialog).getByRole('switch', { name: 'Roll back automatically' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create policy' }));
  await waitFor(() =>
    expect(api.createPolicy).toHaveBeenCalledWith({
      name: 'Fast lane',
      minCanaryRequests: 10,
      minCanaryMinutes: 30,
      maxFailureRate: 0.025,
      rollbackFailureRate: null,
      rollbackMinRequests: 20,
      allowedGenerators: ['gemini', 'fallback'],
    }),
  );
});
