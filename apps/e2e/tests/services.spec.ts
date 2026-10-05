import { expect, test } from '@playwright/test';
import { createOrg, createService, GATEWAY, ORDER_SERVICE, reviewer } from './support';

test('admin registers, checks, configures and deletes a service', async ({ request }) => {
  const auth = await reviewer();
  const slug = await createOrg(request, auth, 'services');
  const services = `${GATEWAY}/api/orgs/${slug}/services`;

  const service = await createService(request, auth, slug, 'orders', ORDER_SERVICE);
  expect(service.serviceName).toBe('orders');

  // Connection test reaches the upstream's health path.
  const check = await request.post(`${services}/${service.id}/test`, { headers: auth });
  expect(check.status()).toBe(200);
  expect((await check.json()).ok).toBe(true);

  // Upstream headers are stored encrypted: only their names come back.
  const configured = await request.patch(`${services}/${service.id}`, {
    headers: auth,
    data: { upstreamHeaders: { authorization: 'Bearer secret-token' }, description: 'Orders' },
  });
  expect(configured.status(), await configured.text()).toBe(200);
  const body = await configured.text();
  expect(JSON.parse(body).upstreamHeaderNames).toEqual(['authorization']);
  expect(body).not.toContain('secret-token');

  // Validation and duplicates.
  expect(
    (
      await request.post(services, {
        headers: auth,
        data: { serviceName: 'Bad Name', baseUrl: ORDER_SERVICE },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(services, {
        headers: auth,
        data: { serviceName: 'orders', baseUrl: ORDER_SERVICE },
      })
    ).status(),
  ).toBe(409);

  const removed = await request.delete(`${services}/${service.id}`, { headers: auth });
  expect(removed.status()).toBe(204);
  expect(await (await request.get(services, { headers: auth })).json()).toEqual([]);
});
