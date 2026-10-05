# Resilience Patterns

This document explains how the API Gateway implements resilience patterns to handle failures gracefully and maintain service availability under adverse conditions.

## Circuit Breaker

The circuit breaker pattern prevents cascading failures by stopping requests to unhealthy services. It operates in three states:

### States

**CLOSED** — Normal operation
- All requests pass through to the service
- Failures are counted
- After `failureThreshold` consecutive failures, transition to OPEN

**OPEN** — Service failing
- Requests immediately return error (fail-fast)
- No calls made to the service (saves resources)
- After `resetTimeoutMs`, transition to HALF_OPEN for recovery test

**HALF_OPEN** — Testing recovery
- A limited number of probe requests are allowed
- If probe succeeds, transition to CLOSED (service recovered)
- If probe fails, transition back to OPEN (service still unhealthy)

### Configuration

```typescript
// Default thresholds
const failureThreshold = 5;      // Open after 5 consecutive failures
const resetTimeoutMs = 30_000;   // Test recovery after 30 seconds
const halfOpenRequests = 5;      // Need 5 successes to consider recovered
```

### Monitoring

```bash
# Check current state
redis-cli GET "circuit-breaker:gemini-api"
# Returns: {"state": "OPEN", "failureCount": 7, ...}

# Alert if open for > 2 minutes
alerting_rule: gateway_circuit_breaker_state == 1 for 2m
```

### Example Scenario

```
T=0:00   Instance A calls Gemini API → Timeout (failure #1)
T=0:05   Instance A retries → Timeout (failure #2)
T=0:10   Instance A retries → Timeout (failure #3)
T=0:15   Instance A retries → Timeout (failure #4)
T=0:20   Instance A retries → Timeout (failure #5)
         Circuit breaker transitions to OPEN
         
T=0:21   Instance B attempts patch generation → Circuit OPEN → Fail-fast (no retry)
T=0:22   Instance C attempts patch generation → Circuit OPEN → Fail-fast (no retry)
         
         (No more calls made to Gemini API for 30 seconds)
         
T=0:50   Reset timeout expires, circuit transitions to HALF_OPEN
T=0:51   Instance A makes probe request → Gemini API responds (success!)
T=0:52   5 more probe requests succeed
         Circuit transitions to CLOSED
         
T=0:55   Normal operation resumes
```

## Timeouts

All external calls have timeouts to prevent indefinite hangs.

### Configured Timeouts

| Operation | Timeout | Rationale |
|-----------|---------|-----------|
| Upstream service call | Service-specific (default 5s) | Don't wait longer than SLA |
| Gemini API call | 10s | LLM API can be slow |
| Sandbox patch execution | 50ms | Deterministic fallback if slow |
| Database query | 5s | Connection pool timeout |
| Redis operation | 1s | Cache, not critical path |

### Timeout Handling

```typescript
// Upstream timeout (5 seconds)
const response = await fetch(url, {
  signal: AbortController.signal,
  timeout: 5000
});
// If timeout: throw TimeoutError
// Caller retries (see Retry Logic)

// Gemini timeout (10 seconds)
const patch = await geminiClient.generatePatch(..., { timeout: 10000 });
// If timeout: circuit breaker counts as failure
// Fallback to deterministic adapter

// Sandbox timeout (50ms)
const healed = await sandboxRuntime.execute(adapter, { timeout: 50 });
// If timeout: return unhealed contract (422 response)
```

## Retry Logic

Transient errors (network timeouts, 5xx) are retried with exponential backoff. Permanent errors (4xx) fail immediately.

### Retry Policy

```
Max attempts: 3
Initial delay: 100ms
Max delay: 1000ms
Backoff: exponential (2x each attempt)
Jitter: ±10% to avoid thundering herd

Attempts:
1. Immediate
2. After 100ms ± 10ms
3. After 200ms ± 20ms
```

### Retryable Errors

```
✓ 5xx (server error)
✓ 408 (request timeout)
✓ 429 (rate limited)
✓ Timeout
✓ ECONNREFUSED
✓ ECONNRESET
✓ DNS lookup failure

✗ 4xx (client error, except 408/429)
✗ Invalid request body
✗ 401 (auth failed)
```

### Example

```
T=0:00   Request to upstream → Timeout
T=0:10   Retry #1 after 100ms → 503 Service Unavailable
T=0:20   Retry #2 after 200ms → 200 OK (success)

Total latency: 220ms (including delays)
```

## Bulkheads (Resource Limits)

Bulkheads prevent one failing component from exhausting all resources.

### HTTP Connection Pool

```bash
# Maximum concurrent requests per instance
Max workers: 200 (configurable via Node.js --max-old-space-size)

# Per-service limits
Gemini API: 10 concurrent (to avoid quota exceed)
Upstream services: 20 concurrent per service
Database: 32 connections (from pooler)
Redis: 10 connections
```

### Rate Limiting

**Consumer traffic (per API key):**
```
100 requests / 60 seconds
Excess requests: return 429 (Too Many Requests)
```

**Management API (per org admin):**
```
No limit yet (TODO for production)
Should add: 50 requests / 60 seconds per user
```

### Monitoring

```bash
# Check pool utilization
curl http://localhost:4000/metrics | grep pool
# gateway_http_workers_active 45/200

# Alert if approaching limit
alerting_rule: gateway_http_workers_active / 200 > 0.8
```

## Fallbacks

When primary mechanisms fail, use safe fallbacks to maintain service availability.

### Gemini API Timeout → Deterministic Adapter

```
User Request
    ↓
Observe contract drift
    ↓
Try AI-generated patch (Gemini)
    ↓ (10s timeout)
┌─────────────────────────────────────┐
│ Timeout or error                    │
└──────────────┬──────────────────────┘
               ↓
Use deterministic fallback adapter
(Field reorder, type coercion, etc.)
               ↓
Return healed response (200)
OR unhealed (422)
```

### Circuit Breaker Open → Fail-Fast (No Retry)

```
User Request
    ↓
Check circuit breaker state
    ↓
┌──────────────────┐
│ OPEN (unhealthy) │ → Return 503 (Service Unavailable)
│ HALF_OPEN (test) │ → Allow probe, may fail
│ CLOSED (healthy) │ → Normal flow
└──────────────────┘
```

### Database Connection Failure → Return 503

```
Health check fails → Readiness probe returns 503
Kubernetes removes pod from load balancer
Traffic routed to healthy pods only
```

## Cascading Failure Prevention

The gateway is designed to prevent failures in one component from affecting others.

### Isolation

```
┌──────────────────────────────────────┐
│ Upstream Service A                   │
│ (Gemini API timeout)                 │
└──────────────────────────────────────┘
         ↓ (Circuit breaker OPEN)
    Fail-fast
         ↓ (No resource exhaustion)
┌──────────────────────────────────────┐
│ Upstream Service B                   │ ← Unaffected
│ (User service, order service)        │   (Normal operation)
└──────────────────────────────────────┘
```

### Resource Pooling

- Database connection pool is shared across all orgs and services
- If one service exhausts pool, other services degrade gracefully (wait for connection)
- Never crash due to resource exhaustion

## Observability

### Key Metrics

```
# Retry rate
rate(gateway_upstream_retries_total[5m])
# Alert if > 100/min (unusual retry patterns)

# Circuit breaker state
gateway_circuit_breaker_state{name="gemini-api"}
# Alert if == 1 (OPEN state)

# Fallback usage
rate(gateway_patch_generation_failures_total[5m])
# Track how often we fall back to deterministic adapter
```

### Logging

```json
{
  "timestamp": "2024-10-05T12:34:56Z",
  "level": "warn",
  "message": "Retry attempt failed, will retry",
  "service": "gemini-api",
  "attempt": 2,
  "delayMs": 200,
  "error": "Connection timeout",
  "requestId": "req_..."
}
```

## Configuration (Environment)

```bash
# Upstream timeouts (milliseconds)
UPSTREAM_TIMEOUT_MS=5000

# Gemini timeout
GEMINI_TIMEOUT_MS=10000

# Sandbox timeout
SANDBOX_TIMEOUT_MS=50

# Circuit breaker
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RESET_TIMEOUT_MS=30000
CIRCUIT_BREAKER_HALF_OPEN_REQUESTS=5

# Retry policy
RETRY_MAX_ATTEMPTS=3
RETRY_INITIAL_DELAY_MS=100
RETRY_MAX_DELAY_MS=1000

# Rate limiting
RATE_LIMIT_REQUESTS_PER_MINUTE=100

# Database connection pool
DATABASE_POOL_MAX_CONNECTIONS=32
```

## Testing Resilience

### Local Testing

```bash
# Simulate Gemini API timeout
export GEMINI_TIMEOUT_MS=100  # Very short timeout

# Make request, observe fallback
curl http://localhost:4000/api/v1/users \
  -H "x-api-key: test-key" \
  -d '{"id": 1, "name": "test", "extra": "field"}'
# Response: 422 (unhealed, used fallback adapter)
```

### Integration Tests

```bash
# Test circuit breaker
pnpm test:integration apps/integration-tests/circuit-breaker.test.mjs

# Test multi-instance resilience
pnpm test:integration apps/integration-tests/multi-instance.test.mjs

# Test e2e resilience
pnpm test:e2e apps/e2e/tests/resilience.spec.ts
```

### Load Testing

```bash
# With k6 (example)
k6 run --vus 100 --duration 5m load-test.js

# Watch metrics
watch 'curl http://localhost:4000/metrics | grep gateway_circuit_breaker'
```

## Troubleshooting

### Circuit Breaker Stuck OPEN

**Symptom:** All requests return 503, Gemini API actually healthy

**Cause:** Stuck failure count or timeout

**Fix:**
```bash
# Check state
redis-cli GET "circuit-breaker:gemini-api"

# Reset manually (use with caution in production)
redis-cli DEL "circuit-breaker:gemini-api"

# Gradually, it will transition: OPEN → HALF_OPEN (after 30s) → CLOSED
```

### Timeouts Too Aggressive

**Symptom:** Many 503 errors, but Gemini API logs show requests taking 8-9 seconds

**Cause:** Timeout threshold too low (default 10s)

**Fix:**
```bash
export GEMINI_TIMEOUT_MS=15000  # Increase to 15s
# Redeploy and monitor
```

### Retry Loop Creates More Load

**Symptom:** Failure rate increases after adding retries

**Cause:** Retries can amplify load if upstream is struggling

**Fix:**
```bash
# Reduce retry attempts
export RETRY_MAX_ATTEMPTS=2

# Increase initial backoff
export RETRY_INITIAL_DELAY_MS=500

# Add circuit breaker on upstream
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
```

## Production SLOs

| Metric | Target | Action |
|--------|--------|--------|
| Availability (health check) | 99.9% | Page on-call if < 99% per hour |
| P99 latency | < 500ms | Investigate if > 750ms |
| Error rate | < 0.5% | Page on-call if > 2% per 5min |
| Patch success rate | > 80% | Investigate if < 70% |

## Related Documents

- [Multi-Instance Deployment](./multi-instance.md) — Distributed resilience patterns
- [SLOs and Alerts](./slos.md) — Alerting rules based on these metrics
- [Observability](./observability.md) — Setting up dashboards and logging
