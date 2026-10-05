import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

const state = {
  import: {
    title: 'Users API',
    version: '2.0.0',
    importedAt: new Date().toISOString(),
    importedBy: 'owner@acme.test',
    operations: 1,
    skipped: ['DELETE /api/v1/users'],
    requiredOnly: false,
    sourceUrl: 'http://users.test/openapi.yaml',
  },
  operations: [
    {
      id: 'op1',
      httpMethod: 'GET',
      pathTemplate: '/api/v1/users/{id}',
      operationId: 'getUser',
      summary: 'One user',
      responseStatus: '200',
      schemaTokens: ['firstName:string', 'id:number'],
    },
  ],
  comparisons: [
    {
      contractId: 'k1',
      consumerId: 'c1',
      consumerName: 'acme-portal',
      httpMethod: 'GET',
      endpointPath: '/api/v1/users/:id',
      source: 'traffic',
      operationId: 'op1',
      pathTemplate: '/api/v1/users/{id}',
      missingFromContract: ['firstName:string'],
      notInSpec: ['first_name:string'],
    },
  ],
};
const api = {
  openapi: vi.fn(async () => state),
  importOpenApi: vi.fn(async () => state),
  adoptOpenApi: vi.fn(async () => ({
    ...state,
    comparisons: [{ ...state.comparisons[0], source: 'openapi', missingFromContract: [], notInSpec: [] }],
  })),
  removeOpenApi: vi.fn(),
};
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} }, accessToken: vi.fn() }));
vi.mock('@/lib/org', () => ({ useOrg: () => ({ slug: 'acme', api, can: () => true }) }));
const { OpenApiPanel } = await import('./OpenApiPanel');

const service = {
  id: 's1',
  serviceName: 'user-service',
  baseUrl: 'http://users.test',
  description: null,
  healthPath: null,
  timeoutMs: 10000,
  upstreamHeaderNames: [],
  status: 'HEALTHY' as const,
  openapi: state.import,
  createdAt: new Date().toISOString(),
};

function renderPanel() {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queries}>
      <OpenApiPanel service={service} />
    </QueryClientProvider>,
  );
}

test('shows declared responses and how a learned contract differs from the spec', async () => {
  renderPanel();
  expect(await screen.findByText('Users API')).toBeInTheDocument();
  expect(screen.getByText(/200 · getUser · 2 fields/)).toBeInTheDocument();
  expect(screen.getByText(/Not used \(no JSON 2xx response\): DELETE \/api\/v1\/users/)).toBeInTheDocument();
  expect(screen.getByText('+ firstName:string')).toBeInTheDocument();
  expect(screen.getByText('− first_name:string')).toBeInTheDocument();
  expect(screen.getByText('Learned from traffic')).toBeInTheDocument();
});

test('a reviewer moves a contract onto the spec', async () => {
  renderPanel();
  await userEvent.click(await screen.findByRole('button', { name: 'Use spec as contract' }));
  expect(api.adoptOpenApi).toHaveBeenCalledWith('s1', 'k1');
  expect(await screen.findByText('Matches spec')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use spec as contract' })).not.toBeInTheDocument();
});

test('re-importing from a URL sends the URL and the required-only choice', async () => {
  renderPanel();
  await userEvent.click(await screen.findByRole('button', { name: 'Re-import' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByLabelText('Spec URL')).toHaveValue('http://users.test/openapi.yaml');
  await userEvent.click(within(dialog).getByRole('checkbox', { name: /Only required properties/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
  await waitFor(() =>
    expect(api.importOpenApi).toHaveBeenCalledWith('s1', { url: 'http://users.test/openapi.yaml', requiredOnly: true }),
  );
});
