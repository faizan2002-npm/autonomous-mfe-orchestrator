# Testing Guide

The project has a comprehensive multi-tier testing strategy to ensure quality and catch regressions early.

## Test Types

### Unit Tests (Jest + node:test)
Located in `**/*.test.ts` files. Test individual functions, classes, and modules in isolation.

```bash
pnpm test              # Run all unit tests
pnpm test:jest         # Run with Jest specifically
pnpm test:jest:watch   # Watch mode
pnpm test:jest:coverage # With coverage report
```

**Files:**
- `packages/core/src/**/*.test.ts` — drift, pins, OpenAPI parsing
- `packages/crypto/src/**/*.test.ts` — encryption/hashing
- `apps/api-gateway/src/**/*.test.ts` — services, guards, middleware
- `apps/dashboard/src/**/*.test.tsx` — components, hooks

**Best practices:**
- Use descriptive test names: `describe('UserService', () => { it('creates user with encrypted email', ...)}`
- Mock external dependencies (DB, HTTP, external APIs)
- Test happy path, edge cases, and error scenarios
- Use test fixtures in `apps/api-gateway/src/test/test-helpers.ts`

### Integration Tests (node:test + Docker)
Located in `apps/integration-tests/*.test.mjs`. Test multiple modules working together against real Postgres and Redis.

```bash
pnpm test:integration    # Full suite (~10 min)
pnpm test:nest          # NestJS modules only
```

**Files:**
- `live.test.mjs` — migrations, schema idempotency
- `tenancy.test.mjs` — multi-org isolation, roles, keys
- `notifications.test.mjs` — outbox, email, webhooks, push
- `policies.test.mjs` — evaluation, promotion, rollback
- `openapi.test.mjs` — spec import, baselines, adoption

**Setup:**
- Spins up fresh `postgres:17-alpine` and `redis:7-alpine` containers
- Tests run against disposable DB/Redis — **never** touch Supabase
- Each test cleans up its own data via transactions or truncation

**Best practices:**
- Test behavior from the API boundary (HTTP requests, not direct DB)
- Include edge cases: missing auth, cross-org access (expect 404), revoked keys
- Verify audit trails and notifications are persisted
- Check that cleanup doesn't leave dangling data

### E2E Tests (Playwright + Chrome)
Located in `apps/e2e/tests/*.spec.ts`. Test user flows end-to-end in a real browser.

```bash
pnpm test:e2e           # Headless
pnpm test:e2e:headed    # Show the browser (slower, good for debugging)
```

**Files:**
- `healing.spec.ts` — signup, onboarding, drift, promotion

**Setup:**
- Launches a stand-in auth server on `http://localhost:54399`
- Opens Chrome and navigates through the dashboard
- Verifies UI, forms, navigation, and live updates (SSE)

**Best practices:**
- Write tests as user stories, not implementation details
- Use `page.locator()` with accessible names (buttons, labels) — resist selectors
- Wait for async operations: `await page.waitForLoadState('networkidle')`
- Take screenshots on failure for debugging
- Avoid flaky waits; use `isVisible()` or `isEnabled()` predicates

## Coverage Targets

| Module | Target | Current |
|---|---|---|
| `packages/core` | ≥80% | TBD |
| `packages/crypto` | ≥90% | TBD |
| `apps/api-gateway` | ≥70% | TBD |
| `apps/dashboard` | ≥60% | TBD |

View reports:
```bash
pnpm test:jest:coverage
# Open coverage/index.html in a browser
```

## Running Tests Locally

### One-time setup
```bash
pnpm install
pnpm build
docker pull postgres:17-alpine redis:7-alpine
```

### Full verification ladder (before committing)
```bash
pnpm build
pnpm lint
pnpm test
pnpm test:jest:coverage  # Check coverage thresholds
pnpm test:integration    # Start Docker; takes ~10 min
pnpm test:e2e            # Headed: pnpm test:e2e:headed
```

### Iterate on one test
```bash
# Unit test
pnpm test:jest -- --testNamePattern="should create user with encrypted"

# Integration test (with Docker containers)
docker run -d --name pg -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t -p 5432:5432 postgres:17-alpine
docker run -d --name redis -p 6379:6379 redis:7-alpine
cd apps/integration-tests
export TEST_DATABASE_URL="postgresql://postgres:t@localhost:5432/t"
export TEST_REDIS_URL="redis://localhost:6379"
node --test policies.test.mjs
docker rm -f pg redis

# E2E test
pnpm test:e2e:headed -- tests/healing.spec.ts
```

## Writing a New Test

### Unit test example
```typescript
// apps/api-gateway/src/orgs/orgs.service.test.ts
import { Test } from '@nestjs/testing';
import { OrgsService } from './orgs.service';
import { createMockToken } from '../test/test-helpers';

describe('OrgsService', () => {
  let service: OrgsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OrgsService, /* mocked deps */],
    }).compile();
    service = module.get(OrgsService);
  });

  it('creates an org and returns it', async () => {
    const result = await service.create({
      name: 'Test Org',
      slug: 'test-org',
    });
    expect(result.name).toBe('Test Org');
  });
});
```

### Integration test example
```javascript
// apps/integration-tests/custom.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';

test('custom behavior', async () => {
  const db = postgres(process.env.TEST_DATABASE_URL);
  const [org] = await db`SELECT * FROM organizations LIMIT 1`;
  assert.ok(org, 'Org exists');
  await db.end();
});
```

### E2E test example
```typescript
// apps/e2e/tests/custom.spec.ts
import { test, expect } from '@playwright/test';

test('user can create a service', async ({ page }) => {
  await page.goto('/o/demo/services');
  await page.getByRole('button', { name: 'Create service' }).click();
  await page.getByLabel('Base URL').fill('http://example.com/api');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Service created')).toBeVisible();
});
```

## Debugging Tests

### Unit test
```bash
node --inspect-brk $(pnpm bin)/jest packages/core/src/drift.test.ts
# Open chrome://inspect in Chrome
```

### Integration test with logs
```bash
TEST_DEBUG=1 node --test apps/integration-tests/policies.test.mjs 2>&1 | head -100
```

### E2E test with headed browser and slow motion
```bash
HEADED=1 SLOW_MO=1000 pnpm test:e2e:headed
```

## Continuous Integration

GitHub Actions runs all tests on push to `main` and on pull requests:
- `test.yml` — build, lint, unit, integration tests
- E2E tests in a separate job (can run in parallel)
- Coverage uploaded to Codecov after unit tests

See `.github/workflows/test.yml` for configuration.
