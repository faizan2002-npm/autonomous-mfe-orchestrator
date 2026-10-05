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

## Measurement & Review

- **Frequency:** Daily automated checks, weekly manual review
- **Dashboard:** Prometheus + Grafana (TODO: link)
- **Escalation:** If target breached for > 1 hour, page on-call
- **Postmortem:** For any incident impacting SLO target

---

## Future Enhancements

- Add per-endpoint SLOs (critical endpoints < 100ms, non-critical < 500ms)
- Add SLO for healing operation success rate (target: 95%)
- Add SLO for drift detection accuracy (false positive < 5%)
