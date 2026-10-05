# Multi-Instance Deployment

This document explains how to deploy the Autonomous MFE Orchestrator API Gateway across multiple instances for high availability and horizontal scaling.

## Architecture

The gateway uses **distributed Redis** for state coordination across instances. This enables:
- **Healing lock coordination** — Only one instance generates patches per contract
- **Event propagation** — All instances receive healing events via pub/sub
- **Circuit breaker state sharing** — Failures on one instance affect routing decisions across all instances

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Gateway Pod 1  │     │  Gateway Pod 2  │     │  Gateway Pod 3  │
│  :4000          │     │  :4000          │     │  :4000          │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              ┌─────▼────┐           ┌──────▼──────┐
              │ PostgreSQL│           │ Redis Cluster
              │ (Primary) │           │ (Pub/Sub)
              └───────────┘           └──────────────┘
```

## Setup

### 1. PostgreSQL Configuration

Use a managed PostgreSQL database (AWS RDS, GCP Cloud SQL, Azure Database for PostgreSQL) or self-hosted with replication.

**Connection pooling:**
```bash
# For transactional queries (most requests)
POSTGRES_POOLER_HOST=db-pooler.internal  # Transaction pooler (port 6543)

# For migrations (requires session pooler or direct connection)
# Set in migration-specific env or use:
POSTGRES_DIRECT_URL=db-direct.internal   # Direct connection (port 5432)
```

**Setup script:**
```bash
# 1. Create database and schema
pnpm db:migrate

# 2. Generate test data
pnpm db:seed --owner ops-team@company.com

# 3. Verify connectivity from each pod
psql "$POSTGRES_POOLER_HOST:6543" -U postgres -c "SELECT count(*) FROM organizations;"
```

### 2. Redis Configuration

Use Redis Cluster or Sentinel for high availability. Required for:
- Distributed healing locks (`circuit-breaker:*` keys)
- Pub/Sub event propagation (`healing:events` channel)
- Optional: Request caching

**Single-instance (development only):**
```bash
export REDIS_URL=redis://localhost:6379
```

**Redis Cluster (production):**
```bash
# Multiple nodes for failover
export REDIS_URL=redis://node1:6379,redis://node2:6379,redis://node3:6379

# Or Sentinel:
export REDIS_URL=redis-sentinel://sentinel1:26379,sentinel2:26379,sentinel3:26379/mymaster
```

**Verify:**
```bash
redis-cli -h <REDIS_HOST> PING  # Should return PONG
redis-cli -h <REDIS_HOST> INFO CLUSTER  # Check cluster status
```

### 3. Environment Variables

Each instance needs identical secrets and configuration:

```bash
# Database (required)
POSTGRES_POOLER_HOST=db-pooler.company.com
POSTGRES_DB_PASSWORD=<rotate-regularly>
DIRECT_URL=postgresql://...  # For migrations only

# Redis (required for multi-instance)
REDIS_URL=redis://redis-cluster.company.com:6379

# Encryption
ENCRYPTION_KEY=$(openssl rand -base64 32)  # Generate once, share across instances
KEY_PEPPER=$(openssl rand -base64 32)

# API Keys
GEMINI_API_KEY=<from-google-ai-studio>

# Network
GATEWAY_PORT=4000
ALLOWED_ORIGINS=https://dashboard.company.com,https://mfe-shell.company.com

# Upstream Services (for demo; production should use service discovery)
USER_SERVICE_URL=http://user-service.internal:3001
ORDER_SERVICE_URL=http://order-service.internal:3002
```

**Secrets management:**
- Use HashiCorp Vault, AWS Secrets Manager, or Azure Key Vault
- Rotate `ENCRYPTION_KEY` and `KEY_PEPPER` on a schedule (quarterly or after employee offboarding)
- Store in encrypted secret store, not in container images or config files

### 4. Kubernetes Deployment

Example StatefulSet or Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  replicas: 3  # Horizontal scale for high availability
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
    spec:
      containers:
      - name: gateway
        image: company/api-gateway:1.0.0
        ports:
        - containerPort: 4000
        env:
        - name: POSTGRES_POOLER_HOST
          valueFrom:
            secretKeyRef:
              name: gateway-secrets
              key: postgres-host
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: gateway-secrets
              key: redis-url
        - name: ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: gateway-secrets
              key: encryption-key
        livenessProbe:
          httpGet:
            path: /health/live
            port: 4000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 4000
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

## Distributed Healing Lock

When multiple instances observe the same contract drift, only one should generate a patch to avoid redundant Gemini API calls and conflicting patches.

**Lock mechanism:**
```
Redis key: healing:org:consumer:service:METHOD:/path
Value: instance-id (for debugging)
TTL: 30 seconds (configurable)
```

**Flow:**
1. Instance A observes drift, attempts: `SET healing:org:... instance-a NX EX 30`
2. Instance A acquires lock → generates patch → publishes `healing.completed` event
3. Instance B observes same drift, attempts lock → fails (already held)
4. Instance B waits for retry (exponential backoff 100ms → 200ms → 400ms)
5. After 30s TTL, lock expires; Instance C can attempt

**Monitoring:**
```bash
# Check which instance holds a lock
redis-cli GET "healing:org:default-org:frontend:user:GET:/api/v1/users"
# Returns: "instance-pod-2" or nil if expired

# Check lock contention (estimated waiting instances)
redis-cli INFO STATS | grep rejected_connections
```

## Event Propagation

Healing events are published to Redis pub/sub, allowing all instances and observers (report-service, dashboards) to stay in sync.

**Published events:**
```json
{
  "event": "healing.completed",
  "contractRef": "org:consumer:service:GET:/api/v1/users",
  "patchId": "patch_abc123",
  "timestamp": "2024-10-05T12:34:56Z",
  "source": "instance-pod-2"
}
```

**Subscribers:**
- Dashboard (refresh healing history)
- Report-service (aggregate metrics)
- Canary controller (apply patches)
- Audit logging (compliance)

**Troubleshooting:**
```bash
# Monitor all healing events in real-time
redis-cli SUBSCRIBE "healing:events"

# Check if events are being published
redis-cli MONITOR | grep PUBLISH

# Verify pub/sub is working
redis-cli PUBSUB CHANNELS  # Should show active channels
```

## Circuit Breaker State

Circuit breaker state (for Gemini timeouts, upstream failures) is shared across instances via Redis.

**State storage:**
```
Redis key: circuit-breaker:gemini-api
Value: {state: "CLOSED", failureCount: 0, successCount: 0, nextAttemptAt: 0}
TTL: 24 hours
```

**State values:**
- `CLOSED` (0) — Normal operation, all requests allowed
- `OPEN` (1) — Too many failures, requests fail-fast (return 503 or fallback)
- `HALF_OPEN` (2) — Testing recovery, probe requests allowed

**Example scenario:**
1. Instance A calls Gemini API, gets timeout
2. Instance A increments failure count in Redis
3. After 5 failures, instance A sets state to `OPEN`
4. **All instances** see `OPEN` state, immediately fail-fast without retrying
5. After 30s timeout, state transitions to `HALF_OPEN`
6. Next request acts as probe; if successful, state → `CLOSED`

## Scaling Considerations

### Horizontal Scaling (adding instances)
- No special steps required
- New pods automatically connect to PostgreSQL and Redis
- Healing lock and event propagation work transparently
- Consider readiness probe delay (30s) before adding to load balancer

### Vertical Scaling (increasing per-pod resources)
- Monitor `/metrics` endpoint for CPU and memory usage
- Watch for PostgreSQL connection pool exhaustion (max connections / number of instances)
- Adjust `replicas` if response latencies exceed SLO

### Connection Pool Limits
```
PostgreSQL transaction pooler default: 32 connections
Per-instance typical usage: 8-16 connections
Safe replica count: 32 / 16 = 2 instances max (add failover capacity)
```

Increase pooler connections if adding instances:
```bash
# Update pooler config (cloud provider console or self-hosted)
# Typical: 100 connections + (replicas * 20)
```

## Failure Scenarios

### Instance Crash
- Load balancer removes pod (readiness probe fails)
- Healing locks held by crashed instance expire after 30s
- Other instances pick up work
- **No data loss** (all state in PostgreSQL and Redis)

### PostgreSQL Connection Loss
- **All instances** detect unhealthy status → readiness probe returns 503
- Kubernetes terminates pods and spins up new ones
- **No healing during outage** (API returns 422 for unhealed contracts)
- **No data loss** (writes already persisted)

### Redis Connection Loss
- Healing locks cannot be acquired → new patches not generated
- Events not propagated → dashboards stale
- **Existing patches still applied** (canary routing uses in-memory cache)
- **Failover:** Kubernetes drains pods; new pods reconnect to Redis
- **Monitor:** Set alerts on `redis_connection_errors_total` > 0

### Network Partition (Instance isolated from Redis)
- Instance cannot acquire locks or publish events
- But still serves requests (cache fallback for healed contracts)
- After 30s pod restart (depends on health probe timing)
- **Queries backed by database** still work

## Monitoring & Observability

### Metrics to Alert On
```
# High latency (p99 > 500ms)
histogram_quantile(0.99, gateway_http_duration_seconds) > 0.5

# Errors (non-200 > 5%)
sum(rate(gateway_http_requests_total{status=~"5.."}[5m])) 
  / sum(rate(gateway_http_requests_total[5m])) > 0.05

# Healing success rate (should be > 80%)
sum(rate(gateway_patch_generation_failures_total[5m])) 
  / sum(rate(gateway_patch_generation_duration_seconds_count[5m])) < 0.2

# Circuit breaker open (unusual)
gateway_circuit_breaker_state{name="gemini-api"} == 1

# Redis lock contention
gateway_redis_lock_contention > 2  # More than 2 instances waiting

# Upstream connection issues
increase(gateway_upstream_retries_total[5m]) > 100
```

### Logging
Enable structured JSON logs for production:
```bash
export LOG_LEVEL=info  # debug|info|warn|error
# Output: {"requestId":"req_...", "orgId":"...", "method":"GET", "path":"/api/v1/users", ...}
```

### Dashboards
- **Healing dashboard** — Patch generation rate, success rate by org
- **Performance dashboard** — p50/p99 latency, error rate by endpoint
- **Infrastructure dashboard** — Pod restarts, database connections, Redis memory

## Disaster Recovery

### Backup Strategy
- **Database:** Automated snapshots (hourly, retain 30 days)
- **Redis:** Persistence disabled (state rebuilt from Postgres on restart)
- **Secrets:** Stored in secret manager with version history

### Recovery Procedure
```bash
# 1. Restore PostgreSQL to point-in-time
# (via cloud provider console or using pg_restore)

# 2. Restart all gateway pods (will reconnect to DB and Redis)
kubectl rollout restart deployment/api-gateway

# 3. Verify health
kubectl logs -l app=api-gateway --tail=50 | grep "Circuit"
curl https://api.company.com/health
```

### RTO/RPO Targets
- **RTO:** < 15 minutes (automated failover + pod restart)
- **RPO:** < 1 minute (PostgreSQL snapshots every 1 minute)

## Troubleshooting

### "Lock not acquired" errors
```bash
# Check if lock is stuck
redis-cli GET "healing:org:default-org:..."
# If value is stale instance name, manually delete (don't use in production):
redis-cli DEL "healing:org:default-org:..."
```

### Healing not happening
```bash
# Check if circuit breaker is OPEN
redis-cli GET "circuit-breaker:gemini-api"
# If state: "OPEN", wait 30s for HALF_OPEN or manually reset:
redis-cli DEL "circuit-breaker:gemini-api"
```

### Cross-instance events not received
```bash
# Verify Redis pub/sub working
redis-cli PUBSUB CHANNELS | grep healing
# Should output: healing:events

# Subscribe and watch for events
redis-cli SUBSCRIBE "healing:events"
```

## Next Steps

- [ ] Set up PostgreSQL replication and automated backups
- [ ] Configure Redis Cluster with Sentinel for failover
- [ ] Deploy to Kubernetes with health probes and resource limits
- [ ] Set up monitoring dashboards and alerting
- [ ] Test disaster recovery procedure
- [ ] Document incident response playbook
