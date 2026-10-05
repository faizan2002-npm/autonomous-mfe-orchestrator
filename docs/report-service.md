# Report-Service Integration

The report-service is a backend consumer application that subscribes to healing events from the API gateway and aggregates metrics about contract drift and healing activity.

## What is Report-Service?

Report-service is an example backend consumer that demonstrates:
- How to subscribe to gateway events via Server-Sent Events (SSE)
- How to aggregate healing metrics (which contracts are drifting, how often, when they get healed)
- How to expose reports via HTTP API
- How to integrate with observability systems

This can be extended into a full reporting/analytics system for your organization.

## Architecture

```
┌─────────────────────┐
│   API Gateway       │
│  (main service)     │
└──────────┬──────────┘
           │ SSE /api/orgs/{org}/events
           │ (healing.completed, drift.observed)
           │
┌──────────▼──────────┐
│ Report-Service      │
│ (subscriber)        │
│  - Event listener   │
│  - Metrics storage  │
│  - API endpoints    │
└─────────────────────┘
```

## Running Report-Service Locally

### Prerequisites

- Node.js ≥ 20
- API Gateway running on localhost:4000
- Same database and Redis as gateway (for session handling)

### Setup

```bash
# From project root
cd apps/report-service

# Install dependencies
pnpm install

# Set environment variables
export GATEWAY_URL=http://localhost:4000
export DATABASE_URL=postgresql://...  # Same as gateway
export REDIS_URL=redis://localhost:6379
export REPORT_SERVICE_API_KEY=demo-api-key-12345

# Start server
pnpm dev
# Starts on http://localhost:5003
```

### Test Connection

```bash
# Check health
curl http://localhost:5003/health

# Check API
curl http://localhost:5003/api/reports \
  -H "Authorization: Bearer demo-api-key-12345"
```

## API Endpoints

### GET /health

Returns service health status.

```bash
curl http://localhost:5003/health

{
  "status": "healthy",
  "gatewayConnected": true,
  "lastEventAt": "2024-10-05T12:34:56Z"
}
```

### GET /api/reports

Returns aggregated healing reports. Requires API key.

```bash
curl http://localhost:5003/api/reports \
  -H "Authorization: Bearer demo-api-key-12345"

{
  "org": "default-org",
  "totalContracts": 45,
  "driftingContracts": 8,
  "healedContracts": 37,
  "lastHealingAt": "2024-10-05T12:34:56Z",
  "healingSuccessRate": 0.87
}
```

### GET /api/reports/contracts

Detailed report per contract.

```bash
curl http://localhost:5003/api/reports/contracts \
  -H "Authorization: Bearer demo-api-key-12345"

[
  {
    "contractId": "default-org:frontend:user:GET:/api/v1/users",
    "consumer": "frontend",
    "service": "user-service",
    "method": "GET",
    "endpoint": "/api/v1/users",
    "driftCount": 3,
    "lastDriftAt": "2024-10-05T12:34:00Z",
    "healedCount": 2,
    "lastHealedAt": "2024-10-05T12:34:56Z",
    "healingSuccessRate": 0.67
  },
  ...
]
```

### GET /api/reports/timeline

Time-series data for dashboards.

```bash
curl "http://localhost:5003/api/reports/timeline?interval=hourly&days=7" \
  -H "Authorization: Bearer demo-api-key-12345"

{
  "interval": "hourly",
  "data": [
    {
      "timestamp": "2024-09-28T00:00:00Z",
      "driftEvents": 12,
      "healingEvents": 10,
      "failedHealings": 2
    },
    ...
  ]
}
```

## Event Subscription

Report-service subscribes to gateway events via SSE. Events are published when healing occurs.

### Supported Events

```typescript
// Emitted when a contract is healed
{
  "event": "healing.completed",
  "contractRef": "org:consumer:service:GET:/api/v1/users",
  "patchId": "patch_abc123",
  "outcome": "success",  // or "fallback" (used deterministic adapter)
  "timestamp": "2024-10-05T12:34:56Z"
}

// Emitted when drift is observed
{
  "event": "drift.observed",
  "contractRef": "org:consumer:service:GET:/api/v1/users",
  "timestamp": "2024-10-05T12:34:00Z",
  "differences": [
    "Missing field: phoneNumber"
  ]
}

// Emitted when healing fails
{
  "event": "healing.failed",
  "contractRef": "org:consumer:service:GET:/api/v1/users",
  "reason": "Gemini API timeout",
  "timestamp": "2024-10-05T12:34:56Z"
}
```

### Subscribing to Events

```bash
# Subscribe to all events
curl -N http://localhost:5003/api/reports/stream \
  -H "Authorization: Bearer demo-api-key-12345"

# Output:
# data: {"event":"healing.completed","contractRef":"org:frontend:user:GET:/api/v1/users",...}
# data: {"event":"drift.observed","contractRef":"org:frontend:order:POST:/api/v1/orders",...}
```

## Building a Custom Report Service

### Step 1: Listen to Events

```typescript
// service/event-listener.ts
export async function subscribeToEvents(gatewayUrl: string, apiKey: string) {
  const eventSource = new EventSource(
    `${gatewayUrl}/api/orgs/my-org/events`,
    {
      headers: { Authorization: `Bearer ${apiKey}` }
    }
  );

  eventSource.addEventListener('message', (evt) => {
    const data = JSON.parse(evt.data);
    
    switch (data.event) {
      case 'healing.completed':
        onHealingCompleted(data);
        break;
      case 'drift.observed':
        onDriftObserved(data);
        break;
    }
  });
}
```

### Step 2: Store Metrics

```typescript
// service/metrics-storage.ts
import { db } from '../db';

export async function onHealingCompleted(evt: HealingEvent) {
  const [org, consumer, service, method, path] = evt.contractRef.split(':');
  
  // Update contract stats
  await db.contractMetrics.upsert({
    where: { contractRef: evt.contractRef },
    update: {
      lastHealedAt: new Date(evt.timestamp),
      healingCount: { increment: 1 },
      successRate: calculateSuccessRate()
    },
    create: {
      contractRef: evt.contractRef,
      org, consumer, service, method, path,
      lastHealedAt: new Date(evt.timestamp),
      healingCount: 1
    }
  });
}

export async function onDriftObserved(evt: DriftEvent) {
  const [org, consumer, service, method, path] = evt.contractRef.split(':');
  
  await db.contractMetrics.upsert({
    where: { contractRef: evt.contractRef },
    update: {
      lastDriftAt: new Date(evt.timestamp),
      driftCount: { increment: 1 }
    },
    create: {
      contractRef: evt.contractRef,
      org, consumer, service, method, path,
      lastDriftAt: new Date(evt.timestamp),
      driftCount: 1
    }
  });
}
```

### Step 3: Expose Metrics API

```typescript
// controller/reports.controller.ts
import { Request, Response } from 'express';
import * as db from '../service/metrics-storage';

export const getReports = async (req: Request, res: Response) => {
  const org = req.params.org;
  
  const metrics = await db.getOrgMetrics(org);
  
  res.json({
    org,
    totalContracts: metrics.total,
    driftingContracts: metrics.drifting,
    healedContracts: metrics.healed,
    lastHealingAt: metrics.lastHealing,
    healingSuccessRate: metrics.successRate
  });
};

export const getContractDetails = async (req: Request, res: Response) => {
  const org = req.params.org;
  
  const contracts = await db.getContractMetrics(org);
  
  res.json(contracts);
};
```

## Deployment

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: report-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: report-service
  template:
    metadata:
      labels:
        app: report-service
    spec:
      containers:
      - name: report-service
        image: company/report-service:1.0.0
        ports:
        - containerPort: 5003
        env:
        - name: GATEWAY_URL
          value: "http://api-gateway:4000"
        - name: REPORT_SERVICE_API_KEY
          valueFrom:
            secretKeyRef:
              name: report-service-secrets
              key: api-key
        livenessProbe:
          httpGet:
            path: /health
            port: 5003
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 5003
          periodSeconds: 5
```

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 5003

CMD ["node", "dist/index.js"]
```

## Authentication

Report-service uses API key authentication to prevent unauthorized access to metrics.

```bash
# Set API key (environment or config)
export REPORT_SERVICE_API_KEY=super-secret-key

# Clients must include in Authorization header
curl http://localhost:5003/api/reports \
  -H "Authorization: Bearer super-secret-key"

# Invalid key → 401 Unauthorized
curl http://localhost:5003/api/reports \
  -H "Authorization: Bearer wrong-key"
# HTTP/1.1 401 Unauthorized
```

## Integration with External Systems

### Connect to Grafana

1. Add Grafana data source:
   ```
   Type: JSON API
   URL: http://report-service:5003/api
   Custom HTTP headers:
     Authorization: Bearer <api-key>
   ```

2. Create dashboard using the `/api/reports/timeline` endpoint

### Send Alerts

```typescript
// service/alerting.ts
import * as Sentry from "@sentry/node";
import * as Slack from '@slack/web-api';

export async function checkAndAlert() {
  const metrics = await getOrgMetrics();
  
  // Alert if healing success rate drops below 70%
  if (metrics.successRate < 0.7) {
    await slack.chat.postMessage({
      channel: '#alerts',
      text: `⚠️ Healing success rate: ${metrics.successRate}`
    });
    
    Sentry.captureMessage('Low healing success rate');
  }
}
```

### Export to Prometheus

```typescript
// service/prometheus-exporter.ts
import * as promClient from 'prom-client';

export const healingSuccessRate = new promClient.Gauge({
  name: 'report_healing_success_rate',
  help: 'Healing success rate',
  labelNames: ['org']
});

// Update on each event
export async function recordHealing(evt: HealingEvent) {
  const org = evt.contractRef.split(':')[0];
  const rate = await calculateSuccessRate(org);
  healingSuccessRate.labels(org).set(rate);
}
```

## Troubleshooting

### No Events Received

**Symptom:** Report-service health shows `gatewayConnected: false`

**Check:**
```bash
# 1. Verify gateway is running
curl http://localhost:4000/health

# 2. Verify SSE endpoint accessible
curl -N http://localhost:4000/api/orgs/default-org/events \
  -H "Authorization: Bearer <auth-token>"

# 3. Check network connectivity
nc -zv api-gateway 4000  # Should succeed
```

### Events Not Persisting

**Symptom:** Events received but metrics not updating

**Check:**
```bash
# 1. Verify database connectivity
psql "$DATABASE_URL" -c "SELECT count(*) FROM contract_metrics;"

# 2. Check application logs for errors
docker logs report-service | grep error

# 3. Verify event parsing
# Add logging to onHealingCompleted() and onDriftObserved()
```

### API Key Rejected

**Symptom:** 401 Unauthorized on API endpoints

**Check:**
```bash
# 1. Verify API key matches
echo $REPORT_SERVICE_API_KEY

# 2. Check header format (Bearer token)
curl http://localhost:5003/api/reports \
  -H "Authorization: Bearer $REPORT_SERVICE_API_KEY"
  # NOT: -H "Authorization: $REPORT_SERVICE_API_KEY"
```

## Performance Considerations

### Event Processing

- Events are processed serially (one at a time)
- Database writes are batched every 1 minute to reduce load
- Old events (> 30 days) are archived to a separate table

### Storage

- Store raw events for 30 days
- Aggregate metrics indefinitely
- Use table partitioning by date for large datasets

### Scaling

For multiple orgs with high event volume:
```
Events per second: 100 / 3600 = 0.028/s per org
Storage per month: ~240MB (compressed)
Query latency: < 100ms for monthly reports

Scale-up triggers:
- Events > 1/s → Add event consumer
- Storage > 10GB → Implement data archival
- Query latency > 500ms → Add cache layer
```

## Next Steps

- [ ] Implement custom business logic for your org
- [ ] Connect to Grafana or other BI tools
- [ ] Set up alerting for SLO violations
- [ ] Archive old data for compliance
- [ ] Build dashboard for leadership reporting
