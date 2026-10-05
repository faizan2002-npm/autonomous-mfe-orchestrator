import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';

const api = {
  preferences: vi.fn(async () => ({
    'drift.breaking': ['email'],
    'patch.awaiting_review': ['email', 'push'],
    'patch.rejected': ['email'],
    'patch.promoted': [],
    'patch.rolled_back': ['email'],
  })),
  updatePreferences: vi.fn(async (next: Record<string, string[]>) => ({ ...(await api.preferences()), ...next })),
  testNotification: vi.fn(),
  inbox: vi.fn(async () => ({
    unreadCount: 1,
    items: [
      {
        id: '1',
        event: 'patch.awaiting_review',
        title: 'Patch ready for review: user-service',
        body: 'Canary is healing traffic.',
        link: '/o/acme/patches/p1',
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ],
  })),
  markRead: vi.fn(async () => undefined),
};
let role = 'reviewer';
const order = ['viewer', 'reviewer', 'admin', 'owner'];

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} }, accessToken: vi.fn() }));
vi.mock('@/lib/org', () => ({
  useOrg: () => ({ slug: 'acme', api, can: (min: string) => order.indexOf(role) >= order.indexOf(min) }),
}));
vi.mock('@/lib/push', () => ({ pushState: async () => 'unconfigured', enablePush: vi.fn(), disablePush: vi.fn() }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  accountApi: { pushConfig: async () => ({ enabled: false, publicKey: null }) },
}));
const { NotificationsPage } = await import('./NotificationsPage');

function renderAt(url: string) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queries}>
      <MemoryRouter initialEntries={[url]}>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test('the inbox lists notifications that link to the patch', async () => {
  renderAt('/o/acme/notifications');
  const list = await screen.findByRole('list', { name: 'Notifications' });
  const link = within(list).getByRole('link', { name: /Patch ready for review/ });
  expect(link).toHaveAttribute('href', '/o/acme/patches/p1');
  expect(screen.getByText('1 unread')).toBeInTheDocument();
  // Integrations are for admins only.
  expect(screen.queryByRole('tab', { name: 'Integrations' })).not.toBeInTheDocument();
});

test('the preference matrix toggles one channel for one event', async () => {
  renderAt('/o/acme/notifications?tab=preferences');
  const push = await screen.findByRole('switch', { name: 'Push for Breaking drift' });
  expect(push).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Push for Patch awaiting review' })).toBeChecked();
  expect(await screen.findByText(/not configured on this gateway/)).toBeInTheDocument();

  await userEvent.click(push);
  await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledWith({ 'drift.breaking': ['email', 'push'] }));
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Push for Breaking drift' })).toBeChecked());
});

test('admins also manage organization integrations', async () => {
  role = 'admin';
  renderAt('/o/acme/notifications');
  expect(await screen.findByRole('tab', { name: 'Integrations' })).toBeInTheDocument();
});
