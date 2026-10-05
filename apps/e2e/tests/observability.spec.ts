import { expect, test } from '@playwright/test';
import { createOrg, GATEWAY, reviewer } from './support';

test('health probes report the gateway and its dependencies', async ({ request }) => {
  const live = await request.get(`${GATEWAY}/health/live`);
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ alive: true });

  for (const path of ['/health', '/health/ready']) {
    const response = await request.get(`${GATEWAY}${path}`);
    expect(response.status(), path).toBe(200);
    expect((await response.json()).status, path).toBe('healthy');
  }
});

test('Prometheus metrics need a signed-in user', async ({ request }) => {
  expect((await request.get(`${GATEWAY}/metrics`)).status()).toBe(401);
  const metrics = await request.get(`${GATEWAY}/metrics`, { headers: await reviewer() });
  expect(metrics.status()).toBe(200);
  const text = await metrics.text();
  expect(text).toContain('gateway_http_requests_total');
  expect(text).toContain('process_cpu_seconds_total');
});

test('responses carry security headers and structured errors', async ({ request }) => {
  const response = await request.get(`${GATEWAY}/api/orgs`);
  expect(response.status()).toBe(401);
  const headers = response.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['strict-transport-security']).toContain('max-age=');
  const error = await response.json();
  expect(error.statusCode).toBe(401);
  expect(typeof error.message).toBe('string');
});

test('the org event stream is server-sent events for members only', async ({ request }) => {
  const auth = await reviewer();
  const slug = await createOrg(request, auth, 'events');
  const url = `${GATEWAY}/api/orgs/${slug}/governance/events`;
  expect((await request.get(url)).status()).toBe(401);

  const controller = new AbortController();
  const response = await fetch(url, { headers: auth, signal: controller.signal });
  try {
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
  } finally {
    controller.abort();
  }
});
