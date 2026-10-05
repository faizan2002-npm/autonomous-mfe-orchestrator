import type {
  ActivityView,
  AuditView,
  ConnectionTestResult,
  ConsumerKind,
  ConsumerView,
  CreatedEndpoint,
  CreatedInvitation,
  DeliveryView,
  DashboardStats,
  DemoServiceState,
  DriftEventDetail,
  DriftEventView,
  DriftType,
  EndpointType,
  FieldPinsView,
  Inbox,
  InvitationPreview,
  InvitationView,
  IssuedKey,
  KeyType,
  MemberView,
  NotificationChannel,
  NotificationEndpointView,
  NotificationEvent,
  NotificationPreferences,
  OrgRole,
  OpenApiState,
  OrgSettingsView,
  OrgSummary,
  Page,
  PatchDetail,
  PatchPreview,
  PatchStatus,
  PatchGenerator,
  PatchView,
  PolicyOutlook,
  PromotionPolicyView,
  PublicConfig,
  PushConfig,
  RegisteredService,
  ServiceDetail,
  ServiceSummary,
} from '@orchestrator/shared-types';
import { env } from './env';
import { accessToken, supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Authenticated JSON request to the gateway. A 401 ends the local session. */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${env.gatewayUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401 && token) await supabase.auth.signOut();
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(response.status, message || `Request failed (${response.status})`);
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface DriftFilters {
  service?: string;
  consumerId?: string;
  type?: DriftType;
  cursor?: string;
  limit?: number;
}

export interface PatchFilters {
  status?: PatchStatus;
  service?: string;
  consumerId?: string;
}

export interface Decision {
  serviceName: string;
  notes?: string;
}

export interface ServiceInput {
  serviceName?: string;
  baseUrl?: string;
  description?: string;
  healthPath?: string;
  timeoutMs?: number;
  upstreamHeaders?: Record<string, string>;
}

export interface OrgSettingsInput {
  name?: string;
  driftThreshold?: number | null;
  canaryPercent?: number | null;
  geminiModel?: string;
  geminiApiKey?: string;
}

export interface EndpointInput {
  name?: string;
  url?: string;
  events?: NotificationEvent[];
  enabled?: boolean;
}

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PolicyInput {
  name?: string;
  enabled?: boolean;
  serviceId?: string;
  consumerId?: string;
  minCanaryRequests?: number;
  minCanaryMinutes?: number;
  maxFailureRate?: number;
  rollbackFailureRate?: number | null;
  rollbackMinRequests?: number;
  allowedGenerators?: PatchGenerator[];
}

/** Calls that are not tied to one organization. */
export const accountApi = {
  myOrgs: () => request<OrgSummary[]>('/api/orgs'),
  createOrg: (input: { name: string; slug: string }) =>
    request<OrgSummary>('/api/orgs', json('POST', input)),
  previewInvitation: (token: string) =>
    request<InvitationPreview>(`/api/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (token: string) =>
    request<OrgSummary>(`/api/invitations/${encodeURIComponent(token)}/accept`, json('POST')),
  pushConfig: () => request<PushConfig>('/api/push/config'),
  subscribePush: (subscription: BrowserPushSubscription) =>
    request<void>('/api/push/subscriptions', json('POST', subscription)),
  unsubscribePush: (endpoint: string) => request<void>('/api/push/subscriptions', json('DELETE', { endpoint })),
};

/** Every call scoped to one organization. */
export function orgApi(slug: string) {
  const org = `/api/orgs/${encodeURIComponent(slug)}`;
  const governance = `${org}/governance`;
  return {
    settings: () => request<OrgSettingsView>(org),
    updateSettings: (input: OrgSettingsInput) => request<OrgSettingsView>(org, json('PATCH', input)),
    members: () => request<MemberView[]>(`${org}/members`),
    updateMember: (id: string, role: OrgRole) =>
      request<MemberView>(`${org}/members/${id}`, json('PATCH', { role })),
    removeMember: (id: string) => request<void>(`${org}/members/${id}`, json('DELETE')),
    invitations: () => request<InvitationView[]>(`${org}/invitations`),
    invite: (email: string, role: OrgRole) =>
      request<CreatedInvitation>(`${org}/invitations`, json('POST', { email, role })),
    revokeInvitation: (id: string) => request<void>(`${org}/invitations/${id}`, json('DELETE')),
    activity: (limit = 200) => request<ActivityView[]>(`${org}/activity${query({ limit })}`),

    registry: () => request<RegisteredService[]>(`${org}/services`),
    createService: (input: ServiceInput) => request<RegisteredService>(`${org}/services`, json('POST', input)),
    updateService: (id: string, input: ServiceInput) =>
      request<RegisteredService>(`${org}/services/${id}`, json('PATCH', input)),
    deleteService: (id: string) => request<void>(`${org}/services/${id}`, json('DELETE')),
    testService: (id: string) => request<ConnectionTestResult>(`${org}/services/${id}/test`, json('POST')),

    openapi: (serviceId: string) => request<OpenApiState>(`${org}/services/${serviceId}/openapi`),
    importOpenApi: (
      serviceId: string,
      input: { document?: string; url?: string; requiredOnly?: boolean },
    ) => request<OpenApiState>(`${org}/services/${serviceId}/openapi`, json('PUT', input)),
    removeOpenApi: (serviceId: string) => request<void>(`${org}/services/${serviceId}/openapi`, json('DELETE')),
    adoptOpenApi: (serviceId: string, contractId: string) =>
      request<OpenApiState>(`${org}/services/${serviceId}/openapi/adopt`, json('POST', { contractId })),

    consumers: () => request<ConsumerView[]>(`${org}/consumers`),
    createConsumer: (input: { name: string; kind: ConsumerKind; description?: string; serviceIds?: string[] }) =>
      request<ConsumerView>(`${org}/consumers`, json('POST', input)),
    updateConsumer: (id: string, input: { description?: string; serviceIds?: string[] }) =>
      request<ConsumerView>(`${org}/consumers/${id}`, json('PATCH', input)),
    deleteConsumer: (id: string) => request<void>(`${org}/consumers/${id}`, json('DELETE')),
    issueKey: (consumerId: string, input: { type: KeyType; allowedOrigins?: string[] }) =>
      request<IssuedKey>(`${org}/consumers/${consumerId}/keys`, json('POST', input)),
    revokeKey: (consumerId: string, keyId: string) =>
      request<void>(`${org}/consumers/${consumerId}/keys/${keyId}`, json('DELETE')),

    inbox: (limit = 50) => request<Inbox>(`${org}/notifications${query({ limit })}`),
    markRead: (ids?: string[]) => request<void>(`${org}/notifications/read`, json('POST', ids ? { ids } : {})),
    preferences: () => request<NotificationPreferences>(`${org}/notifications/preferences`),
    updatePreferences: (preferences: Partial<Record<NotificationEvent, NotificationChannel[]>>) =>
      request<NotificationPreferences>(
        `${org}/notifications/preferences`,
        json('PUT', {
          preferences: Object.entries(preferences).map(([event, channels]) => ({ event, channels })),
        }),
      ),
    testNotification: () =>
      request<{ email: boolean; pushDevices: number }>(`${org}/notifications/test`, json('POST')),
    endpoints: () => request<NotificationEndpointView[]>(`${org}/notifications/endpoints`),
    createEndpoint: (input: { type: EndpointType; name: string; url: string; events: NotificationEvent[] }) =>
      request<CreatedEndpoint>(`${org}/notifications/endpoints`, json('POST', input)),
    updateEndpoint: (id: string, input: EndpointInput) =>
      request<NotificationEndpointView>(`${org}/notifications/endpoints/${id}`, json('PATCH', input)),
    deleteEndpoint: (id: string) => request<void>(`${org}/notifications/endpoints/${id}`, json('DELETE')),
    testEndpoint: (id: string) => request<void>(`${org}/notifications/endpoints/${id}/test`, json('POST')),
    deliveries: (endpointId?: string) =>
      request<DeliveryView[]>(`${org}/notifications/deliveries${query({ endpointId })}`),
    redeliver: (id: string) => request<void>(`${org}/notifications/deliveries/${id}/redeliver`, json('POST')),

    policies: () => request<PromotionPolicyView[]>(`${org}/policies`),
    policyOutlook: () => request<PolicyOutlook[]>(`${org}/policies/outlook`),
    createPolicy: (input: PolicyInput) => request<PromotionPolicyView>(`${org}/policies`, json('POST', input)),
    updatePolicy: (id: string, input: PolicyInput) =>
      request<PromotionPolicyView>(`${org}/policies/${id}`, json('PATCH', input)),
    deletePolicy: (id: string) => request<void>(`${org}/policies/${id}`, json('DELETE')),

    stats: () => request<DashboardStats>(`${governance}/stats`),
    config: () => request<PublicConfig>(`${governance}/config`),
    services: () => request<ServiceSummary[]>(`${governance}/services`),
    service: (name: string) => request<ServiceDetail>(`${governance}/services/${encodeURIComponent(name)}`),
    pinContract: (contractId: string, pins: FieldPinsView) =>
      request<{ pinnedFields: FieldPinsView | null }>(`${governance}/contracts/${contractId}/pins`, json('PUT', pins)),
    driftEvents: (filters: DriftFilters) =>
      request<Page<DriftEventView>>(`${governance}/drift-events${query({ ...filters })}`),
    driftEvent: (id: string) => request<DriftEventDetail>(`${governance}/drift-events/${id}`),
    patches: (filters: PatchFilters) => request<PatchView[]>(`${governance}/patches${query({ ...filters })}`),
    patch: (id: string) => request<PatchDetail>(`${governance}/patches/${id}`),
    previewPatch: (id: string) => request<PatchPreview>(`${governance}/patches/${id}/preview`, json('POST')),
    promotePatch: (id: string, decision: Decision) =>
      request<{ message: string }>(`${governance}/patches/${id}/promote`, json('POST', decision)),
    rollbackPatch: (id: string, decision: Decision) =>
      request<{ message: string }>(`${governance}/patches/${id}/rollback`, json('POST', decision)),
    audits: (limit = 100) => request<AuditView[]>(`${governance}/audits${query({ limit })}`),
    eventsUrl: `${env.gatewayUrl}${governance}/events`,

    demoServices: () => request<DemoServiceState[]>(`${org}/demo/services`),
    setChaos: (serviceName: string, mutated: boolean) =>
      request<DemoServiceState>(
        `${org}/demo/services/${encodeURIComponent(serviceName)}/chaos`,
        json('POST', { mutated }),
      ),
  };
}

export type OrgApi = ReturnType<typeof orgApi>;

/**
 * Query keys. Everything org-scoped starts with ['org', slug] so switching organizations
 * can never show another org's cached data, and live events invalidate precisely.
 */
export const keys = {
  myOrgs: ['my-orgs'] as const,
  invitation: (token: string) => ['invitation', token] as const,
  org: (slug: string) => ['org', slug] as const,
  settings: (slug: string) => ['org', slug, 'settings'] as const,
  members: (slug: string) => ['org', slug, 'members'] as const,
  invitations: (slug: string) => ['org', slug, 'invitations'] as const,
  activity: (slug: string) => ['org', slug, 'activity'] as const,
  registry: (slug: string) => ['org', slug, 'registry'] as const,
  consumers: (slug: string) => ['org', slug, 'consumers'] as const,
  stats: (slug: string) => ['org', slug, 'stats'] as const,
  config: (slug: string) => ['org', slug, 'config'] as const,
  services: (slug: string) => ['org', slug, 'services'] as const,
  service: (slug: string, name: string) => ['org', slug, 'services', name] as const,
  driftEvents: (slug: string, filters: DriftFilters = {}) => ['org', slug, 'drift-events', filters] as const,
  driftEvent: (slug: string, id: string) => ['org', slug, 'drift-event', id] as const,
  patches: (slug: string, filters: PatchFilters = {}) => ['org', slug, 'patches', filters] as const,
  patch: (slug: string, id: string) => ['org', slug, 'patch', id] as const,
  audits: (slug: string) => ['org', slug, 'audits'] as const,
  demoServices: (slug: string) => ['org', slug, 'demo-services'] as const,
  inbox: (slug: string) => ['org', slug, 'inbox'] as const,
  preferences: (slug: string) => ['org', slug, 'notification-preferences'] as const,
  endpoints: (slug: string) => ['org', slug, 'notification-endpoints'] as const,
  deliveries: (slug: string, endpointId?: string) => ['org', slug, 'deliveries', endpointId ?? 'all'] as const,
  pushConfig: ['push-config'] as const,
  openapi: (slug: string, serviceId: string) => ['org', slug, 'services', 'openapi', serviceId] as const,
  policies: (slug: string) => ['org', slug, 'policies'] as const,
  policyOutlook: (slug: string) => ['org', slug, 'policies', 'outlook'] as const,
};
