import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDatabaseUrl,
  getMigrationDatabaseUrl,
  isLocalDatabase,
  isTransactionPooler,
  withSslMode,
} from './index.js';

const pooler =
  'postgresql://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
const session =
  'postgresql://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';

test('Supabase transaction pooler is detected and local test databases are not remote', () => {
  assert.equal(isTransactionPooler(pooler), true);
  assert.equal(isTransactionPooler(session), false);
  assert.equal(isLocalDatabase('postgresql://u:p@127.0.0.1:5432/db'), true);
  assert.equal(isLocalDatabase(pooler), false);
});

test('migrations prefer DIRECT_URL and remote URLs get sslmode=require', () => {
  assert.equal(
    getMigrationDatabaseUrl({ DATABASE_URL: pooler, DIRECT_URL: session }),
    session,
  );
  assert.equal(getMigrationDatabaseUrl({ DATABASE_URL: pooler }), pooler);
  assert.match(withSslMode(session), /sslmode=require$/);
  assert.equal(
    withSslMode(`${session}?sslmode=verify-full`),
    `${session}?sslmode=verify-full`,
  );
  assert.equal(
    withSslMode('postgresql://u:p@localhost:5432/db'),
    'postgresql://u:p@localhost:5432/db',
  );
});

test('Supabase URLs are built from separate keys, with credentials encoded once', () => {
  const env = {
    SUPABASE_PROJECT_REF: 'ref',
    SUPABASE_DB_PASSWORD: 'p@ss/word',
    SUPABASE_POOLER_HOST: 'aws-0-ap-south-1.pooler.supabase.com',
  };
  assert.equal(
    getDatabaseUrl(env),
    'postgresql://postgres.ref:p%40ss%2Fword@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  );
  assert.equal(
    getMigrationDatabaseUrl(env),
    'postgresql://postgres.ref:p%40ss%2Fword@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
  );
  assert.equal(getDatabaseUrl({ ...env, DATABASE_URL: pooler }), pooler);
  assert.throws(() => getDatabaseUrl({}), /SUPABASE_PROJECT_REF/);
});
