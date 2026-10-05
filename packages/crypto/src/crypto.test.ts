import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  apiKeyKind,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  hashToken,
  parseKey,
  tokensMatch,
} from './index.js';

const key = randomBytes(32);

test('secrets round-trip and tampering is detected', () => {
  const sealed = encryptSecret('Authorization: Bearer upstream', key);
  assert.notEqual(sealed, encryptSecret('Authorization: Bearer upstream', key));
  assert.equal(decryptSecret(sealed, key), 'Authorization: Bearer upstream');
  const parts = sealed.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.'), key));
  assert.throws(() => decryptSecret(sealed, randomBytes(32)));
});

test('keys are typed by prefix and only verify with the right pepper', () => {
  const { key: apiKey, display } = generateApiKey('secret');
  assert.equal(apiKeyKind(apiKey), 'secret');
  assert.equal(apiKeyKind(generateApiKey('publishable').key), 'publishable');
  assert.equal(apiKeyKind('nope'), null);
  assert.ok(display.startsWith('sk_') && display.length < apiKey.length);
  const pepper = randomBytes(32);
  const stored = hashToken(apiKey, pepper);
  assert.equal(tokensMatch(apiKey, stored, pepper), true);
  assert.equal(tokensMatch(`${apiKey}x`, stored, pepper), false);
  assert.equal(tokensMatch(apiKey, stored, randomBytes(32)), false);
});

test('configuration keys must be 32 bytes', () => {
  assert.equal(parseKey('K', key.toString('base64')).length, 32);
  assert.throws(() => parseKey('K', undefined), /K is required/);
  assert.throws(
    () => parseKey('K', randomBytes(16).toString('base64')),
    /32 bytes/,
  );
});
