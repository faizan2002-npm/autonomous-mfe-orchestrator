import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const signOut = vi.fn();
vi.mock('./supabase', () => ({
  accessToken: vi.fn(async () => 'session-token'),
  supabase: { auth: { signOut } },
}));

const { api, ApiError } = await import('./api');

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  signOut.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('sends the session token and builds filtered URLs', async () => {
  fetchMock.mockResolvedValue(json(200, { items: [], nextCursor: null }));
  await api.driftEvents({ service: 'user-service', type: 'FIELD_RENAMED', limit: 25 });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(
    'http://gateway.test/api/governance/drift-events?service=user-service&type=FIELD_RENAMED&limit=25',
  );
  expect(init.headers.authorization).toBe('Bearer session-token');
});

test('posts decisions as JSON', async () => {
  fetchMock.mockResolvedValue(json(201, { message: 'ok' }));
  await api.promotePatch('p1', { serviceName: 'user-service', notes: 'looks good' });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('http://gateway.test/api/governance/patches/p1/promote');
  expect(init.method).toBe('POST');
  expect(init.headers['content-type']).toBe('application/json');
  expect(JSON.parse(init.body)).toEqual({ serviceName: 'user-service', notes: 'looks good' });
});

test('a 401 signs the reviewer out and surfaces the server message', async () => {
  fetchMock.mockResolvedValue(json(401, { message: 'Invalid or expired session' }));
  const error = await api.stats().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as InstanceType<typeof ApiError>).status).toBe(401);
  expect((error as Error).message).toBe('Invalid or expired session');
  expect(signOut).toHaveBeenCalledOnce();
});

test('validation errors arrive as readable text', async () => {
  fetchMock.mockResolvedValue(json(400, { message: ['limit must not be greater than 100'] }));
  await expect(api.audits(1000)).rejects.toThrow('limit must not be greater than 100');
});
