import { expect, type APIRequestContext } from '@playwright/test';

export const GATEWAY = 'http://localhost:4000';
export const AUTH = 'http://localhost:54399';
/** Test-only upstreams started from fixtures/demo-upstream.mjs. */
export const USER_SERVICE = 'http://localhost:3001';
export const ORDER_SERVICE = 'http://localhost:3002';
/** A user-service only the API specs drift; the demo org uses USER_SERVICE. */
export const DRIFTING_USER_SERVICE = 'http://localhost:3003';

/**
 * Authorization header for the API specs' user, issued by the local Supabase Auth stand-in. It is
 * not the browser walkthrough's reviewer, whose onboarding expects no memberships.
 */
export async function reviewer(): Promise<Record<string, string>> {
  const session = await (await fetch(`${AUTH}/__e2e/session?user=api`)).json();
  return { authorization: `Bearer ${session.access_token}` };
}

/** A fresh organization owned by the e2e reviewer, so specs don't depend on each other. */
export async function createOrg(
  request: APIRequestContext,
  auth: Record<string, string>,
  prefix: string,
): Promise<string> {
  const slug = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(`${GATEWAY}/api/orgs`, {
    headers: auth,
    data: { name: `E2E ${prefix}`, slug },
  });
  expect(created.status(), await created.text()).toBe(201);
  return slug;
}

export async function createService(
  request: APIRequestContext,
  auth: Record<string, string>,
  slug: string,
  serviceName: string,
  baseUrl: string,
) {
  const created = await request.post(`${GATEWAY}/api/orgs/${slug}/services`, {
    headers: auth,
    data: { serviceName, baseUrl, healthPath: '/health' },
  });
  expect(created.status(), await created.text()).toBe(201);
  return created.json();
}

/** A backend consumer with access to the given services and a fresh secret key. */
export async function createBackendConsumer(
  request: APIRequestContext,
  auth: Record<string, string>,
  slug: string,
  name: string,
  serviceIds: string[],
) {
  const consumer = await (
    await request.post(`${GATEWAY}/api/orgs/${slug}/consumers`, {
      headers: auth,
      data: { name, kind: 'backend', serviceIds },
    })
  ).json();
  const key = await (
    await request.post(`${GATEWAY}/api/orgs/${slug}/consumers/${consumer.id}/keys`, {
      headers: auth,
      data: { type: 'secret' },
    })
  ).json();
  expect(key.key).toMatch(/^sk_/);
  return { consumer, key };
}

/** Polls until `probe` returns a truthy value. */
export async function eventually<T>(probe: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value || Date.now() > deadline) return value;
    await new Promise((done) => setTimeout(done, 200));
  }
}
