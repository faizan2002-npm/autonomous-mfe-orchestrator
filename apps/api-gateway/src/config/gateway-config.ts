import { getDatabaseUrl, getRedisUrl } from '@orchestrator/config';
import { parseKey } from '@orchestrator/crypto';

export const GATEWAY_CONFIG = Symbol('GATEWAY_CONFIG');

export interface GatewayConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** Drift coefficient above which a response counts as drifted (0..1). */
  driftThreshold: number;
  /** Share of traffic a freshly deployed patch receives before promotion (0..100). */
  canaryPercent: number;
  /** No apiKey means adapters come from the deterministic fallback only. */
  gemini: { apiKey?: string; model: string };
  /** Supabase project URL whose Auth issues dashboard tokens; unset disables sign-in. */
  supabaseUrl?: string;
  /** Browser origins allowed to call the gateway (dashboard, shell, remotes). */
  allowedOrigins: string[];
  /** Public URL of the dashboard, used in invitation and notification links. */
  appUrl: string;
  /** AES-256-GCM key for secrets stored in the database. */
  encryptionKey: Buffer;
  /** HMAC pepper for API keys and invitation tokens. */
  keyPepper: Buffer;
  /** Lets org services point at private addresses (local development and demos only). */
  allowPrivateUpstreams: boolean;
  /** Proxied requests allowed per API key per minute. */
  rateLimitPerMinute: number;
  email: EmailConfig;
  /** Web push; disabled unless a VAPID key pair is configured. */
  push: { publicKey: string; privateKey: string; subject: string } | null;
}

export type EmailConfig =
  | { provider: 'log'; from: string }
  | { provider: 'resend'; from: string; resendApiKey: string }
  | { provider: 'smtp'; from: string; smtpUrl: string };

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5100',
  'http://localhost:5000',
  'http://localhost:5001',
  'http://localhost:5002',
];

type Environment = Readonly<Record<string, string | undefined>>;

/** Validates the environment once at startup so misconfiguration fails fast. */
export function loadGatewayConfig(env: Environment): GatewayConfig {
  const databaseUrl = getDatabaseUrl(env);
  const redisUrl = getRedisUrl(env);
  requireProtocol('DATABASE_URL', databaseUrl, ['postgres:', 'postgresql:']);
  requireProtocol('REDIS_URL', redisUrl, ['redis:', 'rediss:']);
  const supabaseUrl = readSupabaseUrl(env);
  const allowedOrigins = env.ALLOWED_ORIGINS?.trim()
    ? env.ALLOWED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
  for (const origin of allowedOrigins)
    requireProtocol('ALLOWED_ORIGINS', origin, ['http:', 'https:']);

  return {
    port: readNumber(env, 'GATEWAY_PORT', 4000, 1, 65535, true),
    databaseUrl,
    redisUrl,
    driftThreshold: readNumber(env, 'DRIFT_SIMILARITY_THRESHOLD', 0.15, 0, 1),
    canaryPercent: readNumber(env, 'CANARY_TRAFFIC_PERCENTAGE', 10, 0, 100),
    gemini: {
      apiKey: env.GEMINI_API_KEY?.trim() || undefined,
      model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    },
    supabaseUrl,
    allowedOrigins,
    appUrl: readUrl(env, 'APP_URL', 'http://localhost:5100'),
    encryptionKey: parseKey('ENCRYPTION_KEY', env.ENCRYPTION_KEY),
    keyPepper: parseKey('KEY_PEPPER', env.KEY_PEPPER),
    allowPrivateUpstreams: readBoolean(env, 'ALLOW_PRIVATE_UPSTREAMS'),
    rateLimitPerMinute: readNumber(
      env,
      'RATE_LIMIT_PER_MINUTE',
      600,
      1,
      1_000_000,
      true,
    ),
    email: readEmail(env),
    push: readPush(env),
  };
}

function readEmail(env: Environment): EmailConfig {
  const provider = env.EMAIL_PROVIDER?.trim() || 'log';
  const from = env.EMAIL_FROM?.trim() || 'MFE Orchestrator <onboarding@resend.dev>';
  if (provider === 'log') return { provider, from };
  if (provider === 'resend') {
    const resendApiKey = env.RESEND_API_KEY?.trim();
    if (!resendApiKey) throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
    return { provider, from, resendApiKey };
  }
  if (provider === 'smtp') {
    const smtpUrl = env.SMTP_URL?.trim();
    if (!smtpUrl) throw new Error('SMTP_URL is required when EMAIL_PROVIDER=smtp');
    requireProtocol('SMTP_URL', smtpUrl, ['smtp:', 'smtps:']);
    return { provider, from, smtpUrl };
  }
  throw new Error('EMAIL_PROVIDER must be log, resend or smtp');
}

function readPush(env: Environment): GatewayConfig['push'] {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey)
    throw new Error('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys)');
  const subject = env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.com';
  if (!/^(mailto:|https:)/.test(subject)) throw new Error('VAPID_SUBJECT must be a mailto: or https: URL');
  return { publicKey, privateKey, subject };
}

function readUrl(env: Environment, name: string, fallback: string): string {
  const url = env[name]?.trim() || fallback;
  requireProtocol(name, url, ['http:', 'https:']);
  return url.replace(/\/$/, '');
}

function readBoolean(env: Environment, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return false;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${name} must be true or false`);
}

/** SUPABASE_URL wins; otherwise it is derived from the project ref used for the database. */
function readSupabaseUrl(env: Environment): string | undefined {
  const url =
    env.SUPABASE_URL?.trim() ||
    (env.SUPABASE_PROJECT_REF
      ? `https://${env.SUPABASE_PROJECT_REF}.supabase.co`
      : '');
  if (!url) return undefined;
  requireProtocol('SUPABASE_URL', url, ['http:', 'https:']);
  return url.replace(/\/$/, '');
}

function readNumber(
  env: Environment,
  name: string,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`,
    );
  }
  return value;
}

function requireProtocol(name: string, url: string, protocols: string[]): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(protocol)) {
    throw new Error(
      `${name} must use ${protocols.map((p) => `${p}//`).join(' or ')}`,
    );
  }
}
