// Promotion policies: the evaluator promotes healthy canary patches and rolls back failing
// ones through the audited governance paths, under a cluster-wide Redis lock.
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
assert.ok(databaseUrl && redisUrl, 'Use disposable TEST_DATABASE_URL and TEST_REDIS_URL services');

const listen = async (server) => {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${server.address().port}`;
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' }] };
const authServer = createServer((_req, res) => res.end(JSON.stringify(jwks)));
const supabaseUrl = await listen(authServer);
const signIn = async (id, email) => ({
  authorization: `Bearer ${await new SignJWT({ email })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setSubject(id)
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setAudience('authenticated')
    .setExpirationTime('10m')
    .sign(privateKey)}`,
});
const owner = await signIn('00000000-0000-4000-8000-0000000000c1', 'owner@policy.test');
const reviewer = await signIn('00000000-0000-4000-8000-0000000000c2', 'reviewer@policy.test');

let drifted = false;
const upstream = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(drifted ? { id: 1, first_name: 'Ada' } : { id: 1, firstName: 'Ada' }));
});
const upstreamUrl = await listen(upstream);

Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  SUPABASE_URL: supabaseUrl,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  KEY_PEPPER: randomBytes(32).toString('base64'),
  ALLOW_PRIVATE_UPSTREAMS: 'true',
  EMAIL_PROVIDER: 'log',
  GEMINI_API_KEY: '',
});

const gatewayRoot = resolve(import.meta.dirname, '../api-gateway');
const { createGateway } = await import(pathToFileURL(`${gatewayRoot}/dist/application.js`).href);
const { PolicyEvaluator } = await import(pathToFileURL(`${gatewayRoot}/dist/policies/policy-evaluator.js`).href);
const { CanaryMetricsService } = await import(pathToFileURL(`${gatewayRoot}/dist/canary/canary-metrics.service.js`).href);

test.after(() => {
  for (const server of [authServer, upstream]) {
    server.closeAllConnections();
    server.close();
  }
});

test('promotion policies: auto-promote, auto-rollback, scoping, roles and a single evaluator', async () => {
  const setup = postgres(databaseUrl, { onnotice: () => {} });
  await migrate(drizzle(setup), { migrationsFolder: resolve(gatewayRoot, '../../packages/database/migrations') });
  await setup.end();

  const app = await createGateway({ logger: false, shutdownHooks: false });
  const http = app.getHttpAdapter().getInstance();
  const evaluator = app.get(PolicyEvaluator);
  const metrics = app.get(CanaryMetricsService);
  const call = (method, url, { headers = {}, payload } = {}) => http.inject({ method, url, headers, payload });
  const slug = `policy-${randomBytes(3).toString('hex')}`;
  const org = `/api/orgs/${slug}`;
  const canaryFor = async (consumerName) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const patch = (await call('GET', `${org}/governance/patches?status=CANARY`, { headers: owner }))
        .json()
        .find((p) => p.contract.consumerName === consumerName);
      if (patch) return patch;
      await sleep(150);
    }
    assert.fail(`no canary patch for ${consumerName}`);
  };

  try {
    await call('POST', '/api/orgs', { headers: owner, payload: { name: 'Policy Co', slug } });
    const invite = (await call('POST', `${org}/invitations`, { headers: owner, payload: { email: 'reviewer@policy.test', role: 'reviewer' } })).json();
    await call('POST', `/api/invitations/${invite.acceptUrl.split('/invite/')[1]}/accept`, { headers: reviewer });

    const service = (await call('POST', `${org}/services`, { headers: owner, payload: { serviceName: 'users', baseUrl: upstreamUrl } })).json();
    const keyFor = async (name) => {
      const consumer = (await call('POST', `${org}/consumers`, { headers: owner, payload: { name, kind: 'backend', serviceIds: [service.id] } })).json();
      const { key } = (await call('POST', `${org}/consumers/${consumer.id}/keys`, { headers: owner, payload: { type: 'secret' } })).json();
      return { consumer, headers: { 'x-orchestrator-key': key, 'x-mfe-canary': 'true' } };
    };
    const steady = await keyFor('steady');
    const flaky = await keyFor('flaky');

    // Policies: an org default that promotes after 3 healed requests, and a stricter one for
    // the flaky consumer that never promotes but rolls back on failures.
    const orgDefault = await call('POST', `${org}/policies`, {
      headers: owner,
      payload: { name: 'Fast lane', minCanaryRequests: 3, minCanaryMinutes: 0, maxFailureRate: 0.1 },
    });
    assert.equal(orgDefault.statusCode, 201, orgDefault.body);
    assert.deepEqual(orgDefault.json().allowedGenerators, ['gemini', 'fallback']);
    const strict = await call('POST', `${org}/policies`, {
      headers: owner,
      payload: {
        name: 'Flaky guard',
        consumerId: flaky.consumer.id,
        minCanaryRequests: 1000,
        rollbackFailureRate: 0.5,
        rollbackMinRequests: 4,
      },
    });
    assert.equal(strict.statusCode, 201, strict.body);
    assert.equal(strict.json().consumerName, 'flaky');

    // Validation, uniqueness, roles.
    assert.equal((await call('POST', `${org}/policies`, { headers: owner, payload: { name: 'Again' } })).statusCode, 409);
    assert.equal(
      (await call('POST', `${org}/policies`, { headers: owner, payload: { name: 'Bad', maxFailureRate: 2 } })).statusCode,
      400,
    );
    assert.equal(
      (await call('POST', `${org}/policies`, { headers: owner, payload: { name: 'Elsewhere', consumerId: '00000000-0000-4000-8000-000000000999' } })).statusCode,
      400,
    );
    assert.equal((await call('POST', `${org}/policies`, { headers: reviewer, payload: { name: 'Mine' } })).statusCode, 403);
    assert.equal((await call('GET', `${org}/policies`, { headers: reviewer })).json().length, 2);

    // Baselines for both consumers, then drift: each gets its own canary patch.
    for (const consumer of [steady, flaky]) await call('GET', '/api/v1/users/users/1', { headers: consumer.headers });
    await sleep(200);
    drifted = true;
    for (const consumer of [steady, flaky]) await call('GET', '/api/v1/users/users/1', { headers: consumer.headers });
    const steadyPatch = await canaryFor('steady');
    const flakyPatch = await canaryFor('flaky');

    // Not enough evidence yet.
    let outlook = (await call('GET', `${org}/policies/outlook`, { headers: reviewer })).json();
    const steadyOutlook = outlook.find((o) => o.patchId === steadyPatch.id);
    assert.equal(steadyOutlook.policy.name, 'Fast lane');
    assert.equal(steadyOutlook.decision.action, 'wait');
    assert.equal(outlook.find((o) => o.patchId === flakyPatch.id).policy.name, 'Flaky guard', 'most specific policy wins');

    // Healed canary traffic for steady; mostly adapter failures for flaky (3 of 4).
    for (let i = 0; i < 3; i++) await call('GET', '/api/v1/users/users/1', { headers: steady.headers });
    await call('GET', '/api/v1/users/users/1', { headers: flaky.headers });
    for (let i = 0; i < 3; i++) metrics.record(flakyPatch.id, 'adapterFailure');
    await sleep(200);
    outlook = (await call('GET', `${org}/policies/outlook`, { headers: owner })).json();
    assert.equal(outlook.find((o) => o.patchId === steadyPatch.id).decision.action, 'promote');
    assert.equal(outlook.find((o) => o.patchId === flakyPatch.id).decision.action, 'rollback');

    // Two instances evaluating at once: the lock lets exactly one run.
    const [first, second] = await Promise.all([evaluator.run(), evaluator.run()]);
    const results = first ?? second;
    assert.ok((first === undefined) !== (second === undefined), 'exactly one evaluator ran');
    assert.deepEqual(
      results.filter((r) => r.applied).map((r) => [r.policy, r.decision.action]).sort(),
      [
        ['Fast lane', 'promote'],
        ['Flaky guard', 'rollback'],
      ],
    );

    const statusOf = async (id) => (await call('GET', `${org}/governance/patches/${id}`, { headers: owner })).json().status;
    assert.equal(await statusOf(steadyPatch.id), 'ACTIVE');
    assert.equal(await statusOf(flakyPatch.id), 'ROLLED_BACK');

    // Audited as the policy, with its reasoning, and the evidence snapshotted.
    const audits = (await call('GET', `${org}/governance/audits`, { headers: owner })).json();
    const promotion = audits.find((a) => a.patchId === steadyPatch.id && a.status === 'APPROVED');
    assert.equal(promotion.reviewer, 'policy:Fast lane');
    assert.match(promotion.reasoningTrace, /3 canary requests/);
    assert.equal(audits.find((a) => a.patchId === flakyPatch.id && a.status === 'REJECTED').reviewer, 'policy:Flaky guard');
    const sql = postgres(databaseUrl, { onnotice: () => {} });
    const snapshots = await sql`select patch_id, promoted, canary_requests, canary_errors from canary_metrics
      where patch_id in (${steadyPatch.id}, ${flakyPatch.id}) order by promoted desc`;
    await sql.end();
    assert.deepEqual(
      snapshots.map((s) => [s.patch_id, s.promoted, s.canary_requests, s.canary_errors]),
      [
        [steadyPatch.id, true, 3, 0],
        [flakyPatch.id, false, 4, 3],
      ],
    );

    // Members are told it was the policy, and nothing is left to evaluate.
    await sleep(200);
    const titles = (await call('GET', `${org}/notifications`, { headers: reviewer })).json().items.map((n) => n.title);
    assert.ok(titles.includes('Patch promoted by policy: users'), titles.join());
    assert.ok(titles.includes('Patch rolled back by policy: users'), titles.join());
    assert.deepEqual((await evaluator.run()) ?? [], []);
    assert.deepEqual((await call('GET', `${org}/policies/outlook`, { headers: owner })).json(), []);

    // Disable and delete.
    const id = orgDefault.json().id;
    assert.equal((await call('PATCH', `${org}/policies/${id}`, { headers: owner, payload: { enabled: false } })).json().enabled, false);
    assert.equal((await call('DELETE', `${org}/policies/${id}`, { headers: owner })).statusCode, 204);
    assert.equal((await call('GET', `${org}/policies`, { headers: owner })).json().length, 1);
  } finally {
    await app.close();
  }
});
