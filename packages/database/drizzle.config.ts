import { existsSync } from 'node:fs';
import { getMigrationDatabaseUrl, withSslMode } from '@orchestrator/config';
import { defineConfig } from 'drizzle-kit';

// `pnpm db:migrate` runs here, in packages/database; the settings live in the repository root .env.
// Variables already in the environment win, so CI and test scripts can override them.
for (const file of ['.env', '../../.env']) if (existsSync(file)) process.loadEnvFile(file);

export default defineConfig({
  // drizzle-kit's CJS loader can't resolve the NodeNext `.js` specifiers in src/schema,
  // so it reads the compiled schema; `db:generate` builds first.
  schema: './dist/schema/index.js',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: withSslMode(getMigrationDatabaseUrl()),
  },
  verbose: true,
  strict: true,
});
