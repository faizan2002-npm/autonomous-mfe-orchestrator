# Runbook: Patch Generation Timeout Loop

## Severity: HIGH

**Impact:** API contract healing fails. Drift is detected but not automatically fixed. Users must manually intervene or wait for healing to retry.

---

## Symptoms

- Alert: `PatchGenerationTimeout` fires (timeouts occurring each minute)
- Logs: `Patch generation timed out after 10000ms` (repeated)
- Metrics: `patch_generation_timeout_total` increasing
- User impact: Healings stuck in `healing_pending` state

---

## Immediate Actions (0-5 minutes)

1. **Check Gemini API status:**
   ```bash
   curl -X POST https://generativelanguage.googleapis.com/v1/models/gemini-2-flash-lite:generateContent?key=$GEMINI_API_KEY \
     -H "Content-Type: application/json" \
     -d '{"contents": [{"parts": [{"text": "hello"}]}]}'
   # Should get response in < 2 seconds
   ```

2. **Check healing service logs:**
   ```bash
   kubectl logs -f deployment/api-gateway | grep -i "patch generation"
   # Look for patterns: always timeout? specific contract types?
   ```

3. **Is it a specific contract?**
   - Check which contracts are timing out
   - If all contracts timeout: Gemini issue
   - If specific contracts: Maybe too large/complex schema?

4. **Check timeout setting:**
   ```bash
   echo $GEMINI_TIMEOUT_MS
   # Default is 10000 (10 seconds). If reduced, may need to increase
   ```

---

## Root Cause Diagnosis (5-30 minutes)

### Case 1: Gemini API Slow/Rate Limited
**Diagnosis:**
- API responds but slowly (> 8 seconds)
- Or: API returning 429 (rate limited)

**Action:**
- Check Gemini quota: Cloud Console → API Quota page
- If quota low: Need to increase quotas or wait for quota reset
- If no quota issue: Gemini infrastructure may be degraded
- Use fallback model: Switch from gemini-2-flash-lite to gemini-1-5-flash (slower but sometimes more available)

### Case 2: Contract Schema Too Large/Complex
**Diagnosis:**
- Specific contracts timeout (e.g., payment-service with 100+ endpoints)
- Gemini API works fine for other contracts
- Issue: Gemini is struggling with schema size/complexity

**Action:**
- Use lighter model: gemini-1-5-flash-lite (smaller, faster)
- Or: Implement schema simplification (remove unused fields)
- Or: Increase timeout: `GEMINI_TIMEOUT_MS=20000` (risky: may impact other operations)

### Case 3: Network/Infrastructure Issue
**Diagnosis:**
- First few requests work, then timeout
- Gemini API available but unreachable from gateway

**Action:**
- Check network: `ping generativelanguage.googleapis.com`
- Check DNS: `nslookup generativelanguage.googleapis.com`
- Check firewall: Verify egress allowed to google.com
- Check gateway logs for connection errors vs timeouts

### Case 4: Healing Retry Loop
**Diagnosis:**
- Patch generation times out
- Healing automatically retries (per retry policy)
- Retries also timeout (cascading failures)

**Action:**
- Check retry policy: `apps/api-gateway/src/healing/healing.service.ts`
- Each retry adds more load, making it worse
- May need to increase timeout or reduce retry attempts

---

## Resolution Steps

### If Gemini Rate Limited
1. Check quota usage: Cloud Console → Quotas
2. Increase quota if available:
   - Go to API Quota page
   - Select Gemini API
   - Increase rate limit
3. Or: Switch model temporarily
   ```bash
   kubectl set env deployment/api-gateway GEMINI_MODEL=gemini-1-5-flash
   ```
4. Wait 1 hour for quota reset, then switch back

### If Schema Too Large
1. **Check contract size:**
   ```bash
   curl http://localhost:4000/api/org/:slug/observations/:contractId | jq '.schema | length'
   # Count of endpoints
   ```
2. **If > 100 endpoints:**
   - Option A: Switch to gemini-1-5-flash-lite
   - Option B: Simplify schema (remove unused fields)
   - Option C: Increase timeout to 20s (temporary)

### If Network Issue
1. Test connectivity from gateway pod:
   ```bash
   kubectl exec -it deployment/api-gateway -- curl -I https://generativelanguage.googleapis.com
   ```
2. If fails: Infrastructure/firewall issue
   - Check firewall rules
   - Verify egress allowed to google.com
   - Check DNS resolution

### If Retry Loop Cascading
1. Temporarily disable healing retries:
   ```bash
   kubectl set env deployment/api-gateway HEALING_MAX_RETRIES=0
   ```
2. Fix underlying Gemini issue (above steps)
3. Re-enable retries:
   ```bash
   kubectl set env deployment/api-gateway HEALING_MAX_RETRIES=3
   ```

---

## Prevention

- **Use lighter model for large schemas:** Automatically detect schema size and switch model
- **Implement circuit breaker:** If Gemini fails 5x in a row, temporarily use fallback without calling Gemini
- **Monitor Gemini latency:** Alert if p95 latency > 8 seconds
- **Fallback strategy:** Keep fallback deterministic patch logic available (even if less optimal)

---

## Escalation

- **15 min still timing out:** Page on-call engineering (may require Gemini quota increase)
- **1h still timing out + user impact:** Disable healing, page product lead

---

## See Also

- [Gemini Integration](../architecture.md#gemini)
- [Healing Architecture](../architecture.md#healing)
- [Cost Optimization - Model Selection](../cost-optimization.md#gemini)
