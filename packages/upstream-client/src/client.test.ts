import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { requestUpstream } from './index.js';

test('forwards query and JSON body and preserves upstream status', async () => {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        url: req.url,
        method: req.method,
        body: JSON.parse(body),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await requestUpstream({
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      path: '/api/v1/orders',
      query: '?limit=2&tag=a%20b',
      method: 'POST',
      body: { count: 2 },
    });
    assert.equal(result.status, 201);
    assert.deepEqual(result.payload, {
      url: '/api/v1/orders?limit=2&tag=a%20b',
      method: 'POST',
      body: { count: 2 },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('handles empty responses and times out stalled upstreams', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/empty') {
      res.writeHead(204);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.deepEqual(
      await requestUpstream({ baseUrl, path: '/empty', method: 'GET' }),
      { status: 204, payload: undefined },
    );
    await assert.rejects(
      requestUpstream({
        baseUrl,
        path: '/stall',
        method: 'GET',
        timeoutMs: 20,
      }),
      { name: 'TimeoutError' },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
