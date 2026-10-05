import { expect, test } from '@playwright/test';
import {
  createBackendConsumer,
  createOrg,
  createService,
  GATEWAY,
  ORDER_SERVICE,
  reviewer,
} from './support';

test('consumer keys gate proxy traffic and can be revoked', async ({ request }) => {
  const auth = await reviewer();
  const slug = await createOrg(request, auth, 'consumers');
  const service = await createService(request, auth, slug, 'orders', ORDER_SERVICE);
  const { consumer, key } = await createBackendConsumer(request, auth, slug, 'billing', [service.id]);
  const order = `${GATEWAY}/api/v1/orders/orders/ORD-9821`;

  expect((await request.get(order)).status()).toBe(401);
  const ok = await request.get(order, { headers: { 'x-orchestrator-key': key.key } });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).orderId).toBe('ORD-9821');

  // A consumer without access to the service is refused.
  const other = await createBackendConsumer(request, auth, slug, 'analytics', []);
  expect(
    (await request.get(order, { headers: { 'x-orchestrator-key': other.key.key } })).status(),
  ).toBe(403);

  // Backend consumers only get secret keys.
  expect(
    (
      await request.post(`${GATEWAY}/api/orgs/${slug}/consumers/${consumer.id}/keys`, {
        headers: auth,
        data: { type: 'publishable', allowedOrigins: ['http://app.test'] },
      })
    ).status(),
  ).toBe(400);

  const revoked = await request.delete(
    `${GATEWAY}/api/orgs/${slug}/consumers/${consumer.id}/keys/${key.id}`,
    { headers: auth },
  );
  expect(revoked.status()).toBeLessThan(300);
  expect((await request.get(order, { headers: { 'x-orchestrator-key': key.key } })).status()).toBe(
    401,
  );
});

test('publishable keys only work from their allowed origins', async ({ request }) => {
  const auth = await reviewer();
  const slug = await createOrg(request, auth, 'origins');
  const service = await createService(request, auth, slug, 'orders', ORDER_SERVICE);
  const consumer = await (
    await request.post(`${GATEWAY}/api/orgs/${slug}/consumers`, {
      headers: auth,
      data: { name: 'portal', kind: 'frontend', serviceIds: [service.id] },
    })
  ).json();
  const key = await (
    await request.post(`${GATEWAY}/api/orgs/${slug}/consumers/${consumer.id}/keys`, {
      headers: auth,
      data: { type: 'publishable', allowedOrigins: ['http://app.test'] },
    })
  ).json();
  expect(key.key).toMatch(/^pk_/);
  const order = `${GATEWAY}/api/v1/orders/orders/ORD-9821`;
  const from = (origin: string) =>
    request.get(order, { headers: { 'x-orchestrator-key': key.key, origin } });
  expect((await from('http://app.test')).status()).toBe(200);
  expect((await from('http://evil.test')).status()).toBe(403);
});
