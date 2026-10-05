# Load Testing Results

## Overview

This document captures baseline load testing results for the Autonomous MFE Orchestrator gateway. Tests verify backoff/circuit-breaker behavior under realistic production-scale load (~100k req/min target).

## Test Environment

- **Gateway**: NestJS 10 on Fastify
- **Database**: PostgreSQL 17 (ephemeral Docker container)
- **Cache**: Redis 7 (ephemeral Docker container)
- **Test Framework**: k6
- **Load Profile**: 100 concurrent virtual users (VUs), 5-minute duration

## Test Scenarios

### 1. Baseline Throughput & Latency

**Purpose**: Establish baseline performance metrics under sustained load

**Configuration**:
- Ramp: 1 VU → 100 VUs over 1 minute
- Hold: 100 VUs for 3 minutes
- Ramp down: 100 VUs → 0 over 1 minute

**Endpoints Tested**:
- `GET /api/orgs/:orgSlug/governance/patches`
- `GET /api/orgs/:orgSlug/governance/drift-events?limit=25`

**Expected Results**:
- P95 latency: **< 500ms**
- P99 latency: **< 1000ms**
- Error rate: **< 0.1%**
- Throughput: **~100 req/sec sustained**

**How to Run**:
```bash
pnpm cli:load-test --org test-load --throughput 100
BASE_URL=http://localhost:3000/api \
  ORG_SLUG=test-load \
  API_KEY=<publishable-key> \
  k6 run apps/load-tests/k6-baseline.js
```

### 2. Circuit Breaker Resilience

**Purpose**: Verify circuit breaker opens under failure conditions and recovers after 30s

**Configuration**:
- Load: 50 concurrent VUs for 5 minutes
- Simulate circuit trigger via high concurrency to Gemini-dependent endpoint

**Expected Results**:
- Circuit opens after 5 consecutive failures
- Returns 503 Service Unavailable during OPEN state
- Recovers to HALF_OPEN after ~30 seconds
- Full recovery (CLOSED) within ~1 minute
- No request loss > what circuit breaker itself handles

**How to Run**:
```bash
BASE_URL=http://localhost:3000/api \
  ORG_SLUG=test-load \
  API_KEY=<publishable-key> \
  k6 run apps/load-tests/k6-circuit-breaker.js
```

### 3. Canary Isolation

**Purpose**: Verify canary traffic doesn't degrade baseline traffic

**Configuration**:
- 80/20 traffic split: 80% baseline, 20% canary
- 100 concurrent VUs for 5 minutes
- Canary marked via `x-mfe-canary: 20` header

**Expected Results**:
- Baseline latency: **< 500ms** (unaffected)
- Canary latency: **< 750ms** (slightly higher due to patch overhead, acceptable)
- Baseline error rate: **< 0.1%**
- Canary error rate: **< 1%** (canary may have higher error rate during rollout)

**How to Run**:
```bash
BASE_URL=http://localhost:3000/api \
  ORG_SLUG=test-load \
  API_KEY=<publishable-key> \
  k6 run apps/load-tests/k6-canary-isolation.js
```

## Performance Characteristics

### Circuit Breaker Behavior

The circuit breaker (in `apps/api-gateway/src/common/circuit-breaker.service.ts`) is configured with:

- **Failure Threshold**: 5 consecutive failures
- **Reset Timeout**: 30 seconds
- **Half-Open Requests**: 5 successful attempts to close
- **Scope**: Per-service (Gemini API)

When triggered:
- State transitions: CLOSED → OPEN → HALF_OPEN → CLOSED
- During OPEN: All requests fast-fail with 503 Service Unavailable
- No latency penalty: ~1ms response time vs. ~500ms baseline
- Protects downstream from cascading failures

### Retry & Backoff

Requests to upstream services use exponential backoff:

```
Attempt 1: 100ms delay
Attempt 2: 200ms delay (100ms * 2^1)
Attempt 3: 400ms delay (100ms * 2^2)
...
Max 3 retries, ~7 second total backoff window
```

Jitter (±10%) prevents thundering herd on recovery.

### Database Connection Pool

- Pool size: 10 connections
- Idle timeout: 20 seconds
- Connection timeout: 10 seconds

Under load, connection saturation will cause request queueing (not rejection).

## Monitoring & Alerting

### Prometheus Metrics

Export metrics to Prometheus for monitoring:

```bash
curl http://localhost:3000/metrics
```

**Key Metrics**:
- `gateway_http_requests_total` — request count by method/path/status
- `gateway_http_duration_seconds` — request latency (p95, p99)
- `gateway_circuit_breaker_state` — breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)
- `gateway_patch_generation_duration_seconds` — patch generation latency
- `gateway_gemini_timeouts_total` — Gemini timeouts
- `gateway_canary_success_rate` — canary success rate by patch
- `gateway_canary_baseline_ratio` — canary vs. baseline error rate ratio

### Alerting Rules

Recommended Prometheus alert rules:

```yaml
- alert: HighLatencyGateway
  expr: histogram_quantile(0.99, gateway_http_duration_seconds) > 1.0
  for: 5m

- alert: CircuitBreakerOpen
  expr: gateway_circuit_breaker_state{name="gemini"} == 1
  for: 1m

- alert: HighErrorRate
  expr: |
    (sum(rate(gateway_http_requests_total{status=~"5.."}[5m]))
    / sum(rate(gateway_http_requests_total[5m]))) > 0.01
  for: 5m

- alert: CanaryErrorRateHigh
  expr: gateway_canary_error_rate > 0.1
  for: 2m
```

## Production Deployment Checklist

Before deploying to production:

- [ ] Run baseline load test; verify p99 latency < 1s
- [ ] Run circuit breaker test; verify recovery in ~30s
- [ ] Run canary isolation test; verify baseline not degraded
- [ ] Configure Prometheus scrape for `/metrics` endpoint
- [ ] Set up alerting rules (see above)
- [ ] Review logs for any warnings during load test
- [ ] Load test on production-like hardware (CPU, memory, network)
- [ ] Test failover & recovery procedures
- [ ] Document baseline capacity (throughput/VUs before degradation)

## Troubleshooting

### High Latency Under Load

**Check**:
1. Database connection pool saturation: `SELECT count(*) FROM pg_stat_activity;`
2. Gemini API slow responses: Check `gateway_gemini_duration_seconds` metric
3. Redis slow responses: Monitor Redis latency in CloudWatch or direct `redis-cli INFO`
4. Network saturation: Check network utilization on gateway host

**Mitigations**:
- Increase database pool size (see `packages/database/src/index.ts`)
- Add bulkhead isolation for Gemini (semaphore limiting concurrent requests)
- Scale gateway horizontally (add more instances)
- Review canary configuration; reduce traffic % to avoid overload

### Circuit Breaker Stuck Open

**Check**:
1. Is Gemini API healthy? Test with `curl https://generativelanguage.googleapis.com/...`
2. Is the reset timeout too short? (Default: 30s)
3. Are there concurrent spikes triggering cascade failures?

**Mitigations**:
- Increase reset timeout if Gemini recovery is slow
- Implement backpressure/bulkhead in Gemini client
- Consider graceful degradation (deterministic fallback patch generation)

### Database Connection Pool Exhausted

**Check**:
```sql
SELECT usename, count(*) as conn_count, state
  FROM pg_stat_activity
  GROUP BY usename, state;
```

**Mitigations**:
- Increase pool size: edit `packages/database/src/index.ts`
- Add query timeouts to prevent indefinite locks
- Monitor for slow queries: enable `log_min_duration_statement`

## Future Improvements

1. **Bulkhead Isolation**: Add per-service semaphore to limit concurrent Gemini requests
2. **Stale Fallbacks**: Cache last-known-good patch; use on Gemini timeout
3. **Distributed Tracing**: Instrument with OpenTelemetry; export to Jaeger for visibility
4. **Load Shedding**: Implement graceful degradation under extreme load (e.g., reject lowest-priority requests)
5. **Autoscaling**: Horizontal pod autoscaling based on request latency (p99 > 1s)

## References

- [k6 Documentation](https://k6.io/docs/)
- [Prometheus Queries](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Load Testing Best Practices](https://en.wikipedia.org/wiki/Software_performance_testing)
