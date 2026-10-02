import {
  getDatabaseUrl,
  isLocalDatabase,
  isTransactionPooler,
} from '@orchestrator/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * from './schema/index.js';

export function createDatabaseConnection(connectionString = getDatabaseUrl()) {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Supabase requires TLS; an explicit ?sslmode= in the URL still takes precedence.
    ...(isLocalDatabase(connectionString) ||
    new URL(connectionString).searchParams.has('sslmode')
      ? {}
      : { ssl: 'require' as const }),
    prepare: !isTransactionPooler(connectionString),
  });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

export type DrizzleDb = ReturnType<typeof createDatabaseConnection>['db'];
