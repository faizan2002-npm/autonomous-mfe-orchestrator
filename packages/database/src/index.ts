import { getDatabaseUrl } from '@orchestrator/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * from './schema/index.js';

export function createDatabaseClient(connectionString?: string) {
  const url = connectionString || getDatabaseUrl();
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

export type DrizzleDb = ReturnType<typeof createDatabaseClient>;
