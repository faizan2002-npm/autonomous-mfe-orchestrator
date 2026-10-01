import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * from './schema/index.js';

export function createDatabaseClient(connectionString?: string) {
  const url = connectionString || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mfe_orchestrator';
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

export type DrizzleDb = ReturnType<typeof createDatabaseClient>;
