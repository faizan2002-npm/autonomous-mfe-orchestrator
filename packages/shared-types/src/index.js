// Domain vocabulary shared by the drift engine and the database enums.
// Tuples (not plain unions) so the database can build its pgEnums from the same source.
export const DRIFT_TYPES = [
    'FIELD_RENAMED',
    'FIELD_DELETED',
    'FIELD_ADDED',
    'TYPE_CHANGED',
    'STRUCTURE_MUTATION',
    'MULTI_FIELD_MUTATION',
];
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const SERVICE_STATUSES = [
    'HEALTHY',
    'DEGRADED',
    'DRIFTING',
    'FAILING',
];
export const PATCH_STATUSES = [
    'GENERATING',
    'VALIDATED',
    'CANARY',
    'ACTIVE',
    'FAILED',
    'SUPERSEDED',
    'ROLLED_BACK',
];
export const GOVERNANCE_STATUSES = [
    'AUTO_APPROVED',
    'PENDING_REVIEW',
    'APPROVED',
    'REJECTED',
    'ESCALATED',
];
/** Highest privilege first: owner > admin > reviewer > viewer. */
export const ORG_ROLES = ['owner', 'admin', 'reviewer', 'viewer'];
export const CONSUMER_KINDS = ['frontend', 'backend'];
/** Publishable keys may ship in browser code (origin-restricted); secret keys are server-only. */
export const KEY_TYPES = ['publishable', 'secret'];
export const CONTRACT_SOURCES = ['traffic', 'openapi'];
/** Things members can be notified about. */
export const NOTIFICATION_EVENTS = [
    'drift.breaking',
    'patch.awaiting_review',
    'patch.rejected',
    'patch.promoted',
    'patch.rolled_back',
];
/** Personal delivery channels (the in-app inbox is always on). */
export const NOTIFICATION_CHANNELS = ['email', 'push'];
/** Organization-wide integrations. */
export const ENDPOINT_TYPES = ['slack', 'webhook'];
export const DELIVERY_CHANNELS = ['email', 'push', 'slack', 'webhook'];
export const DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'dead'];
export * from './api.js';
export const PATCH_GENERATORS = ['gemini', 'fallback', 'unknown'];
export const POLICY_ACTIONS = ['promote', 'rollback', 'wait', 'blocked'];
//# sourceMappingURL=index.js.map