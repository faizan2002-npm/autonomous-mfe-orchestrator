# Runbook: Database Connection Pool Exhausted

## Severity: CRITICAL

**Impact:** All new requests fail with "connection pool exhausted". Existing connections work until timeout. Service becomes unresponsive.

---

## Symptoms

- Alert: `DatabaseConnectionPoolExhausted` fires
- Prometheus: `db_connection_pool_active >= db_connection_pool_size`
- Logs: `ENOMEM` or "no available connections" errors
- Users: All requests timing out (typically after 30 seconds)

---

## Immediate Actions (0-5 minutes)

1. **Confirm pool is exhausted:**
   ```bash
   psql -h $SUPABASE_POOLER_HOST -U postgres -c "SELECT * FROM pg_stat_activity;" | wc -l
   # Should show >= 20 connections (pool size)
   ```

2. **Check recent queries:**
   ```bash
   psql -h $SUPABASE_POOLER_HOST -U postgres -c "
   SELECT pid, usename, state, wait_event, query 
   FROM pg_stat_activity 
   WHERE state != 'idle' 
   ORDER BY xact_start DESC LIMIT 20;"
   ```

3. **Is it a query lock?**
   - Look for queries with `wait_event = 'Lock'`
   - Check if any query has been running > 10 minutes
   - This is likely the culprit

4. **Immediate mitigation:**
   - **Option A:** Kill the long-running query
     ```bash
     psql -h $SUPABASE_POOLER_HOST -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid = <long_pid>;"
     ```
   - **Option B:** Restart the gateway (clears all connections)
     ```bash
     kubectl rollout restart deployment/api-gateway
     ```

---

## Root Cause Diagnosis (5-30 minutes)

### Case 1: Long-Running Query Lock
**Diagnosis:**
- Query stuck in LOCK wait for > 5 minutes
- Likely: Healing operation acquiring `FOR UPDATE SKIP LOCKED` that blocks others

**Action:**
- Kill the blocking transaction: `pg_terminate_backend(blocker_pid)`
- Check healing service logs for error after cancellation
- If it retries and succeeds, pool drains

### Case 2: Connection Leak
**Diagnosis:**
- No obvious long-running query
- Idle connections accumulate
- Ratio of idle:active grows each hour

**Action:**
- Check code for unclosed database connections
- Look for `.then()` chains without `.finally(() => connection.release())`
- Common in: notification outbox worker, event handlers

### Case 3: Sudden Traffic Spike
**Diagnosis:**
- Pool used normally 1 hour ago
- Suddenly all slots filled
- No change in code/config

**Action:**
- Check request volume: did traffic spike 10x?
- Check if a runaway job started (e.g., bulk operation)
- Verify no DDoS happening

### Case 4: Slow Queries Cascading
**Diagnosis:**
- No single long query
- Many queries running slowly (> 1 second each)
- New requests queue up, pool fills

**Action:**
- Check query logs: `SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;`
- Look for sequential scans on large tables (missing index)
- Check if full table scan triggered by migration or schema change

---

## Resolution Steps

### If Long-Running Query Lock
1. Identify blocking query: `SELECT * FROM pg_blocking_pids(<waiter_pid>);`
2. Decide: kill it, or wait for it to complete?
   - Safe to kill if: auto-retryable (healing, import job)
   - Risky if: user-initiated operation (data loss possible)
3. Kill if safe: `pg_terminate_backend(<blocker_pid>)`
4. Pool should drain in < 30 seconds

### If Connection Leak
1. Check recently deployed code for database changes
2. Look for: try/finally blocks, connection.release() calls
3. If found, redeploy fix or revert change
4. Monitor pool recovery (should show > 50% idle within 5 minutes)

### If Traffic Spike / Slow Queries
1. **Increase pool size (temporary):**
   ```bash
   kubectl set env deployment/api-gateway DB_POOL_SIZE=30
   # Requires connection string update in Supabase pooler
   ```
2. **Identify and optimize slow query:**
   - Add index: `CREATE INDEX idx_contract_org ON contracts(org_id);`
   - Or simplify query logic
3. **Implement per-endpoint rate limiting** (if applicable)

### Post-Recovery
1. Verify pool healthy: `db_connection_pool_active < db_connection_pool_size`
2. Check error rate back to normal: P95 latency < 200ms
3. Wait 15 minutes for full stability

---

## Prevention

- **Monitor pool usage:** Alert if > 80% usage for > 5 min
- **Query timeout:** Set `statement_timeout = 30s` in pool config
- **Long operation handling:** Healing/import jobs should use separate connection pool (or worker thread)
- **Code review:** Check all database code for proper connection release
- **Load testing:** Test under 2x expected peak load

---

## Escalation

- **5 min:** Still exhausted → restart gateway (force fix)
- **15 min:** After restart, still happening → page DBA

---

## See Also

- [Connection Pool Tuning](../cost-optimization.md#connection-pool)
- [Query Performance Debugging](../debugging.md#slow-queries)
