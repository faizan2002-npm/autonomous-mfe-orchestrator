import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe-style signature: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`. Receivers
 * recompute it with their signing secret and reject old timestamps to stop replays.
 */
export function signWebhook(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

export function verifyWebhook(
  body: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=') as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1 || Math.abs(now - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(signWebhook(body, secret, timestamp).split('v1=')[1], 'hex');
  const actual = Buffer.from(parts.v1, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
