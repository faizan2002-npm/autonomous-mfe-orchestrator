import { expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} }, accessToken: vi.fn() }));
const { safeNext } = await import('./AuthPages');

test('only same-app paths are accepted as post-login destinations', () => {
  expect(safeNext('/o/acme/patches')).toBe('/o/acme/patches');
  expect(safeNext('/invite/abc')).toBe('/invite/abc');
  expect(safeNext(null)).toBe('/');
  expect(safeNext('https://evil.example')).toBe('/');
  expect(safeNext('//evil.example/path')).toBe('/');
  expect(safeNext('javascript:alert(1)')).toBe('/');
});
