// Response shapes of the gateway's dashboard API. Plain data only, so browsers can import them.
import type {
  DriftType,
  GovernanceStatus,
  PatchStatus,
  ServiceStatus,
  Severity,
} from './index.js';

/** ISO-8601 timestamp string. */
export type Timestamp = string;

export interface SchemaDiff {
  missingFields: string[];
  addedFields: string[];
  typeMismatches: Array<{ path: string; expected: string; observed: string }>;
}

export interface ContractRefView {
  serviceName: string;
  httpMethod: string;
  endpointPath: string;
}

export interface ServiceSummary {
  id: string;
  serviceName: string;
  endpointUrl: string;
  status: ServiceStatus;
  contractCount: number;
  lastDriftAt: Timestamp | null;
  updatedAt: Timestamp;
}

export interface ContractView extends ContractRefView {
  id: string;
  version: number;
  fieldCount: number;
  schemaTokens: string[];
  createdAt: Timestamp;
}

export interface ServiceDetail extends ServiceSummary {
  contracts: ContractView[];
  recentDrift: DriftEventView[];
}

export interface DriftEventView {
  id: string;
  contract: ContractRefView;
  contractId: string;
  driftType: DriftType;
  severity: Severity;
  driftCoefficient: number;
  isBreaking: boolean;
  detectedAt: Timestamp;
  patchId: string | null;
  patchStatus: PatchStatus | null;
}

export interface DriftEventDetail extends DriftEventView {
  expectedSchema: string[];
  diff: SchemaDiff;
  observedPayload: unknown;
}

export interface PatchView {
  id: string;
  contract: ContractRefView;
  driftEventId: string;
  status: PatchStatus;
  canaryPercent: number;
  confidenceScore: number;
  generator: 'gemini' | 'fallback' | 'unknown';
  createdAt: Timestamp;
  deployedAt: Timestamp | null;
  rolledBackAt: Timestamp | null;
}

/** Requests seen by a live patch over the last 7 days, split by canary routing. */
export interface CanaryTraffic {
  /** Requests routed to the patch and transformed by it. */
  patchedRequests: number;
  /** Requests routed to the patch whose adapter threw at runtime (served unpatched). */
  adapterFailures: number;
  /** Requests outside the canary share, served unpatched. */
  baselineRequests: number;
}

export interface PatchDetail extends PatchView {
  adapterCode: string;
  driftEvent: DriftEventDetail;
  audits: AuditView[];
  traffic: CanaryTraffic;
}

export interface PatchPreview {
  input: unknown;
  output: unknown;
  success: boolean;
  error: string | null;
  executionTimeMs: number;
  /** Whether the output still breaks the expected contract. */
  stillBreaking: boolean;
  residualDiff: SchemaDiff | null;
}

export interface AuditView {
  id: string;
  driftEventId: string;
  patchId: string | null;
  status: GovernanceStatus;
  reviewer: string | null;
  reviewNotes: string | null;
  reasoningTrace: string;
  reviewedAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface DashboardStats {
  services: Record<ServiceStatus, number>;
  driftEvents24h: number;
  breakingDriftEvents24h: number;
  patches: Record<PatchStatus, number>;
}

export interface PublicConfig {
  driftThreshold: number;
  canaryPercent: number;
  geminiModel: string;
  geminiConfigured: boolean;
  services: string[];
}

export interface DemoServiceState {
  serviceName: string;
  reachable: boolean;
  mutated: boolean | null;
}

export interface Page<T> {
  items: T[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

/** Live events pushed over GET /api/governance/events (Server-Sent Events). */
export type GatewayEvent =
  | {
      type: 'drift.detected';
      at: Timestamp;
      driftEventId: string;
      contract: ContractRefView;
      driftType: DriftType;
      severity: Severity;
      coefficient: number;
      isBreaking: boolean;
    }
  | {
      type: 'patch.generated';
      at: Timestamp;
      patchId: string;
      driftEventId: string;
      contract: ContractRefView;
      generator: PatchView['generator'];
      confidenceScore: number;
    }
  | {
      type: 'patch.rejected';
      at: Timestamp;
      patchId: string;
      driftEventId: string;
      contract: ContractRefView;
      reason: string;
    }
  | {
      type: 'patch.deployed' | 'patch.promoted' | 'patch.rolledBack';
      at: Timestamp;
      patchId: string;
      contract: ContractRefView;
      canaryPercent: number;
    }
  | {
      type: 'request.proxied';
      at: Timestamp;
      contract: ContractRefView;
      status: number;
      isPatched: boolean;
    };

export type GatewayEventType = GatewayEvent['type'];
