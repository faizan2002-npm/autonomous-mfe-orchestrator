// Stand-in for Supabase Auth during e2e runs: publishes a JWKS for the gateway to trust
// and hands the test runner a session signed with the matching private key.
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const port = Number(process.env.E2E_AUTH_PORT ?? 54399);
const issuer = `http://localhost:${port}/auth/v1`;
const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwks = {
  keys: [{ ...(await exportJWK(publicKey)), kid: 'e2e', alg: 'ES256' }],
};

// The browser walkthrough signs in as the reviewer; API specs use their own user so the
// organizations they create don't change what the reviewer sees.
const USERS = {
  reviewer: { id: '00000000-0000-4000-8000-0000000000e2', email: 'e2e-reviewer@example.test' },
  api: { id: '00000000-0000-4000-8000-0000000000e3', email: 'e2e-api@example.test' },
};

async function session(name = 'reviewer') {
  const user = {
    ...USERS[name],
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = await new SignJWT({
    email: user.email,
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'e2e' })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(privateKey);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'e2e-not-refreshable',
    user,
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const user = url.searchParams.get('user') ?? 'reviewer';
  const body =
    url.pathname === '/auth/v1/.well-known/jwks.json'
      ? jwks
      : url.pathname === '/__e2e/session' && user in USERS
        ? await session(user)
        : null;
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body ?? { error: 'not found' }));
}).listen(port, () => console.log(`e2e auth server on ${port}`));
