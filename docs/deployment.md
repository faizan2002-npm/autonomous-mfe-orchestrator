# Deployment Guide — Autonomous MFE Orchestrator

This guide covers deploying the API Gateway to local, staging, and production environments.

## Table of Contents

1. [Local Development](#local-development)
2. [Docker Build](#docker-build)
3. [Kubernetes Deployment](#kubernetes-deployment)
4. [AWS ECS](#aws-ecs)
5. [Google Cloud Run](#google-cloud-run)
6. [Environment Variables](#environment-variables)
7. [Secrets Management](#secrets-management)
8. [Health Checks](#health-checks)
9. [Monitoring & Observability](#monitoring--observability)
10. [Troubleshooting](#troubleshooting)

---

## Local Development

### Prerequisites

- **Node.js** 20+ ([install](https://nodejs.org/))
- **Docker** & **Docker Compose** ([install](https://docs.docker.com/get-docker/))
- **pnpm** 9+ (`npm install -g pnpm@9`)

### Quick Start

```bash
# Clone repo and install
git clone https://github.com/your-org/orchestrator.git
cd orchestrator
pnpm install

# Start all services (postgres, redis, gateway, dashboard, MFEs)
docker-compose up

# In a new terminal, run migrations
pnpm db:migrate

# Seed demo data (optional)
pnpm db:seed
```

The gateway will be available at:
- **API**: http://localhost:4000
- **Dashboard**: http://localhost:5100
- **MFE Shell**: http://localhost:5000
- **Health check**: http://localhost:4000/health/ready
- **Metrics**: http://localhost:9090/metrics (Prometheus format)

### Development with Hot Reload

For faster iteration, run the gateway with pnpm dev:

```bash
# Terminal 1: Start postgres and redis only
docker-compose up postgres redis

# Terminal 2: Start gateway with hot reload
pnpm dev
```

The gateway will rebuild on file changes.

---

## Docker Build

### Build the Image

```bash
# Build for current platform
docker build -t orchestrator-gateway:latest .

# Build for multi-platform (requires buildx)
docker buildx build --platform linux/amd64,linux/arm64 -t orchestrator-gateway:latest .
```

### Push to Registry

```bash
# Login to your registry (e.g., Docker Hub, ECR, GCR)
docker login

# Tag and push
docker tag orchestrator-gateway:latest myregistry/orchestrator-gateway:latest
docker push myregistry/orchestrator-gateway:latest

# Or use buildx to build and push in one step
docker buildx build --platform linux/amd64,linux/arm64 \
  -t myregistry/orchestrator-gateway:latest --push .
```

### Image Info

- **Base image**: `node:20-alpine` (lightweight, ~150 MB)
- **Runtime user**: Non-root (`nodejs:nodejs` uid 1001)
- **Exposed ports**: 
  - `4000` — API Gateway
  - `9090` — Prometheus metrics (optional, disable if not needed)
- **Healthcheck**: Built-in (`GET /health/live`)
- **Signals**: Gracefully handles SIGTERM with `dumb-init`

---

## Kubernetes Deployment

### Prerequisites

- **Kubernetes cluster** 1.23+
- **kubectl** configured
- **Postgres** (Managed by Supabase Cloud) or external RDS
- **Redis** (Upstash Cloud) or managed ElastiCache

### Namespace and Secrets

```bash
# Create namespace
kubectl create namespace orchestrator

# Create secret for sensitive env vars (NEVER commit .env!)
kubectl create secret generic gateway-secrets \
  --from-literal=ENCRYPTION_KEY=<base64-32-byte-key> \
  --from-literal=KEY_PEPPER=<base64-32-byte-pepper> \
  --from-literal=GEMINI_API_KEY=<api-key> \
  --from-literal=REDIS_URL=rediss://user:pass@upstash-redis.com:6379 \
  --from-literal=SUPABASE_DB_PASSWORD=<password> \
  -n orchestrator
```

### ConfigMap for Non-Sensitive Config

```bash
kubectl create configmap gateway-config \
  --from-literal=LOG_LEVEL=info \
  --from-literal=ALLOWED_ORIGINS="https://app.example.com,https://admin.example.com" \
  --from-literal=USER_SERVICE_URL=https://user-service.example.com \
  --from-literal=ORDER_SERVICE_URL=https://order-service.example.com \
  -n orchestrator
```

### Deployment Manifest (save as `k8s/deployment.yaml`)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: gateway
  namespace: orchestrator
spec:
  type: LoadBalancer  # or ClusterIP if using ingress
  ports:
    - name: http
      port: 80
      targetPort: 4000
      protocol: TCP
    - name: metrics
      port: 9090
      targetPort: 9090
      protocol: TCP
  selector:
    app: gateway

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
  namespace: orchestrator
spec:
  replicas: 3  # Horizontal scaling
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: gateway
  template:
    metadata:
      labels:
        app: gateway
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: gateway
      terminationGracePeriodSeconds: 35  # Allow 30s shutdown + 5s buffer
      containers:
      - name: gateway
        image: myregistry/orchestrator-gateway:latest
        imagePullPolicy: Always
        ports:
        - name: http
          containerPort: 4000
          protocol: TCP
        - name: metrics
          containerPort: 9090
          protocol: TCP
        
        env:
        # Non-sensitive config from ConfigMap
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: gateway-config
              key: LOG_LEVEL
        - name: ALLOWED_ORIGINS
          valueFrom:
            configMapKeyRef:
              name: gateway-config
              key: ALLOWED_ORIGINS
        - name: USER_SERVICE_URL
          valueFrom:
            configMapKeyRef:
              name: gateway-config
              key: USER_SERVICE_URL
        - name: ORDER_SERVICE_URL
          valueFrom:
            configMapKeyRef:
              name: gateway-config
              key: ORDER_SERVICE_URL
        
        # Sensitive secrets from Secret
        - name: ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: gateway-secrets
              key: ENCRYPTION_KEY
        - name: KEY_PEPPER
          valueFrom:
            secretKeyRef:
              name: gateway-secrets
              key: KEY_PEPPER
        - name: GEMINI_API_KEY
          valueFrom:
            secretKeyRef:
              name: gateway-secrets
              key: GEMINI_API_KEY
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: gateway-secrets
              key: REDIS_URL
        - name: SUPABASE_DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: gateway-secrets
              key: SUPABASE_DB_PASSWORD
        
        # Other config
        - name: GATEWAY_PORT
          value: "4000"
        - name: SUPABASE_PROJECT_REF
          value: "abc123xyz"  # Your project ID
        - name: SUPABASE_POOLER_HOST
          value: "db.supabase.co"
        - name: SUPABASE_POOLER_PORT
          value: "6543"
        - name: SUPABASE_ISOLATION_LEVEL
          value: "read_committed"
        - name: NODE_ENV
          value: "production"
        - name: CIRCUIT_BREAKER_BACKEND
          value: "redis"
        - name: SHUTDOWN_TIMEOUT_MS
          value: "30000"
        - name: METRICS_ENABLED
          value: "true"
        
        # Resource limits
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        
        # Liveness probe (is the process alive?)
        livenessProbe:
          httpGet:
            path: /health/live
            port: http
          initialDelaySeconds: 5
          periodSeconds: 30
          timeoutSeconds: 10
          failureThreshold: 3
        
        # Readiness probe (ready to serve traffic?)
        readinessProbe:
          httpGet:
            path: /health/ready
            port: http
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 10
          failureThreshold: 3
        
        # Startup probe (allow time to initialize)
        startupProbe:
          httpGet:
            path: /health/ready
            port: http
          initialDelaySeconds: 0
          periodSeconds: 5
          timeoutSeconds: 5
          failureThreshold: 30  # 30 * 5s = 150s max startup time
        
        # Security context
        securityContext:
          runAsNonRoot: true
          runAsUser: 1001
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
              - ALL
        
        # Volume mounts (if needed for temp files)
        volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /app/.node_modules_cache
      
      volumes:
      - name: tmp
        emptyDir: {}
      - name: cache
        emptyDir: {}

---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gateway
  namespace: orchestrator

---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: gateway
  namespace: orchestrator
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: gateway
```

### Deploy to Kubernetes

```bash
# Apply manifests
kubectl apply -f k8s/deployment.yaml

# Check rollout
kubectl rollout status deployment/gateway -n orchestrator

# Port-forward for testing
kubectl port-forward svc/gateway 4000:80 -n orchestrator

# View logs
kubectl logs -f deployment/gateway -n orchestrator --tail 100

# Scale up/down
kubectl scale deployment gateway --replicas=5 -n orchestrator
```

### Ingress (Optional)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: gateway
  namespace: orchestrator
spec:
  ingressClassName: nginx
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: gateway
            port:
              number: 80
  tls:
  - hosts:
    - api.example.com
    secretName: api-cert  # Managed by cert-manager
```

---

## AWS ECS

### Prerequisites

- **AWS Account** with ECS, ECR, RDS, ElastiCache permissions
- **AWS CLI** configured
- **Postgres** via RDS or Aurora
- **Redis** via ElastiCache

### 1. Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name orchestrator-gateway \
  --region us-east-1

# Get login token and push image
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com

docker tag orchestrator-gateway:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/orchestrator-gateway:latest
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/orchestrator-gateway:latest
```

### 2. Create ECS Task Definition

```json
{
  "family": "orchestrator-gateway",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "gateway",
      "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/orchestrator-gateway:latest",
      "portMappings": [
        {
          "containerPort": 4000,
          "hostPort": 4000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "GATEWAY_PORT",
          "value": "4000"
        },
        {
          "name": "SUPABASE_POOLER_HOST",
          "value": "db.example-123.us-east-1.rds.amazonaws.com"
        },
        {
          "name": "CIRCUIT_BREAKER_BACKEND",
          "value": "redis"
        }
      ],
      "secrets": [
        {
          "name": "ENCRYPTION_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:orchestrator/encryption-key"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:orchestrator/redis-url"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/orchestrator-gateway",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "curl -f http://localhost:4000/health/live || exit 1"
        ],
        "interval": 30,
        "timeout": 10,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

### 3. Create ECS Service

```bash
aws ecs create-service \
  --cluster orchestrator \
  --service-name gateway \
  --task-definition orchestrator-gateway \
  --desired-count 3 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=gateway,containerPort=4000" \
  --region us-east-1
```

---

## Google Cloud Run

### 1. Build and Push Image

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/orchestrator-gateway:latest

# Or push manually
docker tag orchestrator-gateway:latest gcr.io/PROJECT_ID/orchestrator-gateway:latest
docker push gcr.io/PROJECT_ID/orchestrator-gateway:latest
```

### 2. Deploy to Cloud Run

```bash
gcloud run deploy orchestrator-gateway \
  --image gcr.io/PROJECT_ID/orchestrator-gateway:latest \
  --region us-central1 \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10 \
  --min-instances 1 \
  --set-env-vars REDIS_URL=$REDIS_URL,SUPABASE_DB_PASSWORD=$SUPABASE_DB_PASSWORD,... \
  --set-secrets ENCRYPTION_KEY=encryption-key:latest,KEY_PEPPER=key-pepper:latest \
  --allow-unauthenticated
```

---

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `ENCRYPTION_KEY` | Base64-encoded 32-byte key for at-rest encryption | `dGVzdC1rZXktMzItYnl0ZXM=` |
| `KEY_PEPPER` | Base64-encoded 32-byte pepper for API key hashing | `dGVzdC1wZXBwZXItMzItYnl0ZXM=` |
| `REDIS_URL` | Redis connection URL (Upstash) | `rediss://user:pass@upstash.com:6379` |
| `SUPABASE_DB_PASSWORD` | Postgres password | (auto-generated by Supabase) |
| `GEMINI_API_KEY` | Google Gemini API key | `AIzaSy...` |

### Optional (with Defaults)

| Variable | Default | Notes |
|----------|---------|-------|
| `GATEWAY_PORT` | `4000` | Port to listen on |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `CIRCUIT_BREAKER_BACKEND` | `memory` | Set to `redis` for multi-instance |
| `GEMINI_TIMEOUT_MS` | `10000` | 10 seconds |
| `SHUTDOWN_TIMEOUT_MS` | `30000` | 30 seconds |
| `RATE_LIMIT_PER_MINUTE` | `600` | Per API key |
| `METRICS_ENABLED` | `true` | Expose `/metrics` endpoint |
| `DRIFT_SIMILARITY_THRESHOLD` | `0.15` | 0-1 scale |
| `CANARY_TRAFFIC_PERCENTAGE` | `10` | Percentage to canary |

See `.env.example` for full list.

---

## Secrets Management

### ⚠️ DO NOT commit `.env` to git!

1. **Local Development**: Use `.env.local` (gitignored)
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your values
   ```

2. **Kubernetes**: Use `kubectl create secret`
   ```bash
   kubectl create secret generic gateway-secrets --from-file=.env -n orchestrator
   ```

3. **AWS Secrets Manager**:
   ```bash
   aws secretsmanager create-secret \
     --name orchestrator/encryption-key \
     --secret-string "dGVzdC1lbmNyeXB0aW9uLWtleSI="
   ```

4. **Vault** (if using):
   ```bash
   vault kv put secret/orchestrator encryption_key="..." key_pepper="..."
   ```

### Key Rotation

**WARNING**: Changing `ENCRYPTION_KEY` or `KEY_PEPPER` after data exists will break all stored secrets. Plan rotation carefully:

1. Generate new key
2. Deploy code that reads both old and new key
3. Migrate all encrypted data to use new key
4. Delete old key after migration complete

---

## Health Checks

### Liveness Probe (`/health/live`)

- **Purpose**: Is the process alive?
- **Expects**: Always returns `200` (even if connections are down)
- **Kubernetes**: 
  ```yaml
  livenessProbe:
    httpGet:
      path: /health/live
      port: 4000
    periodSeconds: 30
  ```

### Readiness Probe (`/health/ready`)

- **Purpose**: Is the service ready to handle requests?
- **Expects**: `200` when healthy, `503` when:
  - Postgres unreachable
  - Redis unreachable
  - Service is shutting down
- **Kubernetes**:
  ```yaml
  readinessProbe:
    httpGet:
      path: /health/ready
      port: 4000
    periodSeconds: 10
    failureThreshold: 3
  ```

### Test Health Checks Locally

```bash
# Should return 200
curl http://localhost:4000/health/live

# Should return 200 if postgres/redis healthy
curl http://localhost:4000/health/ready

# Stop postgres to see 503
docker-compose stop postgres
curl http://localhost:4000/health/ready  # Returns 503
docker-compose start postgres
```

---

## Monitoring & Observability

### Prometheus Metrics

The gateway exposes metrics at `GET /metrics` (Prometheus format):

```bash
curl http://localhost:4000/metrics | head -20

# Output:
# HELP gateway_patch_generation_duration_seconds Time to generate patch
# TYPE gateway_patch_generation_duration_seconds histogram
# gateway_patch_generation_duration_seconds_bucket{le="0.1"} 5
# ...
```

#### Key Metrics

| Metric | Type | Labels | Example |
|--------|------|--------|---------|
| `gateway_patch_generation_duration_seconds` | Histogram | `org_id` | Time to generate patch |
| `gateway_patch_generation_failures_total` | Counter | `org_id`, `reason` | Patch failures |
| `gateway_circuit_breaker_state` | Gauge | `name` (`gemini-api`) | 0=CLOSED, 1=OPEN, 2=HALF_OPEN |
| `gateway_gemini_requests_total` | Counter | (none) | Requests to Gemini |
| `gateway_gemini_timeouts_total` | Counter | (none) | Gemini timeouts |
| `gateway_http_requests_duration_seconds` | Histogram | `method`, `path`, `status` | HTTP latency |

### Configure Prometheus Scraping

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'orchestrator'
    static_configs:
      - targets: ['localhost:4000']
    metrics_path: '/metrics'
```

### Structured JSON Logging

The gateway logs to stdout in JSON format:

```json
{
  "level": "info",
  "timestamp": "2025-10-05T14:32:10Z",
  "request_id": "req_xyz123",
  "org_id": "org_abc",
  "action": "patch_generated",
  "duration_ms": 2340,
  "message": "Generated patch for contract"
}
```

Kubernetes will automatically parse and index these logs. Query in Datadog, ELK, or Loki:

```
level:error AND action:patch_generation_failed
```

---

## Troubleshooting

### Gateway won't start

1. Check logs:
   ```bash
   docker logs orchestrator-gateway
   # or
   kubectl logs deployment/gateway -n orchestrator
   ```

2. Verify environment variables:
   ```bash
   docker run -it myregistry/orchestrator-gateway:latest env | grep REDIS
   ```

3. Check database connectivity:
   ```bash
   # From container
   psql -h $SUPABASE_POOLER_HOST -U postgres -d orchestrator -c "SELECT 1"
   ```

4. Check Redis connectivity:
   ```bash
   # From container
   redis-cli -u $REDIS_URL ping
   ```

### High latency on patch generation

1. Check Gemini API quota: `GEMINI_API_KEY` valid?
2. Check circuit breaker state: `curl http://localhost:4000/metrics | grep circuit_breaker`
3. Check Redis latency: `redis-cli LATENCY LATEST`
4. Reduce `GEMINI_TIMEOUT_MS` to fail faster (default 10s)

### Memory usage growing

1. Check for memory leaks in polling loops (healing, outbox worker)
2. Verify `NODE_MAX_OLD_SPACE_SIZE` in container (default 512MB, may need `--memory 1Gi`)
3. Check CircuitBreakerService: in-memory map should be small (2-3 entries)

### Graceful shutdown taking > 30s

1. Check for long-running patch generations
2. Increase `SHUTDOWN_TIMEOUT_MS` env var
3. Verify healing/outbox/policy workers can be interrupted
4. Check logs: `grep "shutdown" container logs`

---

## Next Steps

- Set up Prometheus + Grafana for metrics dashboards
- Configure alerting rules (e.g., circuit breaker open, high error rate)
- Plan database backup strategy
- Document runbooks for on-call team
