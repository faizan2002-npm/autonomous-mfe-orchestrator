# Runbook: Notification Delivery Backlog

## Severity: MEDIUM (users delayed), HIGH (if backlog > 10k)

**Impact:** Webhook deliveries and email notifications delayed. Users don't see alerts/notifications in real-time.

---

## Symptoms

- Alert: `NotificationDeliveryBacklog` fires (queue depth > 1000)
- Logs: Outbox worker logs show increasing queue size
- Metrics: `notification_delivery_queue_depth > 1000`
- Users: Notifications arriving hours late or not at all

---

## Immediate Actions (0-5 minutes)

1. **Check queue depth:**
   ```bash
   kubectl logs -f deployment/api-gateway | grep "notification_delivery_queue_depth"
   # Or query Prometheus: notification_delivery_queue_depth
   ```

2. **Check outbox worker status:**
   ```bash
   kubectl logs -l app=api-gateway | grep "outbox-worker" | tail -50
   # Look for errors, slow processing, or paused state
   ```

3. **Is email provider responsive?**
   ```bash
   # For Resend (if configured):
   curl -X POST https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"from":"test@example.com", "to":"test@example.com", "subject":"test", "html":"test"}'
   # Should get 200 (or error in < 5s)
   ```

4. **Check database for stuck notifications:**
   ```sql
   SELECT status, COUNT(*) FROM outbox_notifications GROUP BY status;
   -- Should show: pending: 100-500, sent: 90%+, failed: 0-5%
   ```

---

## Root Cause Diagnosis (5-30 minutes)

### Case 1: Email Provider Slow/Down
**Diagnosis:**
- Resend API responding slowly (> 5s per request)
- Outbox worker processing 1-2 emails per second (should be 10+)

**Action:**
- Check Resend status page
- Verify API key is valid: `echo $RESEND_API_KEY`
- Switch to fallback provider if available

### Case 2: Outbox Worker Crashed
**Diagnosis:**
- Worker pod logs show error or crash
- Queue size monotonically increasing
- No recent "sent" metrics

**Action:**
- Check recent logs for error: `kubectl logs <pod-name>`
- Likely: Database connection lost, email provider error, or code bug
- Restart worker: `kubectl delete pod <pod-name>`

### Case 3: Too Many Notifications Queued
**Diagnosis:**
- Queue contains notifications from healthy operations
- Email provider is fine, just slow
- Queue grows from 100 → 1000+ over hours

**Action:**
- Check if recent bulk operation triggered many notifications
- Or: Healing/import operation generating too many notifications
- May need to throttle notification generation

### Case 4: Database Issue
**Diagnosis:**
- Outbox table locked or slow to query
- Worker stuck in infinite retry loop

**Action:**
- Check `pg_stat_activity` for locked rows
- Verify no long-running transaction on `outbox_notifications` table
- Kill long transaction if stuck

---

## Resolution Steps

### If Email Provider Slow
1. Reduce worker concurrency temporarily (if configurable)
2. Add exponential backoff to retry logic
3. Wait for provider to recover (usually 5-30 min)
4. Backlog will clear once provider recovers

### If Worker Crashed
1. Check logs for error
2. Fix issue if obvious (e.g., missing env var)
3. Restart pod: `kubectl delete pod <pod-name>`
4. Monitor queue: `watch -n 5 'kubectl logs ... | grep queue_depth'`

### If Too Many Notifications
1. Check if operation that generated them is still running
   - If yes: Stop it if safe, or let it complete
   - If no: Bulk was normal spike, queue will clear
2. Monitor recovery: Queue depth should decrease linearly

### If Database Locked
1. Identify blocking transaction: `SELECT * FROM pg_stat_activity WHERE wait_event = 'Lock';`
2. Kill if safe: `pg_terminate_backend(<pid>)`
3. Outbox worker resumes automatically

---

## Acceleration (if backlog critical)

**Only if queue > 5000 and not clearing:**

1. **Increase worker concurrency:**
   ```bash
   kubectl set env deployment/api-gateway OUTBOX_WORKER_BATCH_SIZE=500
   # Default is 100, increase to process faster
   ```

2. **Parallel workers:**
   ```bash
   # If outbox worker can be horizontally scaled, add replicas
   kubectl scale deployment/outbox-worker --replicas=5
   ```

3. **Temporarily skip failed notifications:**
   ```sql
   -- Mark old failed notifications as completed (CAUTION: data loss possible)
   UPDATE outbox_notifications SET status = 'failed' 
   WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours';
   ```

---

## Prevention

- **Monitor queue:** Alert at 100, 500, 1000 (graduated response)
- **Email provider redundancy:** Configure fallback provider
- **Rate limiting:** Limit notifications per org per minute
- **Bulk operation awareness:** Healing/import ops should batch notifications

---

## Escalation

- **30 min backlog:** Page on-call engineer
- **1h backlog + user complaints:** Page product + eng lead

---

## See Also

- [Email Provider Configuration](../configuration.md#email)
- [Notification Architecture](../architecture.md#notifications)
