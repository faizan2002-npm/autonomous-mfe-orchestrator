import {
  getDatabaseUrl,
  getRedisUrl,
  getServiceEndpoints,
} from '@orchestrator/config';

export const GATEWAY_CONFIG = Symbol('GATEWAY_CONFIG');

export interface GatewayConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  serviceEndpoints: Readonly<Record<string, string>>;
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
}

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
    serviceEndpoints: getServiceEndpoints(env),
    driftThreshold: readNumber(env, 'DRIFT_SIMILARITY_THRESHOLD', 0.15, 0, 1),
    canaryPercent: readNumber(env, 'CANARY_TRAFFIC_PERCENTAGE', 10, 0, 100),
    gemini: {
      apiKey: env.GEMINI_API_KEY?.trim() || undefined,
      model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    },
    supabaseUrl,
    allowedOrigins,
  };
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
