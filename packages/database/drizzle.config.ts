import { getMigrationDatabaseUrl, withSslMode } from '@orchestrator/config';
import { defineConfig } from 'drizzle-kit';

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
