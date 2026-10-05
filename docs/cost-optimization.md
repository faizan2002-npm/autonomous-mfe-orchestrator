# Cost Optimization Guide

This document provides strategies for optimizing costs in the Autonomous MFE Orchestrator without sacrificing performance or reliability.

---

## Database Connection Pool

### Current Configuration
- **Pool size:** 20 connections (default)
- **Pool timeout:** 30 seconds
- **Suitable for:** ~20 concurrent requests

### Right-Sizing the Pool

**Measure current usage:**
```sql
-- Check active connections
SELECT COUNT(*) FROM pg_stat_activity WHERE state != 'idle';

-- Check max concurrent requests over last hour
SELECT MAX(active_connections) FROM metrics
WHERE timestamp > NOW() - INTERVAL '1 hour';
```

**Adjust based on load:**
- **Low traffic (< 5 concurrent):** Reduce to 10 (saves cost)
- **Medium traffic (5-20 concurrent):** Keep at 20 (current)
- **High traffic (> 20 concurrent):** Increase to 30-40

**Cost impact:**
- Supabase charges per active connection (on higher tiers)
- Reducing pool size from 20 → 10 can save ~5% on database costs

### Implementation
```env
# .env
DB_POOL_SIZE=15  # Adjust based on your load
DB_POOL_TIMEOUT_MS=30000
```

---

## Redis Memory Optimization

### Current Usage
- Circuit breaker state (minimal: ~10 bytes per circuit × 10 circuits = 100 bytes)
- Healing locks (minimal: ~5 bytes per contract × 100 concurrent = 500 bytes)
- Outbound event cache (if enabled: 1-10 MB typical)

### Cost Optimization
1. **Monitor memory usage:**
   ```bash
   redis-cli INFO memory
   # Output: used_memory_human: 5M
   ```

2. **Upstash pricing tiers:**
   - **Free:** 10 MB (suitable for < 100 healing operations/day)
   - **Pay-as-you-go:** $0.25 per 1GB per month (suitable for production)

3. **Right-size plan:**
   - If using < 20 MB: Free tier is sufficient
   - If using 20-100 MB: Pay-as-you-go is cost-effective
   - Monitor monthly: If growing, evaluate circuit breaker TTL reduction

---

## Gemini API Model Selection

### Model Costs (as of 2024)

| Model | Input Cost | Output Cost | Speed | Quality |
|-------|-----------|-----------|-------|---------|
| **gemini-2-flash-lite** | $0.04/1M tokens | $0.16/1M tokens | 🟢 Fast | 🟡 Good |
| **gemini-2-flash** | $0.075/1M tokens | $0.3/1M tokens | 🟢 Fast | 🟢 Excellent |
| **gemini-2-pro** | $1.50/1M tokens | $6.00/1M tokens | 🟠 Slow | 🟢🟢 Best |

**Current setting:** `gemini-2-flash-lite` (recommended for cost)

### Cost Analysis
Assume average patch generation: 10K input + 2K output tokens

**Cost per patch:**
- **flash-lite:** (10K × $0.04 + 2K × $0.16) / 1M = $0.64 per 1000 patches
- **flash:** (10K × $0.075 + 2K × $0.3) / 1M = $1.35 per 1000 patches
- **pro:** (10K × $1.50 + 2K × $6.00) / 1M = $27 per 1000 patches

**Recommendation:** Stick with `gemini-2-flash-lite` unless your drift detection needs highest accuracy (> 5% false positives).

### Switching Models
```env
# .env
GEMINI_MODEL=gemini-2-flash-lite  # Default (cheapest)
# GEMINI_MODEL=gemini-2-flash     # Higher quality, 2x cost
```

---

## Rate Limiting Tuning

### Current Configuration
- **Per API key:** 600 requests per minute (default)
- **Estimated cost:** 600 × 60 × 24 × 30 = 25.9M requests/month

### Cost Optimization
1. **Tier-based rate limits:**
   ```
   - Free tier: 100 req/min  ($0-50/month usage)
   - Starter: 300 req/min    ($50-500/month usage)
   - Enterprise: Unlimited   (Custom pricing)
   ```

2. **Measure actual usage:**
   ```sql
   SELECT consumer_id, COUNT(*) as requests_per_hour
   FROM request_logs
   WHERE timestamp > NOW() - INTERVAL '1 hour'
   GROUP BY consumer_id
   ORDER BY requests_per_hour DESC;
   ```

3. **Adjust limits per consumer:**
   - Most consumers: 100-200 req/min is sufficient
   - High-volume: 500+ req/min
   - Use per-consumer rate limits instead of global

### Implementation
```typescript
// In consumer-auth.service.ts
async rateLimit(consumerId: string): Promise<boolean> {
  const tier = await this.getConsumerTier(consumerId);
  const limit = {
    'free': 100,
    'starter': 300,
    'pro': 1000,
  }[tier];
  // Check if request count in last minute < limit
  return true; // Allow
}
```

---

## Caching Strategies

### Response Caching (Already Implemented)
- **Config:** 5-minute cache TTL for GET requests
- **Cost savings:** Reduces upstream calls by ~40% for read-heavy workloads

### Add Contract Schema Caching
If contract schemas are requested frequently:
```typescript
// Cache schema for 1 hour (rarely changes)
const schemaCache = new Map();
const SCHEMA_CACHE_TTL = 3600000;

async getSchema(contractId: string) {
  const cached = schemaCache.get(contractId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.schema;
  }
  
  const schema = await this.loadSchema(contractId);
  schemaCache.set(contractId, {
    schema,
    expiresAt: Date.now() + SCHEMA_CACHE_TTL,
  });
  return schema;
}
```

---

## Bandwidth Optimization

### Current Approach
- Full request/response bodies logged (helpful for debugging)
- Cost: ~50 KB per request × 1M requests = 50 GB/month

### Optimize
1. **Log sampling:**
   ```typescript
   // Log 10% of requests only
   if (Math.random() < 0.1) {
     logger.debug('Request body', { body });
   }
   ```
   - Reduces logs to ~5 GB/month
   - Still catches issues for debugging

2. **Reduce body size:**
   - Don't log entire payload for large responses
   - Log first 1 KB only for debugging

---

## Notification Delivery Cost

### Email Cost (via Resend)
- **Free tier:** 100 emails/day
- **Pay-as-you-go:** $0.0001 per email (free up to 100/day)

**Monthly estimate:** 100 healing notifications + 50 policy notifications = 150/day = 4500/month = $0.45

### Optimization
- **Current:** Notify on all policy decisions (promote, rollback)
- **Optimized:** Notify only on rollback (negative outcome)
  - Reduces notifications by 50%
  - Saves ~$0.20/month (not material, but simplifies)

---

## Infrastructure Recommendations

### Single-Region (Current)
- **Supabase (PostgreSQL):** $25-100/month depending on tier
- **Upstash (Redis):** $0-20/month
- **Gemini API:** $0.001-0.1/month (pay-as-you-go, very cheap)
- **Resend (Email):** Free for < 100/day
- **Total:** ~$25-120/month

### Multi-Region (Future)
Consider only if:
- RTO requirement < 1 hour (requires standby cluster)
- Serving multiple geographies
- **Cost:** +$50-200/month (standby Postgres + regional Upstash)

---

## Monthly Cost Estimate

| Component | Estimate | Notes |
|-----------|----------|-------|
| Database | $50-100 | Supabase Postgres |
| Cache | $5-20 | Upstash Redis |
| LLM | $0.01-1 | Gemini API (pay-as-you-go) |
| Email | $0.50 | Resend |
| Total | ~$56-121 | Per month |

**Per user (1000 orgs):** $0.06-0.12/month

---

## Measuring Cost

### Add cost tracking
```typescript
// Cost tracking in metrics
interface RequestMetrics {
  path: string;
  consumerId: string;
  geminiTokens?: number; // Track token usage
  databaseTime: number;  // Track query time
  cacheHit: boolean;     // Track cache effectiveness
}

// Log metrics
logger.info('Request completed', {
  geminiTokens: 10000,
  databaseTime: 45,
  cacheHit: true,
  consumerId: 'consumer_123',
});

// Analyze monthly
SELECT
  DATE(timestamp) as day,
  SUM(geminiTokens) as tokens,
  COUNT(*) as requests
FROM request_metrics
WHERE timestamp > DATE_TRUNC('month', NOW())
GROUP BY DATE(timestamp);
```

---

## See Also

- [Gemini Integration](../architecture.md#gemini)
- [Database Configuration](./deployment.md#database)
- [Performance Tuning](./performance.md)
