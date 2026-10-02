import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { SupabaseJwtVerifier } from './token-verifier.js';

test('accepts tokens signed by the project JWKS and rejects others', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/auth/v1/.well-known/jwks.json' ? 200 : 404, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const supabaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sign = (claims: { iss?: string; aud?: string; key?: CryptoKey }) =>
    new SignJWT({ email: 'reviewer@example.com' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject('user-1')
      .setIssuer(claims.iss ?? `${supabaseUrl}/auth/v1`)
      .setAudience(claims.aud ?? 'authenticated')
      .setExpirationTime('5m')
      .sign(claims.key ?? privateKey);
  try {
    const verifier = new SupabaseJwtVerifier(supabaseUrl);
    assert.deepEqual(await verifier.verify(await sign({})), {
      id: 'user-1',
      email: 'reviewer@example.com',
    });
    await assert.rejects(verifier.verify(await sign({ aud: 'anon' })));
    await assert.rejects(
      verifier.verify(await sign({ iss: 'https://evil.example' })),
    );
    const other = await generateKeyPair('ES256');
    await assert.rejects(
      verifier.verify(await sign({ key: other.privateKey })),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
