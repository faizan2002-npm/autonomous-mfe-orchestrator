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

export * from './api.js';
