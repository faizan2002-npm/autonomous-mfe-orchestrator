import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultChannels, toMessage } from './messages.js';
import { invitationEmail, notificationEmail } from './templates.js';
import { signWebhook, verifyWebhook } from './webhook-signature.js';

const contract = {
  serviceName: 'user-service',
  httpMethod: 'GET',
  endpointPath: '/api/v1/users/:id',
  consumerId: 'c1',
  consumerName: 'checkout-web',
};

test('pipeline events map to notifications for the right audience', () => {
  const breaking = toMessage({
    type: 'drift.detected',
    at: '',
    orgId: 'o',
    driftEventId: 'd1',
    contract,
    driftType: 'FIELD_RENAMED',
    severity: 'CRITICAL',
    coefficient: 0.42,
    isBreaking: true,
  });
  assert.equal(breaking?.event, 'drift.breaking');
  assert.equal(breaking?.audience, 'reviewers');
  assert.equal(breaking?.path, '/drift/d1');
  assert.match(breaking!.body, /checkout-web/);
  assert.equal(
    toMessage({
      type: 'drift.detected',
      at: '',
      orgId: 'o',
      driftEventId: 'd2',
      contract,
      driftType: 'FIELD_ADDED',
      severity: 'LOW',
      coefficient: 0.2,
      isBreaking: false,
    }),
    null,
    'non-breaking drift is not worth a notification',
  );
  const deployed = toMessage({ type: 'patch.deployed', at: '', orgId: 'o', patchId: 'p1', contract, canaryPercent: 10 });
  assert.equal(deployed?.event, 'patch.awaiting_review');
  assert.equal(toMessage({ type: 'request.proxied', at: '', orgId: 'o', contract, status: 200, isPatched: true }), null);
});

test('defaults: reviewers get email and push for actionable events, viewers only the inbox', () => {
  assert.deepEqual(defaultChannels('reviewer', 'patch.awaiting_review'), ['email', 'push']);
  assert.deepEqual(defaultChannels('owner', 'patch.promoted'), []);
  assert.deepEqual(defaultChannels('viewer', 'drift.breaking'), []);
});

test('emails escape untrusted text and carry a plain-text part', () => {
  const email = notificationEmail({
    orgName: 'Acme <script>',
    title: 'Patch ready',
    body: 'Field "a" & <b>',
    url: 'http://localhost:5100/o/acme/patches/1',
    settingsUrl: 'http://localhost:5100/o/acme/notifications',
  });
  assert.equal(email.subject, '[Acme <script>] Patch ready');
  assert.doesNotMatch(email.html, /<script>|<b>/);
  assert.match(email.html, /&lt;b&gt;/);
  assert.match(email.text, /Open: http:\/\/localhost:5100\/o\/acme\/patches\/1/);
  assert.match(invitationEmail({ orgName: 'Acme', role: 'reviewer', invitedBy: 'a@x.test', acceptUrl: 'http://x/invite/t' }).html, /Accept invitation/);
});

test('webhook signatures verify, and reject tampering, wrong secrets and replays', () => {
  const body = JSON.stringify({ type: 'patch.awaiting_review' });
  const header = signWebhook(body, 'whsec_1', 1_000);
  assert.equal(verifyWebhook(body, header, 'whsec_1', 300, 1_100), true);
  assert.equal(verifyWebhook(`${body} `, header, 'whsec_1', 300, 1_100), false);
  assert.equal(verifyWebhook(body, header, 'whsec_2', 300, 1_100), false);
  assert.equal(verifyWebhook(body, header, 'whsec_1', 300, 2_000), false);
});
