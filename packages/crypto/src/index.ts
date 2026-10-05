import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

/** Parses a base64-encoded 32-byte key, as produced by `openssl rand -base64 32`. */
export function parseKey(name: string, value: string | undefined): Buffer {
  if (!value)
    throw new Error(
      `${name} is required (generate one with: openssl rand -base64 32)`,
    );
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32)
    throw new Error(`${name} must be 32 bytes, base64-encoded`);
  return key;
}

/** Authenticated encryption for secrets at rest: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    )
    .join('.');
}

export function decryptSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined)
    throw new Error('Unrecognized encrypted value');
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Keyed hash for API keys and invitation tokens. A database leak alone cannot be used
 * to verify guesses without the pepper.
 */
export function hashToken(token: string, pepper: Buffer): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

export function tokensMatch(
  token: string,
  expectedHash: string,
  pepper: Buffer,
): boolean {
  const actual = Buffer.from(hashToken(token, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type ApiKeyKind = 'publishable' | 'secret';

const KEY_PREFIX: Record<ApiKeyKind, string> = {
  publishable: 'pk_',
  secret: 'sk_',
};

/** A new consumer API key. `display` is safe to store and show; `key` is shown once. */
export function generateApiKey(kind: ApiKeyKind): {
  key: string;
  display: string;
} {
  const key = `${KEY_PREFIX[kind]}${randomBytes(24).toString('base64url')}`;
  return { key, display: `${key.slice(0, 10)}…` };
}

export function apiKeyKind(key: string): ApiKeyKind | null {
  if (key.startsWith('pk_')) return 'publishable';
  if (key.startsWith('sk_')) return 'secret';
  return null;
}

/** Opaque single-use token for invitation links. */
export const randomToken = () => randomBytes(32).toString('base64url');
