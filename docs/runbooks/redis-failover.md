# Runbook: Redis Failover / Upstash Maintenance

## Severity: HIGH (if Upstash down), MEDIUM (if graceful maintenance)

**Impact:** Circuit breaker state lost, multi-instance healing lock coordination fails. Single-instance deployments unaffected (use in-memory fallback).

---

## Symptoms

- Alert: `RedisConnectionFailed` (if implemented)
- Logs: `Redis ECONNREFUSED` or `timeout`
- Prometheus: `redis_up == 0`
- Healing operations: Attempting retry (each instance independently opens circuit breaker)

---

## Immediate Actions (0-5 minutes)

1. **Check Upstash status:**
   ```bash
   redis-cli -h $UPSTASH_HOST -p $UPSTASH_PORT ping
   # Should return PONG or connection error
   ```

2. **Is it scheduled maintenance?**
   - Check Upstash dashboard: Settings → Maintenance window
   - If yes: Expected, wait for restore (typically 5-15 minutes)
   - If no: Page Upstash support

3. **Verify gateway still functional:**
   ```bash
   curl http://localhost:4000/health/ready
   # Should return 200 (Redis is optional for single-instance)
   ```
   If healthy: Users can still use gateway, just without cross-instance coordination

---

## During Redis Downtime

**What continues working:**
- ✅ Proxy requests
- ✅ API consumers
- ✅ Single-instance health checks
- ❌ Circuit breaker state across instances
- ❌ Multi-instance healing lock (each instance tries independently)

**Expected behavior:**
- Multi-instance deployments: Each instance independently opens its own circuit breaker
- May result in duplicate healing attempts or race conditions
- Should stabilize once Redis restored

---

## Recovery Steps

1. **Wait for Upstash to restore** (usually automatic after maintenance)
   - Monitor: `redis-cli ... ping`
   - Once `PONG` returns, Redis is back

2. **Verify gateway health:**
   ```bash
   curl http://localhost:4000/health/ready
   # Should still be 200 (not affected by Redis)
   ```

3. **Check circuit breaker recovery:**
   - If upstreams still healthy: Circuits auto-recover
   - If Redis was down > 24h: Circuit state expired, reset automatically
   - Manually trigger state refresh: Restart one gateway instance

4. **Verify event propagation:**
   - Monitor: Healing notifications should resume
   - Check: `rate(redis_set_total[5m]) > 0`

---

## Preventive Measures

- **Multi-instance always-on:** Upstash has SLA (99.99%). Acceptable risk.
- **Circuit breaker fallback:** Consider storing state in database if Redis critical
- **Monitoring:** Alert when Redis `PING` fails
- **Testing:** Periodically simulate Redis failure in staging

---

## Escalation

- **5 min no response:** Check Upstash status page
- **15 min no response + user impact:** Page Upstash support immediately
- **30 min no response:** Consider failover to backup Redis or restart gateways

---

## Post-Incident

- Document how long Redis was down
- Verify no data loss in healing operations
- If frequent: Consider migrating to self-managed Redis on k8s (tradeoff: operational complexity)
