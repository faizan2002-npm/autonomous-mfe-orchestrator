import { expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} }, accessToken: vi.fn() }));
const { pushState, urlBase64ToUint8Array } = await import('./push');

test('VAPID keys decode from base64url to raw bytes', () => {
  // 0xfb 0xff 0xfe needs both URL-safe characters and padding.
  expect([...urlBase64ToUint8Array('-__-')]).toEqual([0xfb, 0xff, 0xfe]);
  expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
  expect(urlBase64ToUint8Array('AQ')).toHaveLength(1);
});

test('push is reported unsupported where the browser has no Push API', async () => {
  expect(await pushState('BPublicKey')).toBe('unsupported');
});
