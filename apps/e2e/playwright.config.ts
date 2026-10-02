import { defineConfig } from '@playwright/test';

// Started by scripts/test-e2e.sh, which provides disposable Postgres/Redis URLs.
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set; run "pnpm test:e2e" from the repository root`);
  return value;
};

const AUTH_URL = 'http://localhost:54399';

/** Shared by every server so nothing falls back to the real Supabase/Upstash settings in .env. */
const env = {
  DATABASE_URL: required('E2E_DATABASE_URL'),
  DIRECT_URL: required('E2E_DATABASE_URL'),
  REDIS_URL: required('E2E_REDIS_URL'),
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
    server('node auth-server.mjs', '.', `${AUTH_URL}/auth/v1/.well-known/jwks.json`),
    server('node dist/index.js', '../../services/user-service', 'http://localhost:3001/health'),
    server('node dist/index.js', '../../services/order-service', 'http://localhost:3002/health'),
    server('node dist/main.js', '../api-gateway', 'http://localhost:4000/patches/user-service/remoteEntry.js'),
    server('pnpm exec vite --strictPort', '../mfe-user', 'http://localhost:5001/remoteEntry.js'),
    server('pnpm exec vite --strictPort', '../mfe-order', 'http://localhost:5002/remoteEntry.js'),
    server('pnpm exec vite --strictPort', '../mfe-shell', 'http://localhost:5000'),
    server('pnpm exec vite --strictPort', '../dashboard', 'http://localhost:5100'),
  ],
});
