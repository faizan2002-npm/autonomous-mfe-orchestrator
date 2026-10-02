import { getMigrationDatabaseUrl, withSslMode } from '@orchestrator/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: withSslMode(getMigrationDatabaseUrl()),
  },
  verbose: true,
  strict: true,
});
