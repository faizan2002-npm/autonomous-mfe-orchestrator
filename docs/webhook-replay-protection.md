# Webhook Replay Protection

## Overview

When webhooks are delivered to external endpoints (consumers), delivery failures trigger automatic retries. This document explains how to protect against duplicate webhook processing due to retries.

---

## Webhook Delivery Headers

Every webhook delivery includes headers that allow consumers to detect and deduplicate retries:

```
POST https://consumer-webhook-endpoint.com/webhooks
X-Orchestrator-Delivery: delivery_<uuid>
X-Orchestrator-Event: patch_promoted
X-Orchestrator-Signature: sha256=<hmac>
Content-Type: application/json

{
  "id": "patch_<uuid>",
  "event": "patch_promoted",
  "org_id": "org_123",
  ...
}
```

### Header Meanings

- **X-Orchestrator-Delivery:** Unique delivery ID. Same value on all retries of the same delivery.
- **X-Orchestrator-Event:** Event type (e.g., `patch_promoted`, `patch_rolled_back`, `healing_completed`)
- **X-Orchestrator-Signature:** HMAC-SHA256 signature for verifying authenticity (if configured)

---

## Consumer-Side Deduplication

### Simple Approach: Idempotency Key

Store a set of seen delivery IDs and reject duplicates:

```javascript
const seenDeliveries = new Set();

app.post('/webhooks', async (req, res) => {
  const deliveryId = req.headers['x-orchestrator-delivery'];
  
  // Check if we've already processed this delivery
  if (seenDeliveries.has(deliveryId)) {
    return res.status(200).json({ status: 'duplicate', deliveryId });
  }
  
  // Process webhook
  const event = req.body;
  await processEvent(event);
  
  // Mark as processed
  seenDeliveries.add(deliveryId);
  res.status(200).json({ status: 'ok' });
});
```

### Persistent Approach: Database Deduplication

For production systems, store delivery IDs in a database with TTL:

```sql
-- Create table to track processed deliveries
CREATE TABLE processed_deliveries (
  delivery_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(100),
  processed_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
);

-- Before processing, check if delivery exists
SELECT EXISTS(SELECT 1 FROM processed_deliveries WHERE delivery_id = ?);

-- After successful processing, insert to prevent reprocessing
INSERT INTO processed_deliveries (delivery_id, event_type)
VALUES (?, ?)
ON CONFLICT DO NOTHING;

-- Cleanup old entries (auto TTL via expires_at, or manual cleanup)
DELETE FROM processed_deliveries WHERE expires_at < NOW();
```

---

## Retry Behavior

### Gateway Retries

The gateway retries failed webhook deliveries with exponential backoff:

```
Attempt 1: immediate
Attempt 2: 30 seconds later
Attempt 3: 1 minute later
Attempt 4: 2 minutes later
Attempt 5: 4 minutes later
Attempt 6: 8 minutes later
→ Give up (max 6 attempts)
```

**Same `X-Orchestrator-Delivery` ID is used for all retries of a single delivery.**

### Detecting Replays

A webhook is a replay if:
- You receive the same `X-Orchestrator-Delivery` header twice
- Timestamps suggest it's after an earlier successful delivery

### Recovering from Failure

If your webhook handler fails but you don't send a success response (HTTP 2xx):

```
1. Gateway sees non-2xx response
2. Retries same delivery (same X-Orchestrator-Delivery ID)
3. You receive webhook again with same delivery ID
4. Your deduplication logic catches it and returns 200
5. Gateway considers delivery successful
```

---

## Testing Deduplication

Test your deduplication logic:

```bash
# Send a webhook with delivery ID
curl -X POST http://localhost:5000/webhooks \
  -H 'X-Orchestrator-Delivery: delivery_test_123' \
  -H 'X-Orchestrator-Event: patch_promoted' \
  -H 'Content-Type: application/json' \
  -d '{"id":"patch_1","event":"patch_promoted"}'

# Response: 200
# { "status": "ok" }

# Resend same webhook
curl -X POST http://localhost:5000/webhooks \
  -H 'X-Orchestrator-Delivery: delivery_test_123' \
  ...same payload...

# Response: 200
# { "status": "duplicate" }

# Your system should process it only once
```

---

## FAQ

**Q: What if I don't deduplicate?**
A: You'll process the same event multiple times, causing duplicate patches, notifications, or policy decisions.

**Q: Can I just check the event ID in the payload?**
A: No. The same event could be legitimately delivered twice at different times (e.g., if you rollback and then promote again). The `X-Orchestrator-Delivery` ID uniquely identifies this instance of delivery, not the event.

**Q: How long should I keep the delivery ID in my database?**
A: At least 24 hours (max delivery attempt window is ~15 minutes, but keep longer for safety).

**Q: What if the webhook fails after I've recorded the delivery ID?**
A: You'll reject the retry, so it may look like the webhook failed from the gateway's perspective. This is acceptable—the gateway will eventually give up and mark it as failed, and you can manually retry later.

---

## TLS/SSL Requirements

### Outbound Webhooks (Gateway → Consumer)

**Supabase Pooler:** Uses TLS by default (sslmode=require). No additional configuration needed.

**Self-Hosted Postgres:**
```env
# Connection string must enforce TLS
DATABASE_URL=postgresql://user:pass@postgres.internal:5432/db?sslmode=require
```

Options for `sslmode`:
- `disable` - No TLS (not recommended)
- `allow` - TLS only if server supports it
- `prefer` - TLS if possible (default)
- `require` - TLS required (recommended for production)
- `verify-ca` - TLS required, verify CA certificate
- `verify-full` - TLS required, verify CA and hostname

### Self-Signed Certificates

If using self-signed certificates:

```env
# Allow self-signed certs (not recommended for production)
PGSQL_SSL_CA=/path/to/ca.crt

# Or skip CA verification (risky)
DATABASE_URL=postgresql://...?sslmode=require&sslcert=disable
```

### Certificate Rotation

For production systems:
- Certificates should have 1-year validity
- Rotate before expiry (add calendar reminder 30 days before)
- Update connection string with new cert path
- Test connection before deploying

---

## See Also

- [Webhook Signature Verification](./webhook-signatures.md)
- [Notification Delivery](../architecture.md#notifications)
