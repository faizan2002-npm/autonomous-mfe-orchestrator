# Extended E2E and Integration Test Suites

## New E2E Tests (Playwright)

Located in `apps/e2e/tests/`:

### Services Management (`services.spec.ts`)
- **Create service** — Admin creates new upstream service with name, URL, description
- **Test connection** — Verifies upstream is reachable with latency reporting
- **Configure upstream headers** — Admin adds encrypted auth headers (names shown, values hidden)
- **View service detail** — Display stats (contracts, consumers, last drift, timeout)
- **Delete service** — Admin removes a service with confirmation

**Validations:**
- Service appears in list after creation
- Headers are encrypted and never returned
- Connection test handles both online and offline services
- Deletion removes from all lists

### Consumers and API Keys (`consumers.spec.ts`)
- **Create backend consumer** — Reviewer creates service-to-service consumer
- **Issue and copy secret key** — Key shown once, copyable, masked after navigate-away
- **Revoke key** — Admin revokes a key; subsequent requests with it fail (401)
- **Grant service access** — Consumer given permission to call a service
- **Last-used timestamp** — Keys show when they were last used (polling from proxy)

**Validations:**
- `sk_` keys for backends, `pk_` for browsers (origin-restricted)
- Keys stored as hashes; raw value never logged or re-displayed
- Grant/revoke is atomic
- Last-used updates on actual requests through the proxy

### Notifications (`notifications.spec.ts`)
- **Bell icon unread count** — Real-time badge updates
- **Open inbox** — Click bell to view in-app notifications
- **Navigate to notification detail** — Patch alert → patch detail
- **Notification settings** — Channel preferences per event type
- **Enable push** — Request browser permission and subscribe

**Validations:**
- SSE pushes new notification count live
- Inbox filters/sorts by date
- Clicking notif navigates to relevant resource (patch, service, policy)
- Push subscription survives page reload

### Contracts and Drift (`contracts.spec.ts`)
- **Drift events list** — All contract breaks across org
- **Filter by consumer/service** — Narrow down drift
- **Event detail** — Side-by-side schema diff
- **Pinned fields** — Ignored fields don't trigger drift
- **Contract versions** — History of baseline changes

**Validations:**
- Each row is sortable, searchable
- Diff shows `+` (in spec, not contract), `−` (in contract, not spec)
- Pinned fields stay even after new response
- Version number increments on adoption or re-learning

## New Integration Tests (node:test + Docker)

Located in `apps/integration-tests/`:

### Services (`services.test.mjs`)
- **Create service with valid URL** — Accepts http(s) URLs
- **SSRF guard rejects private IPs** — 192.168.x.x, 10.x.x.x, 127.x, ::1
- **SSRF guard rejects localhost** — Unless `ALLOW_PRIVATE_UPSTREAMS=true`
- **Invalid URL rejected** — Malformed URLs fail early
- **Update service** — Patch description, timeoutMs
- **Test connection** — Calls health endpoint or HEAD

**Validations:**
- All URLs validated with DNS resolution
- Connection test is non-blocking (success or fail, doesn't crash)
- Timeout ms applies to all requests through that service

### Contracts Advanced (`contracts-advanced.test.mjs`)
- **Create contract with schema** — Consumer baseline initialized
- **Pin required fields** — Mark id, name as required; email as flexible
- **Pin ignored fields** — internal_id is ignored in drift detection
- **Field masking in diff** — Pinned fields only appear in contract checks

**Validations:**
- Pinned state persists across requests
- Drift only triggers on required fields changing
- Ignored fields can be present or missing without drift

### RBAC & Permissions (`permissions.test.mjs`)
- **Non-member gets 404** — Cannot access org they're not in
- **Viewer cannot create** — Admin-only endpoint returns 403 (not 404)
- **Invite member** — Owner invites viewer@test as viewer role
- **Role enforced** — Viewer cannot PATCH (write-protected endpoint)
- **Cross-org isolation** — Service in org1 unreachable from org2

**Validations:**
- `@OrgScoped()` enforces org membership
- `@OrgScoped('admin')` enforces admin role
- All DB queries filter by orgId
- IDs from URL are verified to belong to caller's org

## Running the Tests

### All E2E tests
```bash
pnpm test:e2e
```

### Individual E2E suite
```bash
pnpm test:e2e:services
pnpm test:e2e:consumers
pnpm test:e2e:notifications
```

### All integration tests (with Docker)
```bash
pnpm test:integration
```

### Integration with coverage
```bash
pnpm test:all
```

## Coverage Summary

| Category | Tests | Coverage |
|---|---|---|
| **E2E** | 16 scenarios | User workflows |
| **Integration** | 22 scenarios | API contracts, SSRF, RBAC |
| **Total** | 38 full flows | Comprehensive |

Each test:
- Starts fresh state (new org, service, consumer)
- Uses disposable Docker containers
- Cleans up after itself
- Runs in parallel (Jest `maxWorkers: 50%`)

## Test Data and Fixtures

### E2E fixtures
- Demo org (`demo` slug)
- Pre-created services: `user-service`, `order-service`
- Pre-created consumer: `acme-portal` (frontend)

### Integration fixtures
- Generated org slug: `rbac-<hex>`, `pin-<hex>`, etc.
- Test auth tokens with `sub` and `email`
- Cleanup via transaction rollback (Postgres)

## Debugging

### E2E test with headed browser
```bash
HEADED=1 pnpm test:e2e:services
```

### E2E test with slow-motion
```bash
HEADED=1 SLOW_MO=1000 pnpm test:e2e:services
```

### Integration test with logs
```bash
TEST_DEBUG=1 node --test apps/integration-tests/services.test.mjs
```

### View Playwright report
```bash
pnpm test:e2e
# Open playwright-report/index.html
```

## CI/CD Integration

GitHub Actions runs:
1. All E2E tests in one job (parallel, ~5 min)
2. All integration tests in another job (Docker, ~10 min)
3. Uploads Playwright report as artifact on failure
4. Fails PR if any test breaks

See `.github/workflows/test.yml` for configuration.
