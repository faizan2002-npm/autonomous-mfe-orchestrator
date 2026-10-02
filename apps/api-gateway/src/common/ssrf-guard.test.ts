import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assertSafeUrl,
  createGuardedFetch,
  isBlockedAddress,
} from './ssrf-guard.js';

test('private, loopback, link-local and mapped addresses are blocked', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])
    assert.equal(isBlockedAddress(address), true, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(isBlockedAddress(address), false, address);
});

test('URLs are validated for scheme, credentials and destination', async () => {
  await assert.rejects(
    assertSafeUrl('ftp://example.com', false),
    /http and https/,
  );
  await assert.rejects(
    assertSafeUrl('https://user:pw@example.com', false),
    /credentials/,
  );
  await assert.rejects(
    assertSafeUrl('http://127.0.0.1:3001', false),
    /private or reserved/,
  );
  await assert.rejects(
    assertSafeUrl('http://localhost:3001', false),
    /private or reserved/,
  );
  await assert.rejects(
    assertSafeUrl('http://[::1]/', false),
    /private or reserved/,
  );
  assert.equal(
    (await assertSafeUrl('http://localhost:3001', true)).port,
    '3001',
  );
});

test('the guarded fetch refuses to dial internal hosts at connection time', async () => {
  const server = createServer((_req, res) => res.end('internal'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://localhost:${(server.address() as AddressInfo).port}/`;
  try {
    await assert.rejects(createGuardedFetch(false)(url));
    assert.equal(
      await (await createGuardedFetch(true)(url)).text(),
      'internal',
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
