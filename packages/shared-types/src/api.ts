// Response shapes of the gateway's dashboard API. Plain data only, so browsers can import them.
import type {
  ConsumerKind,
  DeliveryChannel,
  DeliveryStatus,
  EndpointType,
  NotificationChannel,
  NotificationEvent,
  ContractSource,
  DriftType,
  GovernanceStatus,
  KeyType,
  OrgRole,
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
  /** The application whose contract this is. */
  consumerId: string;
  consumerName: string;
}

export interface FieldPinsView {
  required: string[];
  ignored: string[];
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
  consumerId: string;
  version: number;
  fieldCount: number;
  schemaTokens: string[];
  source: ContractSource;
  pinnedFields: FieldPinsView | null;
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

interface EventBase {
  at: Timestamp;
  /** Events are delivered only to members of this organization. */
  orgId: string;
}

/** Live events pushed over GET /api/orgs/:orgSlug/governance/events (Server-Sent Events). */
export type GatewayEvent = EventBase &
  (
    | {
        type: 'drift.detected';
        driftEventId: string;
        contract: ContractRefView;
        driftType: DriftType;
        severity: Severity;
        coefficient: number;
        isBreaking: boolean;
      }
    | {
        type: 'patch.generated';
        patchId: string;
        driftEventId: string;
        contract: ContractRefView;
        generator: PatchView['generator'];
        confidenceScore: number;
      }
    | {
        type: 'patch.rejected';
        patchId: string;
        driftEventId: string;
        contract: ContractRefView;
        reason: string;
      }
    | {
        type: 'patch.deployed' | 'patch.promoted' | 'patch.rolledBack';
        patchId: string;
        contract: ContractRefView;
        canaryPercent: number;
      }
    | {
        /** Internal: carries the invitation link for the email sender; never streamed to browsers. */
        type: 'member.invited';
        orgName: string;
        email: string;
        role: OrgRole;
        acceptUrl: string;
        invitedBy: string;
      }
    | {
        /** Delivered only to `userId`'s dashboard sessions. */
        type: 'notification.created';
        userId: string;
        notificationId: string;
        title: string;
      }
    | {
        type: 'request.proxied';
        contract: ContractRefView;
        status: number;
        isPatched: boolean;
      }
  );

export type GatewayEventType = GatewayEvent['type'];

/** Events delivered to browsers over SSE (internal events are filtered out by the gateway). */
export type StreamedEvent = Exclude<GatewayEvent, { type: 'member.invited' }>;

// ---- Organizations, members and access -------------------------------------------------

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
}

export interface OrgSettingsView {
  id: string;
  slug: string;
  name: string;
  /** null = gateway default (shown in `defaults`). */
  driftThreshold: number | null;
  canaryPercent: number | null;
  geminiModel: string | null;
  /** Whether a bring-your-own Gemini key is stored (the key itself is never returned). */
  geminiKeyConfigured: boolean;
  defaults: {
    driftThreshold: number;
    canaryPercent: number;
    geminiModel: string;
  };
}

export interface MemberView {
  id: string;
  userId: string;
  email: string;
  role: OrgRole;
  createdAt: Timestamp;
}

export interface InvitationView {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: Timestamp;
  createdAt: Timestamp;
}

/** Returned once when an invitation is created; the link is also emailed. */
export interface CreatedInvitation extends InvitationView {
  acceptUrl: string;
}

export interface InvitationPreview {
  orgName: string;
  email: string;
  role: OrgRole;
  expiresAt: Timestamp;
}

export interface ActivityView {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: unknown;
  createdAt: Timestamp;
}

// ---- Service registry and consumers -----------------------------------------------------

export interface RegisteredService {
  id: string;
  serviceName: string;
  baseUrl: string;
  description: string | null;
  healthPath: string | null;
  timeoutMs: number;
  /** Header names only; values are encrypted and never returned. */
  upstreamHeaderNames: string[];
  status: ServiceStatus;
  createdAt: Timestamp;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface ConsumerKeyView {
  id: string;
  type: KeyType;
  /** e.g. "pk_a1B2c3…" */
  display: string;
  allowedOrigins: string[];
  createdBy: string;
  lastUsedAt: Timestamp | null;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
}

/** The only response that ever contains a full API key. */
export interface IssuedKey extends ConsumerKeyView {
  key: string;
}

export interface ConsumerView {
  id: string;
  name: string;
  kind: ConsumerKind;
  description: string | null;
  serviceIds: string[];
  keys: ConsumerKeyView[];
  createdAt: Timestamp;
}

// ---- Notifications ------------------------------------------------------------------------

export interface NotificationView {
  id: string;
  event: NotificationEvent;
  title: string;
  body: string;
  /** Dashboard path to open, e.g. /o/acme/patches/<id>. */
  link: string | null;
  readAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface Inbox {
  items: NotificationView[];
  unreadCount: number;
}

/** Which personal channels each event uses for the signed-in member. */
export type NotificationPreferences = Record<NotificationEvent, NotificationChannel[]>;

export interface NotificationEndpointView {
  id: string;
  type: EndpointType;
  name: string;
  /** Host only; the full URL (often a secret for Slack) is never returned. */
  urlHost: string;
  events: NotificationEvent[];
  enabled: boolean;
  createdAt: Timestamp;
}

/** Returned once when a webhook endpoint is created: the signing secret. */
export interface CreatedEndpoint extends NotificationEndpointView {
  signingSecret: string | null;
}

export interface DeliveryView {
  id: string;
  channel: DeliveryChannel;
  event: NotificationEvent | 'member.invited' | 'test';
  /** Email address, endpoint name or "browser". */
  target: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Timestamp;
  sentAt: Timestamp | null;
}

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}
