export declare const DRIFT_TYPES: readonly ["FIELD_RENAMED", "FIELD_DELETED", "FIELD_ADDED", "TYPE_CHANGED", "STRUCTURE_MUTATION", "MULTI_FIELD_MUTATION"];
export type DriftType = (typeof DRIFT_TYPES)[number];
export declare const SEVERITIES: readonly ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export type Severity = (typeof SEVERITIES)[number];
export declare const SERVICE_STATUSES: readonly ["HEALTHY", "DEGRADED", "DRIFTING", "FAILING"];
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];
export declare const PATCH_STATUSES: readonly ["GENERATING", "VALIDATED", "CANARY", "ACTIVE", "FAILED", "SUPERSEDED", "ROLLED_BACK"];
export type PatchStatus = (typeof PATCH_STATUSES)[number];
export declare const GOVERNANCE_STATUSES: readonly ["AUTO_APPROVED", "PENDING_REVIEW", "APPROVED", "REJECTED", "ESCALATED"];
export type GovernanceStatus = (typeof GOVERNANCE_STATUSES)[number];
/** Highest privilege first: owner > admin > reviewer > viewer. */
export declare const ORG_ROLES: readonly ["owner", "admin", "reviewer", "viewer"];
export type OrgRole = (typeof ORG_ROLES)[number];
export declare const CONSUMER_KINDS: readonly ["frontend", "backend"];
export type ConsumerKind = (typeof CONSUMER_KINDS)[number];
/** Publishable keys may ship in browser code (origin-restricted); secret keys are server-only. */
export declare const KEY_TYPES: readonly ["publishable", "secret"];
export type KeyType = (typeof KEY_TYPES)[number];
export declare const CONTRACT_SOURCES: readonly ["traffic", "openapi"];
export type ContractSource = (typeof CONTRACT_SOURCES)[number];
/** Things members can be notified about. */
export declare const NOTIFICATION_EVENTS: readonly ["drift.breaking", "patch.awaiting_review", "patch.rejected", "patch.promoted", "patch.rolled_back"];
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
/** Personal delivery channels (the in-app inbox is always on). */
export declare const NOTIFICATION_CHANNELS: readonly ["email", "push"];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
/** Organization-wide integrations. */
export declare const ENDPOINT_TYPES: readonly ["slack", "webhook"];
export type EndpointType = (typeof ENDPOINT_TYPES)[number];
export declare const DELIVERY_CHANNELS: readonly ["email", "push", "slack", "webhook"];
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export declare const DELIVERY_STATUSES: readonly ["pending", "sending", "sent", "dead"];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export * from './api.js';
export declare const PATCH_GENERATORS: readonly ["gemini", "fallback", "unknown"];
export type PatchGenerator = (typeof PATCH_GENERATORS)[number];
export declare const POLICY_ACTIONS: readonly ["promote", "rollback", "wait", "blocked"];
export type PolicyAction = (typeof POLICY_ACTIONS)[number];
/** Database entity types used by report-service and gateway */
export type PatchRegistry = {
    id: string;
    orgId: string;
    consumerId: string;
    contractId: string;
    driftEventId: string;
    adapterCode: string;
    adapterSignature: string;
    confidenceScore: number;
    status: PatchStatus;
    canaryPercent: number;
    deployedAt: string | null;
    rolledBackAt: string | null;
    createdAt: string;
};
export type DriftEvent = {
    id: string;
    orgId: string;
    consumerId: string;
    contractId: string;
    serviceId: string;
    driftType: DriftType;
    severity: Severity;
    driftCoefficient: number;
    observedPayload: Record<string, unknown>;
    diffDetails: Record<string, unknown>;
    isBreaking: boolean;
    detectedAt: string;
};
export type GatewayEvent = {
    type: 'patch.generated';
    patch: PatchRegistry;
} | {
    type: 'drift.detected';
    drift: DriftEvent;
} | {
    type: 'patch.promoted';
    patchId: string;
    contractId: string;
} | {
    type: 'patch.rolled_back';
    patchId: string;
    contractId: string;
};
//# sourceMappingURL=index.d.ts.map