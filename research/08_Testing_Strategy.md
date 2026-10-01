# Chapter 8: Testing Strategy

This chapter defines the comprehensive testing plan for the Autonomous Micro-Frontend Orchestrator, covering unit testing, integration testing, end-to-end testing, performance testing, security testing, and the evaluation metrics used to validate the project objectives.

## 8.1 Testing Methodology

The project follows a **Test Pyramid** approach:

```
          ╱  E2E Tests  ╲           (Few, Slow, High Confidence)
         ╱───────────────╲
        ╱ Integration Tests╲        (Moderate count, Medium speed)
       ╱───────────────────╲
      ╱     Unit Tests      ╲       (Many, Fast, Isolated)
     ╱───────────────────────╲
```

### Testing Tools

| Tool | Purpose |
|---|---|
| **Jest** | Unit and integration testing framework |
| **Light-my-request / Supertest** | HTTP endpoint testing for Fastify APIs |
| **Playwright** | End-to-end browser testing for dashboard and MFE |
| **k6 (Grafana)** | Load and performance testing |
| **Docker Compose** | Integration test environment orchestration |

## 8.2 Unit Tests

### Module 1: Observation Engine

| Test ID | Test Case | Input | Expected Output |
|---|---|---|---|
| **TC-1.1** | Schema flattening — simple object | `{ id: 1, name: "test" }` | `Set { "id:number", "name:string" }` |
| **TC-1.2** | Schema flattening — nested object | `{ user: { name: "test" } }` | `Set { "user.name:string" }` |
| **TC-1.3** | Schema flattening — array field | `{ items: [1, 2, 3] }` | `Set { "items:object" }` |
| **TC-1.4** | Schema flattening — null values | `{ id: 1, name: null }` | `Set { "id:number", "name:object" }` |
| **TC-1.5** | Jaccard similarity — identical schemas | Same sets | `1.0` |
| **TC-1.6** | Jaccard similarity — completely different | Disjoint sets | `0.0` |
| **TC-1.7** | Jaccard similarity — one field renamed | 3 common, 1 renamed | `0.6` |
| **TC-1.8** | Drift classification — field deleted | Field in old, not in new | `FIELD_DELETED` |
| **TC-1.9** | Drift classification — field added | Field in new, not in old | `FIELD_ADDED` |
| **TC-1.10** | Drift classification — type changed | Same key, different type suffix | `TYPE_CHANGED` |
| **TC-1.11** | Severity — low (field added) | `FIELD_ADDED`, Dc=0.03 | `LOW` |
| **TC-1.12** | Severity — critical (multi-field mutation) | `MULTI_FIELD_MUTATION`, Dc=0.6 | `CRITICAL` |

### Module 2: Cognitive Reasoning Engine

| Test ID | Test Case | Input | Expected Output |
|---|---|---|---|
| **TC-2.1** | Breaking change detection — field rename | `FIELD_RENAMED` | `isBreaking = true` |
| **TC-2.2** | Breaking change detection — field added | `FIELD_ADDED` | `isBreaking = false` |
| **TC-2.3** | Syntax validation — valid ES6 arrow | `(data) => ({ ...data })` | `{ valid: true }` |
| **TC-2.4** | Syntax validation — syntax error | `(data) => { ...data` | `{ valid: false, errors: [...] }` |
| **TC-2.5** | Syntax validation — malicious eval | `(data) => eval(data)` | `{ valid: false }` (blocked by security rule) |
| **TC-2.6** | Confidence threshold — above threshold | `confidence: 0.85` | Auto-deploy allowed |
| **TC-2.7** | Confidence threshold — below threshold | `confidence: 0.45` | Flagged for human review |
| **TC-2.8** | Retry mechanism — first attempt fails, second succeeds | Syntax error on attempt 1 | Patch generated on attempt 2 with error context |

### Module 3: Execution Engine

| Test ID | Test Case | Input | Expected Output |
|---|---|---|---|
| **TC-3.1** | VFS write and read | Patch code string | File accessible at expected path |
| **TC-3.2** | Canary routing — 10% split | 1000 requests | ~100 routed to canary (within 5% variance) |
| **TC-3.3** | Canary evaluation — pass | Canary errors = 0, baseline errors = 2 | `promote = true` |
| **TC-3.4** | Canary evaluation — fail | Canary errors = 15, baseline errors = 2 | `promote = false` |
| **TC-3.5** | Rollback — state restoration | Active patch rolled back | Traffic 100% to original, patch status = ROLLED_BACK |

### Module 4: Governance Dashboard

| Test ID | Test Case | Input | Expected Output |
|---|---|---|---|
| **TC-4.1** | Authentication — valid credentials | Correct email/password | JWT token returned |
| **TC-4.2** | Authentication — invalid password | Wrong password | 401 Unauthorized |
| **TC-4.3** | RBAC — admin approve | Admin role + approve request | Patch approved |
| **TC-4.4** | RBAC — viewer approve | Viewer role + approve request | 403 Forbidden |
| **TC-4.5** | Stats aggregation | 5 drifts (2 fixed, 1 pending, 2 failed) | Correct counts and success rate (40%) |

## 8.3 Integration Tests

| Test ID | Test Case | Modules Involved | Setup | Assertion |
|---|---|---|---|---|
| **IT-1** | Drift detection end-to-end | Observation Engine + DB | Backend returns mutated schema | DRIFT_EVENT created in PostgreSQL with correct Dc, classification, and severity |
| **IT-2** | Patch generation on drift | Observation + Reasoning + DB | Drift event emitted | AUTONOMOUS_PATCH created with valid code, confidence score, and reasoning trace |
| **IT-3** | Canary deployment lifecycle | Reasoning + Execution + DB | Patch generated successfully | Canary metrics recorded; patch promoted/rolled back; governance log created |
| **IT-4** | Dashboard reads live data | All modules + Dashboard | Complete drift → fix cycle | Dashboard API returns correct drift detail with patch and canary data |
| **IT-5** | LLM fallback on timeout | Reasoning Engine | Mock LLM API with 30s delay | System falls back gracefully; no crash; drift queued for manual review |
| **IT-6** | Contract re-ingestion | Observation + DB | OpenAPI spec updated | API_CONTRACTS table updated; old contract marked inactive; new version_hash stored |

## 8.4 End-to-End (E2E) Tests

These tests validate the complete system from a user's perspective using Playwright.

| Test ID | Scenario | Steps | Expected Outcome |
|---|---|---|---|
| **E2E-1** | **Full autonomous resolution** | 1. Backend changes `firstName` → `first_name`. 2. MFE makes API call. 3. Wait 90 seconds. | MFE renders correctly with adapted data; no console errors; dashboard shows drift as FIXED |
| **E2E-2** | **Human-in-the-loop resolution** | 1. Simulate complex schema change (low confidence). 2. Check dashboard. 3. Admin clicks Approve. | Patch deployed after manual approval; governance log shows MANUAL_APPROVE |
| **E2E-3** | **Canary rollback** | 1. Inject a patch that causes errors. 2. Wait for canary window. | System automatically rolls back; dashboard shows ROLLED_BACK; MFE continues on original pipeline |
| **E2E-4** | **LLM outage graceful fallback** | 1. Disable LLM API key. 2. Trigger a drift event. | MFE serves last stable build; dashboard shows alert; no crash |
| **E2E-5** | **Dashboard governance workflow** | 1. Login as admin. 2. Navigate to drifts. 3. View detail. 4. Approve patch. 5. Verify rollback button works. | All dashboard flows functional; correct RBAC enforcement |

## 8.5 Performance Tests

### 8.5.1 Test Plan

| Test ID | Metric | Tool | Target | Method |
|---|---|---|---|---|
| **PT-1** | Middleware passthrough latency | k6 | ≤ 50ms (p95) | 500 VUs, 5 min sustained load, no drift |
| **PT-2** | Page load with injected patch | Lighthouse | Performance score ≥ 85 | Measure with and without patch |
| **PT-3** | End-to-end resolution time | Custom timer | ≤ 30s for simple mutations | Time from drift detection to patch promotion |
| **PT-4** | Concurrent request handling | k6 | 500 RPS without degradation | Ramp from 100 to 500 VUs over 10 min |
| **PT-5** | Database query performance | pg_stat_statements | All queries < 100ms | Profile under load |

### 8.5.2 k6 Load Test Script (Example)

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up
    { duration: '5m', target: 500 },   // Sustained load
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<50'],    // 95% of requests under 50ms
    http_req_failed: ['rate<0.01'],     // Less than 1% failure rate
  },
};

export default function () {
  const res = http.get('http://localhost:4000/api/v1/users/123');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response has firstName': (r) => JSON.parse(r.body).firstName !== undefined,
  });
  sleep(0.1);
}
```

## 8.6 Security Tests

| Test ID | Threat | Test Method | Expected Result |
|---|---|---|---|
| **ST-1** | XSS via generated code | Inject `<script>alert(1)</script>` in API response; check if generated adapter includes it | Code must not contain any raw HTML/script tags |
| **ST-2** | eval() in generated code | Check generated code AST for `eval`, `Function`, `setTimeout(string)` | Blocked by AST validation |
| **ST-3** | External import in patch | Check for `import`, `require`, `fetch`, `XMLHttpRequest` in generated code | Blocked by AST validation |
| **ST-4** | SQL injection via dashboard | Send `'; DROP TABLE--` as rejection reason | Prisma parameterized query prevents injection |
| **ST-5** | JWT token expiry | Use expired JWT token | 401 Unauthorized |
| **ST-6** | Brute force login | 10 rapid failed login attempts | Rate limiting (429) after 5 attempts |

## 8.7 Evaluation Metrics

These metrics directly validate the project objectives from Chapter 1.

### 8.7.1 Primary Evaluation Metrics

| Metric | Definition | Target | Measurement Method |
|---|---|---|---|
| **Drift Detection Accuracy** | `(True Positives + True Negatives) / Total Observations` | ≥ 95% | Run 100 test scenarios (50 drifted, 50 normal) |
| **Patch Generation Success Rate** | `Patches that compile and pass canary / Total patches generated` | ≥ 85% | Count across 50 drift resolution attempts |
| **Mean Time to Resolution (MTTR)** | Average time from drift detection to patch promotion | ≤ 60 seconds | Timestamp analysis across test runs |
| **Maintenance Overhead Reduction** | Comparison of developer hours saved vs manual adapter writing | ≥ 90% reduction | Time study: manual vs automated for same 20 schema changes |
| **System Uptime** | Percentage of time the Observation Engine is operational | ≥ 99.5% | Health check monitoring over 72-hour test period |

### 8.7.2 Secondary Evaluation Metrics

| Metric | Definition | Target |
|---|---|---|
| **False Positive Rate** | Drifts flagged that are not actual breaking changes | ≤ 5% |
| **Rollback Rate** | Patches that fail canary and are rolled back | ≤ 15% |
| **Average Confidence Score** | Mean LLM confidence across all generated patches | ≥ 0.80 |
| **Latency Overhead** | Additional latency introduced by the middleware (passthrough) | ≤ 50ms (p95) |
| **Patch Latency Overhead** | Additional latency introduced by an active adapter | ≤ 10ms |

### 8.7.3 Evaluation Test Scenarios

| Scenario ID | Schema Change | Complexity | Expected Outcome |
|---|---|---|---|
| **S1** | Single field renamed (`firstName` → `first_name`) | Simple | Auto-fix, Dc ≈ 0.2 |
| **S2** | Single field deleted (`middleName` removed) | Simple | Auto-fix with null handling |
| **S3** | Field type changed (`age: string` → `age: number`) | Medium | Auto-fix with type coercion |
| **S4** | Nested object restructured (`address.city` → `location.city`) | Medium | Auto-fix with path remapping |
| **S5** | Multiple fields renamed simultaneously | Complex | Auto-fix, confidence may be lower |
| **S6** | Array element schema changed | Complex | Auto-fix with `.map()` adapter |
| **S7** | Entire response wrapped in new root object | Complex | Auto-fix with unwrapping |
| **S8** | Non-breaking field addition | Simple | System ignores (no patch needed) |
| **S9** | Completely different schema (unrelated endpoint) | Critical | Dc ≈ 1.0; flag for human review |
| **S10** | No change (identical schema) | None | Dc = 0; passthrough |

## 8.8 Test Environment

```yaml
# test-docker-compose.yml
version: '3.9'

services:
  test-postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: orchestrator_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    tmpfs:
      - /var/lib/postgresql/data   # In-memory for speed

  test-redis:
    image: redis:7-alpine

  test-gateway:
    build: ./gateway
    environment:
      DATABASE_URL: postgresql://test:test@test-postgres:5432/orchestrator_test
      REDIS_URL: redis://test-redis:6379
      OLLAMA_BASE_URL: http://host.docker.internal:11434
      NODE_ENV: test
    depends_on:
      - test-postgres
      - test-redis
```
