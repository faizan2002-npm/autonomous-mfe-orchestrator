// Domain vocabulary shared by the drift engine and the database enums.
// Tuples (not plain unions) so the database can build its pgEnums from the same source.

export const DRIFT_TYPES = [
  'FIELD_RENAMED',
  'FIELD_DELETED',
  'FIELD_ADDED',
  'TYPE_CHANGED',
  'STRUCTURE_MUTATION',
  'MULTI_FIELD_MUTATION',
] as const;
export type DriftType = (typeof DRIFT_TYPES)[number];

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SERVICE_STATUSES = [
  'HEALTHY',
  'DEGRADED',
  'DRIFTING',
  'FAILING',
] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const PATCH_STATUSES = [
  'GENERATING',
  'VALIDATED',
  'CANARY',
  'ACTIVE',
  'FAILED',
  'SUPERSEDED',
  'ROLLED_BACK',
] as const;
export type PatchStatus = (typeof PATCH_STATUSES)[number];

export const GOVERNANCE_STATUSES = [
  'AUTO_APPROVED',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'ESCALATED',
] as const;
export type GovernanceStatus = (typeof GOVERNANCE_STATUSES)[number];

/** Highest privilege first: owner > admin > reviewer > viewer. */
export const ORG_ROLES = ['owner', 'admin', 'reviewer', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const CONSUMER_KINDS = ['frontend', 'backend'] as const;
export type ConsumerKind = (typeof CONSUMER_KINDS)[number];

/** Publishable keys may ship in browser code (origin-restricted); secret keys are server-only. */
export const KEY_TYPES = ['publishable', 'secret'] as const;
export type KeyType = (typeof KEY_TYPES)[number];

export const CONTRACT_SOURCES = ['traffic', 'openapi'] as const;
export type ContractSource = (typeof CONTRACT_SOURCES)[number];

export * from './api.js';
