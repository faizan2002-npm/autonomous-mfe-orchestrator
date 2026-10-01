import { getDatabaseUrl } from '@orchestrator/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * from './schema/index.js';

export function createDatabaseConnection(connectionString?: string) {
  const url = connectionString || getDatabaseUrl();
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

export function createDatabaseClient(connectionString?: string) {
  return createDatabaseConnection(connectionString).db;
}

export type DrizzleDb = ReturnType<typeof createDatabaseClient>;
