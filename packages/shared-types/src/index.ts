export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type DriftType =
  | 'FIELD_RENAMED'
  | 'FIELD_DELETED'
  | 'FIELD_ADDED'
  | 'TYPE_CHANGED'
  | 'STRUCTURE_MUTATION'
  | 'MULTI_FIELD_MUTATION';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PatchStatus =
  | 'GENERATING'
  | 'VALIDATED'
  | 'CANARY'
  | 'ACTIVE'
  | 'FAILED'
  | 'SUPERSEDED'
  | 'ROLLED_BACK';

export type GovernanceStatus =
  | 'AUTO_APPROVED'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'ESCALATED';

export interface DiffDetail {
  field: string;
  expectedType?: string;
  observedType?: string;
  change: string;
}

export interface DriftDetectionResult {
  isDrift: boolean;
  driftCoefficient: number;
  jaccardSimilarity: number;
  driftType?: DriftType;
  severity?: Severity;
  isBreaking: boolean;
  diffDetails: DiffDetail[];
}

export interface AdapterGenerationResult {
  code: string;
  confidenceScore: number;
  reasoningTrace: string;
  syntaxValid: boolean;
  executionVerified: boolean;
}
