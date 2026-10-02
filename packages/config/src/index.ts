/** Shared connection settings, evaluated when configuration is requested. */
type Environment = Readonly<Record<string, string | undefined>>;

// Supabase pooler ports: transaction mode for app traffic, session mode for migrations.
const TRANSACTION_POOLER_PORT = 6543;
const SESSION_POOLER_PORT = 5432;

/** Supabase Postgres connection used by the running application (transaction pooler). */
export function getDatabaseUrl(env: Environment = process.env): string {
  return env.DATABASE_URL || buildSupabaseUrl(env, TRANSACTION_POOLER_PORT);
}

/** Connection for schema migrations; Supabase recommends the session pooler. */
export function getMigrationDatabaseUrl(
  env: Environment = process.env,
): string {
  if (env.DIRECT_URL) return env.DIRECT_URL;
  // An explicit DATABASE_URL (e.g. a local test database) is used as-is for migrations too.
  if (env.DATABASE_URL) return env.DATABASE_URL;
  return buildSupabaseUrl(env, SESSION_POOLER_PORT);
}

/** Builds a pooler URL from SUPABASE_* parts so the credentials live in one place. */
function buildSupabaseUrl(env: Environment, port: number): string {
  const ref = env.SUPABASE_PROJECT_REF;
  const password = env.SUPABASE_DB_PASSWORD;
  const host = env.SUPABASE_POOLER_HOST;
  if (!ref || !password || !host)
    throw new Error(
      'Database not configured: set SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD and SUPABASE_POOLER_HOST, or DATABASE_URL (see .env.example)',
    );
  const database = env.SUPABASE_DB_NAME || 'postgres';
  return `postgresql://postgres.${encodeURIComponent(ref)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

/** Remote databases (Supabase) need TLS; local disposable test databases do not. */
export function isLocalDatabase(url: string): boolean {
  const host = new URL(url).hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')
  );
}

/** Supabase's transaction pooler (Supavisor, port 6543) cannot run prepared statements. */
export function isTransactionPooler(url: string): boolean {
  return new URL(url).port === '6543';
}

/** Adds sslmode=require for remote hosts unless the URL already chooses an sslmode. */
export function withSslMode(url: string): string {
  const parsed = new URL(url);
  if (isLocalDatabase(url) || parsed.searchParams.has('sslmode')) return url;
  parsed.searchParams.set('sslmode', 'require');
  return parsed.toString();
}

/** Upstash Redis (rediss:// for TLS) holding contract caches and live patches. */
export function getRedisUrl(env: Environment = process.env): string {
  const url = env.REDIS_URL;
  if (!url)
    throw new Error(
      'REDIS_URL is required: set it to your Upstash Redis URL (see .env.example)',
    );
  return url;
}

export function getServiceEndpoints(
  env: Environment = process.env,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.assign(Object.create(null) as Record<string, string>, {
      'user-service': env.USER_SERVICE_URL || 'http://localhost:3001',
      'order-service': env.ORDER_SERVICE_URL || 'http://localhost:3002',
    }),
  );
}
