# Data Retention Policy

## Overview

This document defines data retention and archival policies for the Autonomous MFE Orchestrator. Data retention is driven by compliance requirements, operational needs, and cost optimization.

---

## Governance Audits

### Retention Period
**7 years** (compliance requirement for SOC 2 and industry best practices)

### What is Retained
- All policy decisions (promote, rollback, reject)
- User actions (create org, add member, update policy)
- Sensitive operations (patch generation, healing, canary deployment)
- Approval/rejection records with user identity and timestamp

### Purpose
- **Compliance:** SOC 2 Type II, HIPAA (if applicable), financial audit trails
- **Forensics:** Investigation of security incidents, unauthorized changes
- **Accountability:** Attribution of actions to users and roles

### Archival Process

#### Automated Archival (Annual)
Runs on 2026-01-01 annually:
```sql
-- Archive audits older than 7 years to archive table
INSERT INTO governance_audits_archive
SELECT * FROM governance_audits
WHERE created_at < NOW() - INTERVAL '7 years';

-- Delete archived rows (keeping 7 years current)
DELETE FROM governance_audits
WHERE created_at < NOW() - INTERVAL '7 years';
```

#### Archive Storage
- **Location:** `governance_audits_archive` table (or separate database if volume is large)
- **Access:** Read-only, restricted to compliance/security team
- **Backup:** Included in annual Supabase snapshots

### Deletion Policy
- **Automatic:** After 7 years retention, audits are archived and deleted from production database
- **Manual:** Upon user/org request (via privacy request workflow), audits are pseudonymized (user IDs replaced with "DELETED_USER") rather than hard-deleted
- **Permanent:** After archival period expires (10 years total), archived records may be permanently deleted

---

## API Consumer Data

### Retention Period
**While consumer is active + 1 year grace period**

### What is Retained
- Consumer name, org membership, API key (hashed), permissions
- Last activity timestamp
- Webhook/notification endpoints and their delivery logs

### Deletion Policy
- **Inactive:** Deleted 1 year after last API call
- **Explicit:** Upon org admin request, deleted immediately with 30-day grace period to revoke if needed
- **On revocation:** API key marked revoked immediately; metadata deleted after 30 days

---

## Notification Delivery Logs

### Retention Period
**90 days** (operational troubleshooting)

### What is Retained
- Delivery ID, channel (email/webhook/push), status, timestamp
- Error message (first 1KB)
- Number of delivery attempts
- Recipient (org, user, or endpoint URL)

### Purpose
- Troubleshoot delivery failures in last 3 months
- Detect delivery patterns and reliability issues
- Cost optimization (identify failed channels)

### Cleanup
Automatic daily:
```sql
DELETE FROM notification_deliveries
WHERE created_at < NOW() - INTERVAL '90 days'
  AND status IN ('sent', 'dead');
```

### GDPR Consideration
If recipient is a user (email), deletion honored for GDPR "right to be forgotten" within 90 days.

---

## Patch/Healing Data

### Retention Period
**30 days for canary metrics, 1 year for patch history**

### Canary Metrics (30 days)
- Traffic baseline vs canary comparison (error rates, latency)
- Decision evidence behind automatic promotions/rollbacks
- Cleaned up after policy decision finalized

### Patch History (1 year)
- Generated patch code (fallback in case regeneration needed)
- Deployment history, rollback record
- Useful for regression analysis if code regresses

### Cleanup
```sql
-- Delete canary metrics older than 30 days
DELETE FROM canary_metrics
WHERE window_start < NOW() - INTERVAL '30 days';

-- Delete old patch code, keep metadata
UPDATE patches
SET adapter_code = NULL
WHERE created_at < NOW() - INTERVAL '1 year';

-- Hard delete old patch metadata after 2 years
DELETE FROM patches
WHERE created_at < NOW() - INTERVAL '2 years'
  AND status = 'rolled_back';
```

---

## API Request Logs

### Retention Period
**7 days** (operational debugging only)

### What is Retained
- Request ID, method, path, status code, response time
- User agent, IP address (for security investigation)
- Error messages for failed requests

### NOT Retained
- Request/response bodies (PII risk)
- Authorization tokens or API keys
- Sensitive headers

### Purpose
- Debug API issues in last week
- Rate-limit detection and DDoS investigation
- Performance regression analysis

### Implementation
- Stored in application logs (pino structured logs)
- Rotated via ELK/CloudWatch log retention policies
- Not stored in database

---

## Environment-Specific Policies

### Production
- All retention periods enforced as above
- Archival jobs automated and tested monthly
- Compliance audit: Check archive integrity quarterly

### Staging
- Retention periods: 50% of production (e.g., audits: 3.5 years, notifications: 45 days)
- Archival optional (not required for compliance)
- Data may be sanitized/redacted (remove real email addresses, phone numbers)

### Development/Local
- No retention policy enforced
- Data reset on each full deployment
- May be cleared by local CI/CD

---

## User Rights & Compliance

### GDPR - Right to Be Forgotten
- User can request deletion of personal data
- Timeline: 30 days to fulfill request
- Scope: Notification recipients, user activity logs, personal identifiers in audits
- Non-PII remains (e.g., policy decisions, patch history for system integrity)

### CCPA - Right to Know
- User can request export of all personal data held
- Timeline: 45 days to fulfill request
- Includes: Audit trail of their actions, notification history, profile data

### HIPAA (if applicable)
- Audit logs retained 6 years (not 7)
- Access logs retained 90 days (same as general policy)
- Encryption key rotation every 90 days (separate policy)

---

## Data Subject Request Workflow

### Request Intake
1. User submits request via support portal or privacy@company.com
2. Verify identity (email confirmation link)
3. Log request with ticket ID

### Fulfillment (Right to Know / Export)
1. Query all tables for user's personal data
2. Compile CSV export: audits, notifications, consumer records
3. Encrypt and send download link (24-hour expiry)
4. Log compliance event

### Fulfillment (Right to Delete)
1. Verify request is not during active incident/litigation
2. Mark user as "GDPR deleted" in system (don't hard-delete yet)
3. Anonymize PII: user_id → "DELETED_USER_xxx", email → hashed identifier
4. Keep audit logs but remove personal identifiers
5. Purge after 30-day grace period (in case legal action needed)

---

## Testing & Validation

### Quarterly Archival Test
```
1. Snapshot production database
2. Run archival jobs on snapshot
3. Verify: Archives contain expected rows, production row count decreased
4. Verify: Compliance team can read archived data
5. Validate: No data corruption or loss
```

### Annual Audit
- Legal/compliance review of retention policy
- Reconciliation of retained data vs. policy
- Verify deletion requests were fulfilled
- Test GDPR/CCPA request fulfillment workflow

---

## Future Enhancements

- **Auto-Archival to Cold Storage:** Move archives to S3 Glacier after 1 year (cost optimization)
- **Privacy-Preserving Cleanup:** Hash emails/IDs instead of hard-delete for better debugging
- **Predictive Retention:** Adjust retention based on org tier (premium orgs: 10 years, free: 3 years)
- **Audit Log Compression:** Deduplicate similar audit events (e.g., multiple "user joined org" → count + sample)
