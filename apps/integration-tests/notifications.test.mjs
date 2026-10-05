// Notifications end to end: invitation email, inbox fan-out by role, signed webhooks and
// encrypted web push to a local push service, all through real Nest wiring and Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import postgres from 'postgres';
import webPush from 'web-push';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
assert.ok(databaseUrl && redisUrl, 'Use disposable TEST_DATABASE_URL and TEST_REDIS_URL services');

const listen = async (server) => {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${server.address().port}`;
};
const readBody = async (req) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
};

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
const alice = await signIn('00000000-0000-4000-8000-0000000000a1', 'alice@notify.test');
const bob = await signIn('00000000-0000-4000-8000-0000000000b2', 'bob@notify.test');

let drifted = false;
const upstream = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(drifted ? { id: 1, first_name: 'Ada' } : { id: 1, firstName: 'Ada' }));
});
const upstreamUrl = await listen(upstream);

const webhookCalls = [];
let webhookStatus = 200;
const webhookReceiver = createServer(async (req, res) => {
  webhookCalls.push({ headers: req.headers, body: await readBody(req) });
  res.writeHead(webhookStatus);
  res.end();
});
const webhookUrl = await listen(webhookReceiver);

// Push services are HTTPS-only, so the stand-in uses a throwaway self-signed certificate.
const pem = execFileSync('openssl', [
  'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
  '-keyout', '-', '-out', '-', '-subj', '/CN=127.0.0.1', '-days', '1',
], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pushCalls = [];
const pushService = createTlsServer({ key: pem, cert: pem }, async (req, res) => {
  pushCalls.push({ url: req.url, headers: req.headers, bytes: (await readBody(req)).length });
  res.writeHead(req.url === '/gone' ? 410 : 201);
  res.end();
});
const pushServiceUrl = (await listen(pushService)).replace('http:', 'https:');

const vapid = webPush.generateVAPIDKeys();
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  SUPABASE_URL: supabaseUrl,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  KEY_PEPPER: randomBytes(32).toString('base64'),
  ALLOW_PRIVATE_UPSTREAMS: 'true',
  APP_URL: 'http://dashboard.test',
  EMAIL_PROVIDER: 'log',
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'mailto:ops@notify.test',
  GEMINI_API_KEY: '',
});

const gatewayRoot = resolve(import.meta.dirname, '../api-gateway');
const { createGateway } = await import(pathToFileURL(`${gatewayRoot}/dist/application.js`).href);
const { OutboxWorker } = await import(pathToFileURL(`${gatewayRoot}/dist/notifications/outbox.worker.js`).href);
const { verifyWebhook } = await import(pathToFileURL(`${gatewayRoot}/dist/notifications/webhook-signature.js`).href);

test.after(() => {
  for (const server of [authServer, upstream, webhookReceiver, pushService]) {
    server.closeAllConnections();
    server.close();
  }
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A browser-shaped push subscription with real P-256 keys, pointing at the local push service. */
function browserSubscription(path) {
  const keys = createECDH('prime256v1');
  keys.generateKeys();
  return {
    endpoint: `${pushServiceUrl}${path}`,
    keys: { p256dh: keys.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

test('notifications: invitation email, inbox fan-out, signed webhooks and web push', async () => {
  const setup = postgres(databaseUrl, { onnotice: () => {} });
  await migrate(drizzle(setup), { migrationsFolder: resolve(gatewayRoot, '../../packages/database/migrations') });
  await setup.end();

  const app = await createGateway({ logger: false, shutdownHooks: false });
  const http = app.getHttpAdapter().getInstance();
  const worker = app.get(OutboxWorker);
  const call = (method, url, { headers = {}, payload } = {}) => http.inject({ method, url, headers, payload });
  const drainUntil = async (condition) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      await worker.drain();
      if (await condition()) return;
      await sleep(150);
    }
    const sql = postgres(databaseUrl, { onnotice: () => {} });
    const outbox = await sql`select channel, status, attempts, last_error from notification_deliveries`;
    const inbox = await sql`select event, user_id from notifications`;
    await sql.end();
    assert.fail(
      `deliveries did not arrive: webhooks=${webhookCalls.length} pushes=${pushCalls.length}\n` +
        `outbox=${JSON.stringify(outbox)}\ninbox=${JSON.stringify(inbox)}`,
    );
  };
  const slug = `notify-${randomBytes(3).toString('hex')}`;
  const org = `/api/orgs/${slug}`;

  try {
    assert.deepEqual((await call('GET', '/api/push/config')).json(), { enabled: true, publicKey: vapid.publicKey });
    await call('POST', '/api/orgs', { headers: alice, payload: { name: 'Notify Inc', slug } });

    // Invitation email carries a working link.
    const invite = (await call('POST', `${org}/invitations`, { headers: alice, payload: { email: 'bob@notify.test', role: 'reviewer' } })).json();
    await drainUntil(() => worker.email.sent.some((m) => m.to === 'bob@notify.test'));
    const invitationEmail = worker.email.sent.find((m) => m.to === 'bob@notify.test');
    assert.match(invitationEmail.subject, /Join Notify Inc/);
    assert.ok(invitationEmail.text.includes(invite.acceptUrl));
    const token = invite.acceptUrl.split('/invite/')[1];
    assert.equal((await call('POST', `/api/invitations/${token}/accept`, { headers: bob })).statusCode, 200);

    // Bob enables push on two devices; one has since been unsubscribed by the browser (410).
    for (const path of ['/device', '/gone'])
      assert.equal(
        (await call('POST', '/api/push/subscriptions', { headers: bob, payload: browserSubscription(path) })).statusCode,
        204,
      );

    // An org webhook for review events, with a signing secret shown once.
    const endpoint = (
      await call('POST', `${org}/notifications/endpoints`, {
        headers: alice,
        payload: { type: 'webhook', name: 'ops-hook', url: `${webhookUrl}/hooks/mfe`, events: ['patch.awaiting_review'] },
      })
    ).json();
    assert.match(endpoint.signingSecret, /^whsec_/);
    assert.equal(endpoint.urlHost, new URL(webhookUrl).host);
    assert.equal(JSON.stringify((await call('GET', `${org}/notifications/endpoints`, { headers: alice })).json()).includes('whsec_'), false);
    assert.equal((await call('GET', `${org}/notifications/endpoints`, { headers: bob })).statusCode, 403, 'admins only');

    // Preferences: alice turns off push for drift (she has no devices anyway); defaults otherwise.
    const prefs = await call('PUT', `${org}/notifications/preferences`, {
      headers: alice,
      payload: { preferences: [{ event: 'drift.breaking', channels: ['email'] }] },
    });
    assert.deepEqual(prefs.json()['drift.breaking'], ['email']);
    assert.deepEqual(prefs.json()['patch.awaiting_review'], ['email', 'push'], 'defaults for reviewers and up');

    // Traffic, then drift: the pipeline produces drift.detected and patch.deployed.
    const service = (await call('POST', `${org}/services`, { headers: alice, payload: { serviceName: 'users', baseUrl: upstreamUrl } })).json();
    const consumer = (await call('POST', `${org}/consumers`, { headers: alice, payload: { name: 'worker', kind: 'backend', serviceIds: [service.id] } })).json();
    const key = (await call('POST', `${org}/consumers/${consumer.id}/keys`, { headers: alice, payload: { type: 'secret' } })).json().key;
    await call('GET', '/api/v1/users/users/1', { headers: { 'x-orchestrator-key': key } });
    await sleep(200);
    drifted = true;
    await call('GET', '/api/v1/users/users/1', { headers: { 'x-orchestrator-key': key } });

    await drainUntil(() => webhookCalls.length >= 1 && pushCalls.length >= 2);

    // Inbox: both reviewers, newest first, with dashboard links.
    for (const member of [alice, bob]) {
      const inbox = (await call('GET', `${org}/notifications`, { headers: member })).json();
      const events = inbox.items.map((n) => n.event);
      assert.ok(events.includes('drift.breaking') && events.includes('patch.awaiting_review'), events.join());
      assert.ok(inbox.unreadCount >= 2);
      assert.match(inbox.items.find((n) => n.event === 'patch.awaiting_review').link, new RegExp(`^/o/${slug}/patches/`));
    }

    // Email: both reviewers hear about the patch awaiting review.
    for (const email of ['alice@notify.test', 'bob@notify.test'])
      assert.ok(worker.email.sent.some((m) => m.to === email && /Patch ready for review/.test(m.subject)), email);

    // Webhook: signed with the endpoint's secret, verifiable by the receiver.
    const hook = webhookCalls[0];
    assert.equal(hook.headers['x-orchestrator-event'], 'patch.awaiting_review');
    assert.equal(verifyWebhook(hook.body, hook.headers['x-orchestrator-signature'], endpoint.signingSecret), true);
    assert.equal(JSON.parse(hook.body).organization, 'Notify Inc');

    // Push: encrypted (aes128gcm) and VAPID-signed; the gone device is pruned.
    const devicePush = pushCalls.find((c) => c.url === '/device');
    assert.equal(devicePush.headers['content-encoding'], 'aes128gcm');
    assert.match(devicePush.headers.authorization, /^vapid t=/);
    await drainUntil(async () => pushCalls.filter((c) => c.url === '/gone').length >= 1);
    const sql = postgres(databaseUrl, { onnotice: () => {} });
    const remaining = await sql`select endpoint from push_subscriptions where user_id = '00000000-0000-4000-8000-0000000000b2'`;
    await sql.end();
    assert.deepEqual(remaining.map((r) => new URL(r.endpoint).pathname), ['/device']);

    // Delivery log, retry on failure and redelivery.
    const log = (await call('GET', `${org}/notifications/deliveries?endpointId=${endpoint.id}`, { headers: alice })).json();
    assert.equal(log[0].status, 'sent');
    webhookStatus = 500;
    await call('POST', `${org}/notifications/endpoints/${endpoint.id}/test`, { headers: alice });
    await worker.drain();
    const retrying = (await call('GET', `${org}/notifications/deliveries?endpointId=${endpoint.id}`, { headers: alice })).json()[0];
    assert.equal(retrying.status, 'pending');
    assert.match(retrying.lastError, /500/);
    webhookStatus = 200;
    await call('POST', `${org}/notifications/deliveries/${retrying.id}/redeliver`, { headers: alice });
    await drainUntil(async () => (await call('GET', `${org}/notifications/deliveries?endpointId=${endpoint.id}`, { headers: alice })).json()[0].status === 'sent');

    // Mark read.
    assert.equal((await call('POST', `${org}/notifications/read`, { headers: bob, payload: {} })).statusCode, 204);
    assert.equal((await call('GET', `${org}/notifications`, { headers: bob })).json().unreadCount, 0);
  } finally {
    await app.close();
  }
});
