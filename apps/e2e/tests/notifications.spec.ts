import { expect, test } from '@playwright/test';
import {
  createBackendConsumer,
  createOrg,
  createService,
  DRIFTING_USER_SERVICE,
  eventually,
  GATEWAY,
  reviewer,
} from './support';

test('drift reaches the reviewer inbox once and can be marked read', async ({ request }) => {
  const auth = await reviewer();
  const slug = await createOrg(request, auth, 'inbox');
  const org = `${GATEWAY}/api/orgs/${slug}`;
  const service = await createService(request, auth, slug, 'users', DRIFTING_USER_SERVICE);
  const { key } = await createBackendConsumer(request, auth, slug, 'crm', [service.id]);
  const chaos = (mutated: boolean) =>
    request.post(`${org}/demo/services/users/chaos`, { headers: auth, data: { mutated } });
  const user = () =>
    request.get(`${GATEWAY}/api/v1/users/users/101`, {
      headers: { 'x-orchestrator-key': key.key },
    });

  try {
    await chaos(false);
    await user();
    await eventually(async () => {
      const view = await (await request.get(`${org}/governance/services/users`, { headers: auth })).json();
      return view.contracts?.length;
    });
    await chaos(true);
    await user();

    type Item = { id: string; event: string; readAt: string | null };
    const breaking = await eventually(async () => {
      const inbox = await (await request.get(`${org}/notifications`, { headers: auth })).json();
      const items: Item[] = inbox.items ?? inbox;
      const found = items.filter((item) => item.event === 'drift.breaking');
      return found.length ? found : undefined;
    });
    expect(breaking, 'breaking drift notifies the owner').toBeTruthy();
    expect(breaking!.length, 'each event notifies once').toBe(1);
    expect(breaking![0].readAt).toBeNull();

    const read = await request.post(`${org}/notifications/read`, {
      headers: auth,
      data: { ids: [breaking![0].id] },
    });
    expect(read.status()).toBe(204);
    const inbox = await (await request.get(`${org}/notifications`, { headers: auth })).json();
    const items: Item[] = inbox.items ?? inbox;
    expect(items.find((item) => item.id === breaking![0].id)?.readAt).toBeTruthy();

    // Preferences round-trip.
    const preferences = await request.get(`${org}/notifications/preferences`, { headers: auth });
    expect(preferences.status()).toBe(200);
  } finally {
    await chaos(false);
  }
});
