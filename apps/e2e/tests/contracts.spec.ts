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

test.describe.configure({ mode: 'serial' });

test('upstream drift is recorded, filterable and healed by a canary patch', async ({
  request,
}) => {
  const auth = await reviewer();
  const slug = await createOrg(request, auth, 'drift');
  const org = `${GATEWAY}/api/orgs/${slug}`;
  const service = await createService(request, auth, slug, 'users', DRIFTING_USER_SERVICE);
  const { consumer, key } = await createBackendConsumer(request, auth, slug, 'crm', [service.id]);
  const chaos = (mutated: boolean) =>
    request.post(`${org}/demo/services/users/chaos`, { headers: auth, data: { mutated } });
  const user = () =>
    request.get(`${GATEWAY}/api/v1/users/users/101`, {
      headers: { 'x-orchestrator-key': key.key },
    });

  try {
    expect((await chaos(false)).status()).toBe(200);
    // The first response becomes the baseline contract.
    expect((await (await user()).json()).firstName).toBe('Faizan');
    const contracts = await eventually(async () => {
      const view = await (await request.get(`${org}/governance/services/users`, { headers: auth })).json();
      return view.contracts?.length ? view.contracts : undefined;
    });
    expect(contracts[0].consumerName).toBe('crm');

    // Drift: renamed and flattened fields.
    expect((await chaos(true)).status()).toBe(200);
    expect((await (await user()).json()).first_name).toBe('Faizan');
    const drift = await eventually(async () => {
      const page = await (await request.get(`${org}/governance/drift-events`, { headers: auth })).json();
      return page.items?.[0];
    });
    expect(drift, 'drift event is recorded').toBeTruthy();

    // Filters narrow the list.
    const byConsumer = await (
      await request.get(`${org}/governance/drift-events?consumerId=${consumer.id}`, { headers: auth })
    ).json();
    expect(byConsumer.items.map((d: { id: string }) => d.id)).toContain(drift.id);
    const otherService = await (
      await request.get(`${org}/governance/drift-events?service=nope`, { headers: auth })
    ).json();
    expect(otherService.items).toEqual([]);

    // The detail carries the diff.
    const detail = await request.get(`${org}/governance/drift-events/${drift.id}`, { headers: auth });
    expect(detail.status()).toBe(200);
    expect(JSON.stringify(await detail.json())).toContain('firstName');

    // Breaking drift produces a canary patch from the deterministic fallback adapter.
    const canary = await eventually(async () => {
      const patches = await (
        await request.get(`${org}/governance/patches?status=CANARY`, { headers: auth })
      ).json();
      return patches[0];
    }, 20_000);
    expect(canary, 'a canary patch is generated').toBeTruthy();
    expect(canary.contract.serviceName).toBe('users');
  } finally {
    await chaos(false);
  }
});
