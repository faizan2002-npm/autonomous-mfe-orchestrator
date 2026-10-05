# Runbook: Circuit Breaker Stuck Open

## Severity: HIGH

**Impact:** Requests to a specific upstream service fail immediately without retry. Users see errors when calling affected operations.

---

## Symptoms

- Alert: `CircuitBreakerOpen` fires (breaker open > 5 minutes)
- Prometheus metric: `circuit_breaker_state{state="open"} == 1`
- Logs: `Circuit breaker [service] -> OPEN` message ~5+ minutes ago
- User complaints: Requests to specific MFE or endpoint failing with "service unavailable"

---

## Immediate Actions (0-5 minutes)

1. **Identify which circuit is open:**
   ```bash
   kubectl logs -l app=api-gateway | grep "Circuit breaker"
   # OR
   curl http://localhost:9090/metrics | grep circuit_breaker_state
   ```
   Look for service name (e.g., `user-service`, `order-service`)

2. **Check upstream service status:**
   ```bash
   curl -I https://<upstream-url>/health
   ```
   Expected: 200 OK. If 503 or timeout, upstream is down.

3. **Page on-call if upstream down:** File incident and notify affected teams

4. **Temporary mitigation (manual reset):**
   - Option A: Restart gateway (forces in-memory circuit state reset)
   - Option B: Wait for automatic recovery (circuit attempts HALF_OPEN after resetTimeoutMs = 30s, then closes after 5 successes)

---

## Root Cause Diagnosis (5-30 minutes)

### Case 1: Upstream Service is Down
**Diagnosis:**
- `curl https://<upstream-url>/health` returns 503 or timeout
- Recent upstream deployment logs show errors
- Circuit breaker is working as designed

**Action:**
- Alert upstream team immediately
- Escalate to infrastructure: check load balancer health checks, database connectivity
- Do NOT force-close circuit (it will just reopen)

### Case 2: Flaky Upstream (Intermittent Failures)
**Diagnosis:**
- Upstream `/health` probe passes
- But some requests fail intermittently
- Circuit opened after 5 consecutive failures in short time

**Action:**
- Check upstream error logs for recent errors (last 15 minutes)
- Look for patterns: specific endpoints? specific user data? timeout vs 5xx?
- May indicate upstream code issue or resource exhaustion

### Case 3: Network/DNS Issues
**Diagnosis:**
- Upstream is healthy in its own logs
- Gateway cannot reach it (connection timeout, DNS failure)
- Check gateway logs: `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`

**Action:**
- Verify network path: `ping <upstream-host>`, `nc -zv <host> <port>`
- Check DNS: `nslookup <upstream-url>`
- Verify firewall rules allow gateway → upstream

### Case 4: Circuit Breaker Configuration Issue
**Diagnosis:**
- Upstream is healthy
- But circuit keeps opening on first request
- Likely: `halfOpenRequests: 1` causing oscillation

**Action:**
- Upgrade to halfOpenRequests: 5 (if not already done)
- Circuit will now require 5 successes before fully closing
- Prevents oscillation on flaky upstreams

---

## Resolution Steps

### If Upstream is Down
1. Restore upstream service (restart container, deploy fix, etc.)
2. Once upstream `/health` returns 200, circuit will auto-recover:
   - Circuit transitions OPEN → HALF_OPEN after resetTimeoutMs (30s)
   - Attempts 1 request
   - If success, transitions to CLOSED after 5 successes (per new config)
3. Wait up to 5 minutes for full recovery

### If Upstream is Flaky
1. Investigate and fix upstream issue (see case 2 diagnosis)
2. Or: Increase circuit breaker thresholds (if too aggressive)
   - Current: `failureThreshold: 5` (opens after 5 failures)
   - Could increase to `failureThreshold: 10` for less aggressive circuit opening

### If Network Connectivity Issue
1. Restore network path (DNS, firewall, load balancer)
2. Test connectivity: `curl https://<upstream-url>/health` from gateway container
3. Circuit auto-recovers once connectivity restored

### Force Reset (Last Resort)
Only if upstream is confirmed healthy but circuit won't close:
```bash
# In-memory mode: restart gateway pod
kubectl delete pod -l app=api-gateway

# Multi-instance (Redis): clear Redis state
redis-cli DEL 'circuit-breaker:*'
```
⚠️ Use caution: may mask underlying upstream issues

---

## Prevention

- Monitor circuit breaker state: `CircuitBreakerOpen` alert triggers at 5 minutes
- Upstream services should implement exponential backoff + jitter to avoid thundering herd
- Consider bulkhead isolation: one failing upstream shouldn't impact others
- Test circuit breaker behavior: intentionally fail an upstream, verify circuit works as expected

---

## Escalation

- **15 min:** Still open → page on-call infrastructure
- **1 hour:** Still open → page on-call engineering lead + upstream team lead

---

## Post-Incident

1. Document root cause
2. If upstream issue: add pre-incident detection (e.g., upstream health monitoring)
3. If circuit too aggressive: tune `failureThreshold` or `resetTimeoutMs`
4. Review timeout/retry settings on gateway → upstream calls
