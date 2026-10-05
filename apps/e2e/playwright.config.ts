import { defineConfig } from '@playwright/test';

// Started by scripts/test-e2e.sh, which provides disposable Postgres/Redis URLs.
const required = (name: string) => {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} must be set; run "pnpm test:e2e" from the repository root`,
    );
  return value;
};

const AUTH_URL = 'http://localhost:54399';

/** Shared by every server so nothing falls back to the real Supabase/Upstash settings in .env. */
const env = {
  DATABASE_URL: required('E2E_DATABASE_URL'),
  DIRECT_URL: required('E2E_DATABASE_URL'),
  REDIS_URL: required('E2E_REDIS_URL'),
  ENCRYPTION_KEY: required('ENCRYPTION_KEY'),
  KEY_PEPPER: required('KEY_PEPPER'),
  // The demo services run on localhost.
  ALLOW_PRIVATE_UPSTREAMS: 'true',
  APP_URL: 'http://localhost:5100',
  VITE_MFE_CONSUMER_KEY: required('VITE_MFE_CONSUMER_KEY'),
  SUPABASE_URL: AUTH_URL,
  // Empty disables Gemini: patches come from the deterministic fallback, so runs are offline and repeatable.
  GEMINI_API_KEY: '',
  VITE_SUPABASE_URL: AUTH_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-publishable-key',
  VITE_GATEWAY_URL: 'http://localhost:4000',
};

const server = (command: string, cwd: string, url: string) => ({
  command,
  cwd,
  url,
  env,
  reuseExistingServer: false,
  timeout: 90_000,
  stdout: 'ignore' as const,
  stderr: 'pipe' as const,
});

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    server(
      'node auth-server.mjs',
      '.',
      `${AUTH_URL}/auth/v1/.well-known/jwks.json`,
    ),
    server(
      'node fixtures/demo-upstream.mjs user-service 3001',
      '.',
      'http://localhost:3001/health',
    ),
    server(
      'node fixtures/demo-upstream.mjs order-service 3002',
      '.',
      'http://localhost:3002/health',
    ),
    // A separate user-service whose chaos switch the API specs flip, away from the demo org's.
    server(
      'node fixtures/demo-upstream.mjs user-service 3003',
      '.',
      'http://localhost:3003/health',
    ),
    server(
      'node dist/main.js',
      '../api-gateway',
      'http://localhost:4000/api/orgs',
    ),
    server(
      'pnpm exec vite --strictPort',
      '../mfe-user',
      'http://localhost:5001/remoteEntry.js',
    ),
    server(
      'pnpm exec vite --strictPort',
      '../mfe-order',
      'http://localhost:5002/remoteEntry.js',
    ),
    server(
      'pnpm exec vite --strictPort',
      '../mfe-shell',
      'http://localhost:5000',
    ),
    server(
      'pnpm exec vite --strictPort',
      '../dashboard',
      'http://localhost:5100',
    ),
  ],
});
