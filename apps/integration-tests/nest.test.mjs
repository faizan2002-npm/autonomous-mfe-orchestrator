// End-to-end API test of the multi-tenant gateway over real HTTP: real Nest wiring, real
// Postgres/Redis, a local JWKS standing in for Supabase Auth, and a local mock upstream.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
assert.ok(
  databaseUrl && redisUrl,
  'Use disposable TEST_DATABASE_URL and TEST_REDIS_URL services',
);

const listen = async (server) => {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${server.address().port}`;
};

// --- Stand-in for Supabase Auth ------------------------------------------------------------
const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwks = {
  keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' }],
};
const authServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(jwks));
});
const supabaseUrl = await listen(authServer);
const signIn = async (id, email) => {
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setSubject(id)
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setAudience('authenticated')
    .setExpirationTime('10m')
    .sign(privateKey);
  return { authorization: `Bearer ${token}` };
};
const alice = await signIn(
  '00000000-0000-4000-8000-00000000a11c',
  'alice@acme.test',
);
const bob = await signIn(
  '00000000-0000-4000-8000-000000000b0b',
  'bob@globex.test',
);

// --- Mock upstream with a drift switch -----------------------------------------------------
let drifted = false;
const upstream = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url?.startsWith('/api/v1/users/'))
    return res.end(
      JSON.stringify(
        drifted
          ? { id: 7, first_name: 'Ada', email: 'ada@acme.test' }
          : { id: 7, firstName: 'Ada', email: 'ada@acme.test' },
      ),
    );
  res.end(JSON.stringify({ ok: true }));
});
const upstreamUrl = await listen(upstream);

Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  SUPABASE_URL: supabaseUrl,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  KEY_PEPPER: randomBytes(32).toString('base64'),
  ALLOW_PRIVATE_UPSTREAMS: 'true',
  APP_URL: 'http://dashboard.test',
  GEMINI_API_KEY: '',
});

// Source mode checks tsx development startup; default checks compiled production code.
const gatewayRoot = resolve(import.meta.dirname, '../api-gateway');
const source = process.env.TEST_GATEWAY_SOURCE === 'true';
const { createGateway } = await import(
  pathToFileURL(
    `${gatewayRoot}/${source ? 'src' : 'dist'}/application.${source ? 'ts' : 'js'}`,
  ).href
);

test.after(() => {
  for (const server of [authServer, upstream]) {
    server.closeAllConnections();
    server.close();
  }
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

test('multi-tenant gateway: orgs, roles, consumer keys, per-consumer healing and isolation', async () => {
  const setup = postgres(databaseUrl, { onnotice: () => {} });
  try {
    await migrate(drizzle(setup), {
      migrationsFolder: resolve(
        gatewayRoot,
        '../../packages/database/migrations',
      ),
    });
  } finally {
    await setup.end();
  }

  let app = await createGateway({ logger: false, shutdownHooks: false });
  let http = app.getHttpAdapter().getInstance();
  const call = (method, url, { headers = {}, payload } = {}) =>
    http.inject({ method, url, headers, payload });
  const suffix = randomBytes(3).toString('hex');
  const acme = `acme-${suffix}`;
  const globex = `globex-${suffix}`;

  try {
    // Onboarding and validation.
    assert.equal((await call('GET', '/api/orgs')).statusCode, 401);
    const created = await call('POST', '/api/orgs', {
      headers: alice,
      payload: { name: 'Acme', slug: acme },
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().role, 'owner');
    assert.equal(
      (
        await call('POST', '/api/orgs', {
          headers: bob,
          payload: { name: 'Dup', slug: acme },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await call('POST', '/api/orgs', {
          headers: bob,
          payload: { name: 'Bad', slug: 'Bad Slug' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await call('POST', '/api/orgs', {
          headers: bob,
          payload: { name: 'Globex', slug: globex },
        })
      ).statusCode,
      201,
    );
    assert.deepEqual(
      (await call('GET', '/api/orgs', { headers: alice }))
        .json()
        .map((o) => o.slug),
      [acme],
    );

    // Tenant isolation: non-members get 404, not 403, so org names don't leak.
    for (const url of [
      `/api/orgs/${acme}`,
      `/api/orgs/${acme}/governance/stats`,
      `/api/orgs/${acme}/services`,
    ])
      assert.equal(
        (await call('GET', url, { headers: bob })).statusCode,
        404,
        url,
      );

    // Services, consumers and keys.
    const service = await call('POST', `/api/orgs/${acme}/services`, {
      headers: alice,
      payload: {
        serviceName: 'user-service',
        baseUrl: upstreamUrl,
        upstreamHeaders: { 'x-upstream-token': 's3cret' },
      },
    });
    assert.equal(service.statusCode, 201, service.body);
    assert.deepEqual(service.json().upstreamHeaderNames, ['x-upstream-token']);
    assert.equal(JSON.stringify(service.json()).includes('s3cret'), false);
    const serviceId = service.json().id;
    const testConnection = await call(
      'POST',
      `/api/orgs/${acme}/services/${serviceId}/test`,
      { headers: alice },
    );
    assert.equal(testConnection.json().ok, true);

    const web = (
      await call('POST', `/api/orgs/${acme}/consumers`, {
        headers: alice,
        payload: { name: 'web', kind: 'frontend', serviceIds: [serviceId] },
      })
    ).json();
    const worker = (
      await call('POST', `/api/orgs/${acme}/consumers`, {
        headers: alice,
        payload: { name: 'worker', kind: 'backend' },
      })
    ).json();
    const webKey = (
      await call('POST', `/api/orgs/${acme}/consumers/${web.id}/keys`, {
        headers: alice,
        payload: { type: 'publishable', allowedOrigins: ['http://app.test'] },
      })
    ).json();
    assert.match(webKey.key, /^pk_/);
    assert.equal(
      (
        await call('POST', `/api/orgs/${acme}/consumers/${worker.id}/keys`, {
          headers: alice,
          payload: { type: 'publishable', allowedOrigins: ['http://x.test'] },
        })
      ).statusCode,
      400,
      'backend consumers only get secret keys',
    );
    const workerKey = (
      await call('POST', `/api/orgs/${acme}/consumers/${worker.id}/keys`, {
        headers: alice,
        payload: { type: 'secret' },
      })
    ).json();
    const listed = (
      await call('GET', `/api/orgs/${acme}/consumers`, { headers: alice })
    ).json();
    assert.equal(
      JSON.stringify(listed).includes(webKey.key),
      false,
      'keys are shown only once',
    );

    // Key enforcement on the proxy.
    const users = '/api/v1/user-service/users/7';
    const asWeb = {
      'x-orchestrator-key': webKey.key,
      origin: 'http://app.test',
    };
    const asWorker = { 'x-orchestrator-key': workerKey.key };
    assert.equal((await call('GET', users)).statusCode, 401);
    assert.equal(
      (
        await call('GET', users, {
          headers: { 'x-orchestrator-key': 'sk_forged' },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await call('GET', users, {
          headers: { 'x-orchestrator-key': webKey.key },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await call('GET', users, {
          headers: { ...asWeb, origin: 'http://evil.test' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await call('GET', users, { headers: asWeb })).statusCode,
      200,
    );
    assert.equal(
      (await call('GET', users, { headers: asWorker })).statusCode,
      403,
      'worker not granted yet',
    );
    await call('PATCH', `/api/orgs/${acme}/consumers/${worker.id}`, {
      headers: alice,
      payload: { serviceIds: [serviceId] },
    });
    assert.equal(
      (await call('GET', users, { headers: asWorker })).statusCode,
      200,
      'grant takes effect immediately',
    );

    // Bob's key cannot reach Acme's services.
    const bobConsumer = (
      await call('POST', `/api/orgs/${globex}/consumers`, {
        headers: bob,
        payload: { name: 'web', kind: 'backend' },
      })
    ).json();
    const bobKey = (
      await call(
        'POST',
        `/api/orgs/${globex}/consumers/${bobConsumer.id}/keys`,
        { headers: bob, payload: { type: 'secret' } },
      )
    ).json();
    assert.equal(
      (
        await call('GET', users, {
          headers: { 'x-orchestrator-key': bobKey.key },
        })
      ).statusCode,
      404,
    );

    // Per-consumer contracts: the worker only depends on `id`, so the rename doesn't affect it.
    await sleep(300);
    const contracts = (
      await call('GET', `/api/orgs/${acme}/governance/services/user-service`, {
        headers: alice,
      })
    ).json().contracts;
    assert.deepEqual(contracts.map((c) => c.consumerName).sort(), [
      'web',
      'worker',
    ]);
    const workerContract = contracts.find((c) => c.consumerName === 'worker');
    const pinned = await call(
      'PUT',
      `/api/orgs/${acme}/governance/contracts/${workerContract.id}/pins`,
      {
        headers: alice,
        payload: { required: ['id'], ignored: [] },
      },
    );
    assert.equal(pinned.statusCode, 200, pinned.body);

    drifted = true;
    await call('GET', users, { headers: { ...asWeb, 'x-mfe-canary': 'true' } });
    await call('GET', users, { headers: asWorker });
    let canary;
    for (let attempt = 0; attempt < 40 && !canary; attempt++) {
      await sleep(150);
      canary = (
        await call(
          'GET',
          `/api/orgs/${acme}/governance/patches?status=CANARY`,
          { headers: alice },
        )
      ).json()[0];
    }
    assert.ok(canary, 'a canary patch is generated for the web consumer');
    assert.equal(canary.contract.consumerName, 'web');
    const drift = (
      await call('GET', `/api/orgs/${acme}/governance/drift-events`, {
        headers: alice,
      })
    ).json().items;
    assert.deepEqual(
      drift.map((d) => d.contract.consumerName),
      ['web'],
      'pinned worker contract did not drift',
    );

    const healed = await call('GET', users, {
      headers: { ...asWeb, 'x-mfe-canary': 'true' },
    });
    assert.equal(healed.headers['x-orchestrator-healed'], 'true');
    assert.equal(healed.json().firstName, 'Ada');
    const workerResponse = await call('GET', users, {
      headers: { ...asWorker, 'x-mfe-canary': 'true' },
    });
    assert.equal(
      workerResponse.headers['x-orchestrator-healed'],
      undefined,
      "web's patch never applies to worker",
    );

    // Roles and invitations.
    const invite = await call('POST', `/api/orgs/${acme}/invitations`, {
      headers: alice,
      payload: { email: 'bob@globex.test', role: 'viewer' },
    });
    assert.equal(invite.statusCode, 201, invite.body);
    const token = invite.json().acceptUrl.split('/invite/')[1];
    assert.ok(
      invite.json().acceptUrl.startsWith('http://dashboard.test/invite/'),
    );
    assert.equal(
      (await call('GET', `/api/invitations/${token}`)).json().role,
      'viewer',
    );
    const carolInvite = (
      await call('POST', `/api/orgs/${acme}/invitations`, {
        headers: alice,
        payload: { email: 'carol@acme.test', role: 'admin' },
      })
    ).json();
    const carolToken = carolInvite.acceptUrl.split('/invite/')[1];
    assert.equal(
      (
        await call('POST', `/api/invitations/${carolToken}/accept`, {
          headers: bob,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await call('POST', `/api/invitations/${token}/accept`, { headers: bob }))
        .statusCode,
      200,
    );
    assert.equal(
      (await call('POST', `/api/invitations/${token}/accept`, { headers: bob }))
        .statusCode,
      410,
      'single use',
    );

    assert.equal(
      (
        await call('GET', `/api/orgs/${acme}/governance/stats`, {
          headers: bob,
        })
      ).statusCode,
      200,
    );
    const decision = { serviceName: 'user-service', notes: 'looks good' };
    assert.equal(
      (
        await call(
          'POST',
          `/api/orgs/${acme}/governance/patches/${canary.id}/promote`,
          { headers: bob, payload: decision },
        )
      ).statusCode,
      403,
      'viewers cannot promote',
    );
    assert.equal(
      (
        await call('POST', `/api/orgs/${acme}/services`, {
          headers: bob,
          payload: { serviceName: 'x', baseUrl: upstreamUrl },
        })
      ).statusCode,
      403,
    );
    const members = (
      await call('GET', `/api/orgs/${acme}/members`, { headers: alice })
    ).json();
    const aliceMember = members.find((m) => m.email === 'alice@acme.test');
    assert.equal(
      (
        await call('PATCH', `/api/orgs/${acme}/members/${aliceMember.id}`, {
          headers: alice,
          payload: { role: 'viewer' },
        })
      ).statusCode,
      409,
      'the last owner cannot be demoted',
    );

    const promoted = await call(
      'POST',
      `/api/orgs/${acme}/governance/patches/${canary.id}/promote`,
      {
        headers: alice,
        payload: decision,
      },
    );
    assert.equal(promoted.statusCode, 201, promoted.body);
    const audits = (
      await call('GET', `/api/orgs/${acme}/governance/audits`, {
        headers: alice,
      })
    ).json();
    assert.equal(audits[0].reviewer, 'alice@acme.test');

    // Browser runtime patches for the consumer.
    const remoteEntry = await call(
      'GET',
      `/patches/remoteEntry.js?service=user-service&key=${webKey.key}`,
      {
        headers: { origin: 'http://app.test' },
      },
    );
    assert.equal(remoteEntry.statusCode, 200);
    assert.match(remoteEntry.body, /GET \/api\/v1\/users\/:id/);

    // CORS: consumer routes reflect origins (keys decide), the management API does not.
    const consumerPreflight = await call('OPTIONS', users, {
      headers: {
        origin: 'http://app.test',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-orchestrator-key',
      },
    });
    assert.equal(
      consumerPreflight.headers['access-control-allow-origin'],
      'http://app.test',
    );
    const apiPreflight = await call('OPTIONS', `/api/orgs/${acme}`, {
      headers: {
        origin: 'http://evil.test',
        'access-control-request-method': 'GET',
      },
    });
    assert.equal(
      apiPreflight.headers['access-control-allow-origin'],
      undefined,
    );

    // Revoked keys stop working immediately; the admin trail records it.
    await call(
      'DELETE',
      `/api/orgs/${acme}/consumers/${worker.id}/keys/${workerKey.id}`,
      { headers: alice },
    );
    assert.equal(
      (await call('GET', users, { headers: asWorker })).statusCode,
      401,
    );
    const activity = (
      await call('GET', `/api/orgs/${acme}/activity`, { headers: alice })
    )
      .json()
      .map((a) => a.action);
    for (const action of [
      'org.created',
      'service.created',
      'key.issued',
      'key.revoked',
      'member.invited',
      'member.joined',
    ])
      assert.ok(activity.includes(action), action);

    // A restarted gateway restores the promoted patch from Postgres.
    await app.close();
    app = await createGateway({ logger: false, shutdownHooks: false });
    http = app.getHttpAdapter().getInstance();
    const afterRestart = await call('GET', users, {
      headers: { ...asWeb, 'x-mfe-canary': 'false' },
    });
    assert.equal(afterRestart.headers['x-orchestrator-healed'], 'true');
  } finally {
    await app.close();
  }
});
