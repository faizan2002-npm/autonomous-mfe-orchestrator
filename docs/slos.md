# Service Level Objectives (SLOs)

## Overview

This document defines the SLOs for the Autonomous MFE Orchestrator API Gateway in production.

**Target Availability:** 99.9% (2 nines)
- Max acceptable downtime: ~43 minutes per month

---

## SLO Targets

### Latency
- **P95 response time:** < 200ms (95th percentile of requests)
- **P99 response time:** < 500ms (99th percentile of requests)
- **Measured:** Time from request received to response sent (excludes network transit)
- **Scope:** Proxy requests to upstreams (excludes long-running operations like healing)

### Error Rate
- **Threshold:** < 0.1% (1 in 1000 requests)
- **Definition:** HTTP 5xx responses + unhandled exceptions
- **Excludes:** Client errors (4xx), rate-limited requests (429)
- **Measured:** Per minute, 5-minute rolling window

### Availability
- **Target:** 99.9% uptime per month
- **Definition:** Service responds to health probe (/health/ready) with 200 status
- **Grace period:** 30s startup, 30s graceful shutdown
- **Multi-instance:** At least one instance healthy

---

## SLI (Service Level Indicators)

### Indicator: API Latency
```
P95(http_request_duration_seconds) < 0.2s
```
**Source:** Prometheus metric `http_request_duration_seconds_bucket`
**Alert:** If P95 > 0.3s for 5 minutes (early warning)
**Critical:** If P95 > 0.5s for 2 minutes

### Indicator: Error Rate
```
(sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))) < 0.001
```
**Source:** Prometheus metric `http_requests_total`
**Alert:** If error rate > 0.5% for 5 minutes
**Critical:** If error rate > 1% for 1 minute

### Indicator: Health Check Success
```
sum(rate(health_check_passed_total[5m])) / sum(rate(health_check_total[5m])) > 0.999
```
**Source:** Prometheus metric `health_check_*`
**Alert:** If health check failure rate > 0.5%
**Critical:** If service down (no successful checks in 2 minutes)

### Indicator: Circuit Breaker State
```
circuit_breaker_state{state="open"} == 1 for > 5 minutes
```
**Source:** Prometheus metric `circuit_breaker_state`
**Alert:** If any circuit breaker open > 5 minutes
**Action:** Check upstream service status; may need manual intervention

### Indicator: Notification Delivery
```
(sum(rate(notification_delivery_failed_total[5m])) / sum(rate(notification_delivery_total[5m]))) < 0.1
```
**Source:** Prometheus metrics `notification_delivery_*`
**Alert:** If failure rate > 10%
**Action:** Check email provider status; check database connections

---

## Error Budget

With 99.9% availability target:

| Period | Allowed Downtime |
|--------|------------------|
| **Monthly** | ~43 minutes |
| **Weekly** | ~10 minutes |
| **Daily** | ~1.3 minutes |

When error budget depleted, prioritize stability over new features until next period.

---

## Prometheus Alert Rules

### Critical Alerts (Page on-call immediately)

```yaml
groups:
  - name: api-gateway-critical
    interval: 30s
    rules:
      # Service is down
      - alert: GatewayDown
        expr: up{job="api-gateway"} == 0 for 2m
        annotations:
          summary: "API Gateway is down for {{ $value }} instances"
          description: "Gateway has not responded to health checks for 2 minutes"
        labels:
          severity: critical
          runbook: "gateway-down"

      # Too many errors
      - alert: HighErrorRate
        expr: (sum(rate(gateway_http_requests_total{status=~"5.."}[5m])) / sum(rate(gateway_http_requests_total[5m]))) > 0.01
        for: 1m
        annotations:
          summary: "Error rate {{ $value | humanizePercentage }} exceeds 1%"
          description: "API Gateway error rate is > 1% for 1 minute"
        labels:
          severity: critical
          runbook: "high-error-rate"

      # P99 latency degradation
      - alert: HighLatencyP99
        expr: histogram_quantile(0.99, rate(gateway_http_duration_seconds_bucket[5m])) > 0.5
        for: 2m
        annotations:
          summary: "P99 latency {{ $value | humanizeDuration }} exceeds 500ms"
          description: "API Gateway P99 latency is > 500ms for 2 minutes"
        labels:
          severity: critical
          runbook: "high-latency"

      # Database connection issues
      - alert: DatabaseConnectionPoolExhausted
        expr: (gateway_database_connections_active / gateway_database_connections_max) > 0.9
        for: 5m
        annotations:
          summary: "Database connection pool {{ $value | humanizePercentage }} exhausted"
          description: "Database connection pool usage > 90% for 5 minutes ({{ $value }} connections)"
        labels:
          severity: critical
          runbook: "db-connection-pool-exhausted"

      # Redis connection loss
      - alert: RedisConnectionLost
        expr: redis_up{instance="redis:6379"} == 0
        for: 1m
        annotations:
          summary: "Redis connection lost for {{ $value }} instances"
          description: "Redis is unreachable for 1 minute"
        labels:
          severity: critical
          runbook: "redis-down"

      # Circuit breaker stuck open
      - alert: CircuitBreakerOpen
        expr: gateway_circuit_breaker_state{name="gemini-api"} == 1
        for: 5m
        annotations:
          summary: "Gemini API circuit breaker open for 5 minutes"
          description: "Circuit breaker is stuck OPEN; Gemini API may be down or failing"
        labels:
          severity: warning
          runbook: "circuit-breaker-investigation"
```

### Warning Alerts (Page on-call if business hours)

```yaml
  - name: api-gateway-warning
    interval: 60s
    rules:
      # Early warning: latency degradation
      - alert: LatencyWarning
        expr: histogram_quantile(0.95, rate(gateway_http_duration_seconds_bucket[5m])) > 0.3
        for: 5m
        annotations:
          summary: "P95 latency {{ $value | humanizeDuration }} is elevated"
          description: "P95 latency > 300ms (target: 200ms). Investigate performance degradation."
        labels:
          severity: warning
          runbook: "latency-investigation"

      # Early warning: error rate rising
      - alert: ErrorRateWarning
        expr: (sum(rate(gateway_http_requests_total{status=~"5.."}[5m])) / sum(rate(gateway_http_requests_total[5m]))) > 0.005
        for: 5m
        annotations:
          summary: "Error rate {{ $value | humanizePercentage }} is elevated (target: 0.1%)"
          description: "Error rate exceeded 0.5% for 5 minutes. Investigate root cause."
        labels:
          severity: warning
          runbook: "error-rate-investigation"

      # Patch generation failures
      - alert: PatchGenerationFailures
        expr: (sum(rate(gateway_patch_generation_failures_total[5m])) / sum(rate(gateway_patch_generation_duration_seconds_count[5m]))) > 0.3
        for: 10m
        annotations:
          summary: "Patch generation failure rate {{ $value | humanizePercentage }} is elevated"
          description: "Over 30% of patch generations are failing. Check Gemini API status."
        labels:
          severity: warning
          runbook: "patch-generation-investigation"

      # High lock contention
      - alert: HighLockContention
        expr: gateway_redis_lock_contention > 5
        for: 5m
        annotations:
          summary: "Lock contention {{ $value }} instances waiting"
          description: "High number of instances waiting for distributed healing locks. May indicate slow patches or many concurrent drifts."
        labels:
          severity: warning
          runbook: "lock-contention-investigation"
```

---

## On-Call Runbooks

### gateway-down

**Symptoms:** API Gateway unreachable; dashboard shows "service unavailable"

**Investigation:**
```bash
# Check pod status
kubectl get pods -l app=api-gateway

# Check logs for startup errors
kubectl logs -l app=api-gateway --tail=100

# Check health endpoints
curl https://api.company.com/health/live
curl https://api.company.com/health/ready

# Check database connectivity
psql "$POSTGRES_POOLER_HOST:6543" -c "SELECT 1;"
redis-cli -h $REDIS_HOST PING
```

**Recovery:**
1. **If startup failed:** Check .env variables, secrets, database schema
2. **If dependency down:** Follow [db-connection-pool-exhausted](#db-connection-pool-exhausted) or [redis-down](#redis-down) runbook
3. **If logs show OOM:** Increase pod memory limits; restart pods
4. **If still down:** Escalate to platform team; check if recent deployment broke config

**Escalation:** Platform team (cloud infra) if > 5 minutes unresolved

---

### high-error-rate

**Symptoms:** Errors on /api/v1/* routes; dashboard shows red; users report failures

**Investigation:**
```bash
# Check error types
curl "https://prometheus.company.com/api/v1/query?query=topk(10, rate(gateway_http_requests_total{status=~'5..'}[5m]))"

# Check logs for exceptions
kubectl logs -l app=api-gateway --grep="ERROR" --tail=50

# Check if circuit breaker open
redis-cli GET "circuit-breaker:gemini-api"

# Check upstream services
for svc in user-service order-service; do
  curl "http://$svc:3001/health"
done
```

**Common Causes & Recovery:**
- **Gemini timeout:** Circuit breaker open → Wait 30s for HALF_OPEN recovery. If persists, check Gemini API status (google.com)
- **Database errors:** Check connections: `SELECT count(*) FROM pg_stat_activity;`
- **Upstream 5xx:** Restart failing upstream service
- **Memory exhaustion:** Check `kubectl top nodes`; may need horizontal scaling

**Escalation:** If error rate > 1% for > 5 minutes, page on-call

---

### high-latency

**Symptoms:** Dashboard shows p99 > 500ms; users report slow responses

**Investigation:**
```bash
# Check which endpoints are slow
curl "https://prometheus.company.com/api/v1/query?query=topk(5, histogram_quantile(0.99, rate(gateway_http_duration_seconds_bucket[5m])) by (path))"

# Check if database is slow
kubectl exec -it <pod> -- psql -c "SELECT NOW() - query_start, query FROM pg_stat_activity WHERE state='active';"

# Check Redis latency
redis-cli --latency-samples 100 -h $REDIS_HOST

# Check CPU/memory on pods
kubectl top pods -l app=api-gateway
```

**Recovery:**
1. **High CPU:** Scale horizontally (add more pods)
2. **High memory:** Restart pods; check for memory leaks in logs
3. **Database slow:** Add indexes; check for lock contention; restart if in deadlock
4. **Network latency:** Check if k8s CNI is congested; restart pods to redistribute

---

### db-connection-pool-exhausted

**Symptoms:** Requests timing out; logs show "connection pool exhausted"

**Quick Fix:**
```bash
# Reduce max connections temporarily to prevent thrashing
kubectl set env deployment/api-gateway DATABASE_MAX_CONNECTIONS=16

# Restart pods to reconnect
kubectl rollout restart deployment/api-gateway
```

**Investigation:**
```bash
# Check connection usage
psql -c "SELECT count(*) as used, max_conn FROM (SELECT count(*) max_conn FROM pg_settings WHERE name='max_connections') CROSS JOIN pg_stat_activity;"

# Check for leaked connections
psql -c "SELECT usename, count(*) FROM pg_stat_activity GROUP BY usename;"

# Check for long-running queries
psql -c "SELECT now() - query_start as duration, query FROM pg_stat_activity WHERE state != 'idle' ORDER BY duration DESC;"
```

**Recovery:**
- Kill idle connections: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle' AND query_start < now() - '30 min'::interval;`
- Increase pool size in cloud provider console
- Increase replica count if using connection pooling per pod

---

### redis-down

**Symptoms:** Circuit breaker decisions not shared; events not propagated; healing hangs

**Quick Fix:**
```bash
# Verify Redis is actually down
redis-cli -h $REDIS_HOST PING

# If unresponsive, restart Redis pod
kubectl delete pod <redis-pod>
```

**Investigation:**
```bash
# Check Redis CPU/memory
kubectl top pods -l app=redis

# Check Redis logs
kubectl logs -l app=redis --tail=50

# Check network
kubectl exec -it <pod> -- telnet $REDIS_HOST 6379
```

**Recovery:**
- Restart Redis pod and wait for reconnection (~ 30 seconds)
- If corrupted, restore from backup
- During outage, healing is disabled (will 422 responses); this is safe

---

### circuit-breaker-investigation

**Symptoms:** Circuit breaker open; all patch generation attempts fail immediately

**Investigation:**
```bash
# Check circuit breaker state
redis-cli GET "circuit-breaker:gemini-api"

# Check Gemini API status
# Visit https://status.cloud.google.com/ or curl Gemini API
curl -X POST https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -d '{"contents":[{"parts":[{"text":"test"}]}]}'

# Check gateway logs for Gemini errors
kubectl logs -l app=api-gateway | grep -i gemini | tail -20
```

**Recovery:**
- If Gemini API is down: Wait for recovery (no action needed; fallback adapter will be used)
- If local network issue: Restart gateway pods
- Manual reset (use carefully): `redis-cli DEL "circuit-breaker:gemini-api"`

---

## Measurement & Review

- **Frequency:** Daily automated checks, weekly manual review
- **Dashboard:** Prometheus + Grafana dashboard: `https://grafana.company.com/d/gateway-slo`
- **Escalation:** If SLO target breached for > 1 hour, page on-call
- **Postmortem:** For any incident impacting SLO target
- **Budget Tracking:** Weekly review of error budget consumption

---

## Future Enhancements

- Add per-endpoint SLOs (critical endpoints < 100ms, non-critical < 500ms)
- Add SLO for healing operation success rate (target: 95%)
- Add SLO for drift detection accuracy (false positive < 5%)
- Implement automated remediation (circuit breaker reset, pod restart) for common failures
