# Disaster Recovery Procedure

## Overview

This document provides procedures for recovering from major failures affecting the Autonomous MFE Orchestrator. It covers data restoration, failover, and verification.

**RTO (Recovery Time Objective):** 1 hour  
**RPO (Recovery Point Objective):** 15 minutes

---

## Failure Scenarios

### Scenario 1: Complete Database Corruption/Loss

**Symptoms:**
- All database queries fail with corruption errors
- Supabase dashboard shows "Database Unhealthy"
- Cascading failures in all gateway services

**Immediate Action (0-15 min):**
1. **Declare incident:** Page database team, engineering lead, and product lead
2. **Establish war room:** Slack thread #incident-response
3. **Prevent further writes:**
   ```bash
   # Stop all gateway instances to prevent more writes
   kubectl scale deployment api-gateway --replicas=0
   kubectl scale deployment outbox-worker --replicas=0
   ```
4. **Assess recovery options:**
   - Is this a Supabase infrastructure issue? Check Supabase status page
   - Is data corrupted or completely lost?
   - Do we have a recent backup available?

**Recovery (15 min - 1 hour):**
1. **Determine backup to restore:**
   - Supabase automatic backups: taken every 6 hours
   - Check Supabase dashboard → Backups
   - Select most recent backup (ideally < 15 min ago)

2. **Restore from backup:**
   ```bash
   # In Supabase dashboard:
   # 1. Go to Backups
   # 2. Select recent backup
   # 3. Click "Restore"
   # 4. Choose restore point (closest to incident start)
   # 5. Restore will take 5-10 minutes
   # 6. Wait for "Restore Complete"
   ```

3. **Verify restored data:**
   ```bash
   # Connect to restored database
   psql -h $SUPABASE_POOLER_HOST -U postgres -c "
   SELECT COUNT(*) as org_count FROM orgs;
   SELECT COUNT(*) as patch_count FROM patches;
   SELECT COUNT(*) as audit_count FROM governance_audits
   WHERE created_at > NOW() - INTERVAL '24 hours';
   "
   # Verify counts match expected (from status dashboard or team memory)
   ```

4. **Restart gateway:**
   ```bash
   kubectl scale deployment api-gateway --replicas=3
   # Wait for pods to be Ready
   kubectl wait --for=condition=Ready pod -l app=api-gateway --timeout=300s
   ```

5. **Verify service health:**
   ```bash
   curl http://api-gateway-service:4000/health/ready
   # Should return 200 with all checks passing
   ```

6. **Test user operations:**
   - Verify dashboard loads
   - Attempt a small healing operation (test org)
   - Check notification delivery (monitor outbox backlog)

---

### Scenario 2: Redis Failure (Multi-instance Circuit Breaker State Lost)

**Symptoms:**
- Circuit breaker metrics unavailable
- Each gateway instance independently opens circuits
- Healing lock contention (duplicate healing attempts)
- Upstash unavailable (check Upstash status page)

**RTO:** 30 minutes (manual failover or Upstash recovery)

**Recovery:**

1. **Wait for Upstash recovery (most likely):**
   - Check Upstash status page
   - If scheduled maintenance: will recover in 5-15 min automatically
   - If incident: page Upstash support

2. **Verify Redis is back:**
   ```bash
   redis-cli -h $UPSTASH_HOST -p $UPSTASH_PORT ping
   # Should return PONG
   ```

3. **Check gateway health:**
   ```bash
   # Gateway should continue operating (Redis is optional for single-instance)
   curl http://api-gateway-service:4000/health/ready
   # Should still be 200
   ```

4. **Reset circuit breaker state (if needed):**
   ```bash
   # If upstreams are healthy but circuits still open:
   redis-cli -h $UPSTASH_HOST -p $UPSTASH_PORT DEL 'circuit-breaker:*'
   # Circuits will regenerate from healthy state
   ```

**Prevention:** Consider implementing Redis failover to backup Redis or switching to self-managed Redis on k8s with automatic failover.

---

### Scenario 3: Supabase Connection Pool Exhausted (No New Connections)

**Symptoms:**
- New API requests return 500 ("Database connection failed")
- Active connections continue working
- After ~30 sec, all requests timeout
- Runbook: See `docs/runbooks/database-connection-pool-exhausted.md`

**RTO:** 10 minutes

**Recovery:**

1. **Immediately:**
   ```bash
   # Check for long-running query lock:
   psql -h $SUPABASE_POOLER_HOST -U postgres -c "
   SELECT pid, usename, state, wait_event, query 
   FROM pg_stat_activity 
   WHERE state != 'idle' 
   ORDER BY xact_start DESC LIMIT 5;"
   ```

2. **If lock found:**
   ```bash
   # Kill the long-running query
   psql -h $SUPABASE_POOLER_HOST -U postgres -c "SELECT pg_terminate_backend(<pid>);"
   # Pool should drain in < 30 sec
   ```

3. **If no obvious lock:**
   ```bash
   # Restart gateway to reset all connections
   kubectl rollout restart deployment/api-gateway
   # Wait for pods to be Ready
   kubectl wait --for=condition=Ready pod -l app=api-gateway --timeout=300s
   ```

---

### Scenario 4: Multi-Instance Healing Lock Deadlock (No Healing Happening)

**Symptoms:**
- Healings stuck in "healing_pending" state for hours
- No patch generation occurring
- Redis "healing:*" locks never released
- Multiple instances trying to acquire lock simultaneously

**RTO:** 15 minutes

**Recovery:**

1. **Check lock state:**
   ```bash
   redis-cli -h $UPSTASH_HOST -p $UPSTASH_PORT KEYS 'healing:*'
   # Should show healing locks for specific contracts
   ```

2. **Force-unlock stuck healings:**
   ```bash
   # Clear all healing locks
   redis-cli -h $UPSTASH_HOST -p $UPSTASH_PORT DEL 'healing:*'
   # Locks will regenerate after healing service processes contracts again
   ```

3. **Restart healing service (if deadlocked instance):**
   ```bash
   # If specific instance is stuck:
   kubectl delete pod <api-gateway-pod-name>
   # New pod will start fresh, acquire locks cleanly
   ```

4. **Verify healing resumes:**
   ```bash
   # Monitor logs:
   kubectl logs -f deployment/api-gateway | grep "Circle breaker\|healing"
   # Should see healing attempts after a few minutes
   ```

---

### Scenario 5: Complete Cluster Failure (All Instances Down, Infrastructure Gone)

**Symptoms:**
- No gateway pods running
- No database connectivity
- No Redis connectivity
- User-facing outage

**RTO:** 4 hours (complete rebuild), 30 min (failover to standby cluster)

**Recovery Option A: Rebuild (if no standby available)**

1. **Restore database from backup** (see Scenario 1)
2. **Rebuild infrastructure:**
   ```bash
   # Using IaC (Terraform / Helm)
   terraform apply  # or helm upgrade
   # Deploy gateway container
   kubectl apply -f deployment.yaml
   ```
3. **Restore configuration:**
   - Copy .env from secure backup
   - Verify all secrets set
4. **Verify service health** (see above)

**Recovery Option B: Failover to Standby Cluster (if available)**

1. **Verify standby cluster is ready:**
   ```bash
   kubectl --context=standby-cluster get nodes
   # Should show healthy nodes
   ```

2. **Switch DNS to standby:**
   ```bash
   # Update DNS CNAME to point to standby load balancer
   # Or update Kubernetes Service to route to standby
   # This is provider-specific (Route 53, CloudFlare, etc.)
   ```

3. **Verify traffic flows to standby:**
   ```bash
   curl https://api-gateway.company.com/health/ready
   # Should route to standby cluster and return 200
   ```

4. **Restore database to standby:**
   - Restore from same backup as above
   - Verify data consistency

---

## Data Consistency Verification

After any restore, verify data integrity:

```bash
# Check audit log consistency
psql -h $SUPABASE_POOLER_HOST -U postgres -c "
SELECT COUNT(*) as total_audits,
       COUNT(DISTINCT org_id) as unique_orgs,
       MAX(created_at) as latest_audit
FROM governance_audits;"

# Check contracts are not orphaned
SELECT COUNT(*) as orphaned_contracts
FROM contracts c
WHERE NOT EXISTS (SELECT 1 FROM orgs o WHERE o.id = c.org_id);
# Should return 0

# Check patches have associated contracts
SELECT COUNT(*) as orphaned_patches
FROM patches p
WHERE NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = p.contract_id);
# Should return 0

# Verify notification queue is not bloated
SELECT COUNT(*) as queued_notifications
FROM notification_deliveries
WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 day';
# Alert if > 1000
```

---

## Testing & Validation

### Monthly Backup Test
```bash
# 1st of every month:
# 1. Snapshot production backup
# 2. Restore to test environment
# 3. Run data consistency checks (above)
# 4. Verify dashboard loads
# 5. Attempt sample API calls
# Result: If all pass, backup is valid
```

### Quarterly Failover Test (if standby available)
```bash
# Q1, Q2, Q3, Q4 (planned maintenance window):
# 1. Switch traffic to standby cluster
# 2. Verify all user operations work
# 3. Switch back to primary
# 4. Document issues encountered
```

### Annual DR Drill
- Full team disaster recovery exercise
- Simulate database loss, practice restore
- Measure actual RTO vs target
- Update procedures based on learnings

---

## Prevention: Reducing Need for Disaster Recovery

1. **Database Health:**
   - Enable Supabase replication to secondary region
   - Monitor connection pool usage; alert at 80%
   - Regular VACUUM to prevent bloat

2. **Redis Redundancy:**
   - Upstash includes automatic failover (included in paid tier)
   - Or self-manage Redis with Sentinel/Cluster for HA

3. **Application Resilience:**
   - Multi-instance deployments: Already deployed
   - Graceful degradation: Healings fail gracefully, notifications retry
   - Circuit breakers: Prevent cascading failures

4. **Monitoring & Alerting:**
   - PagerDuty alerts for database errors, connection pool exhaustion
   - Health check alerts if service down > 5 minutes
   - Notification backlog alerts if > 1000 pending

---

## Post-Recovery

1. **Root Cause Analysis:**
   - What caused the failure? Hardware, software, configuration?
   - Was RTO/RPO met?
   - What early warning signs were missed?

2. **Improvement Plan:**
   - Implement missing monitoring alerts
   - Increase backup frequency if necessary
   - Upgrade infrastructure if single points of failure
   - Update this document with lessons learned

3. **Communication:**
   - Post-incident review with team
   - Send customer status update (if user-facing)
   - Document timeline in incident tracking system

---

## Contact Information

**On-Call Escalation:**
- L1 (First responder): Check #incident-response Slack
- L2 (Database): [DBA contact]
- L3 (Infrastructure): [DevOps lead contact]
- Exec: [VP Engineering contact]

**Vendor Contacts:**
- Supabase Support: support@supabase.com
- Upstash Support: support@upstash.com
- Cloud Provider (AWS/GCP): [Account manager]

---

## Appendix: Recovery Checklist

- [ ] Incident declared, war room established
- [ ] Identify failure scenario
- [ ] Assess impact (user-facing? data loss? silent failure?)
- [ ] Execute recovery steps for scenario
- [ ] Verify data integrity post-restore
- [ ] Restart services and verify health
- [ ] Test user operations
- [ ] Check monitoring/alerting is operational
- [ ] Update incident timeline
- [ ] Schedule post-mortem (within 48h)
- [ ] Document lessons learned
