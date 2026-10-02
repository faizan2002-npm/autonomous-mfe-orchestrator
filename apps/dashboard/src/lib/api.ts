import type {
  AuditView,
  DashboardStats,
  DemoServiceState,
  DriftEventDetail,
  DriftEventView,
  DriftType,
  Page,
  PatchDetail,
  PatchPreview,
  PatchStatus,
  PatchView,
  PublicConfig,
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
  if (response.status === 401) await supabase.auth.signOut();
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(response.status, message || `Request failed (${response.status})`);
  }
  return body as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface DriftFilters {
  service?: string;
  type?: DriftType;
  cursor?: string;
  limit?: number;
}

export interface PatchFilters {
  status?: PatchStatus;
  service?: string;
}

export interface Decision {
  serviceName: string;
  notes?: string;
}

const governance = '/api/governance';

export const api = {
  stats: () => request<DashboardStats>(`${governance}/stats`),
  config: () => request<PublicConfig>(`${governance}/config`),
  services: () => request<ServiceSummary[]>(`${governance}/services`),
  service: (name: string) =>
    request<ServiceDetail>(`${governance}/services/${encodeURIComponent(name)}`),
  driftEvents: (filters: DriftFilters) =>
    request<Page<DriftEventView>>(`${governance}/drift-events${query({ ...filters })}`),
  driftEvent: (id: string) => request<DriftEventDetail>(`${governance}/drift-events/${id}`),
  patches: (filters: PatchFilters) =>
    request<PatchView[]>(`${governance}/patches${query({ ...filters })}`),
  patch: (id: string) => request<PatchDetail>(`${governance}/patches/${id}`),
  previewPatch: (id: string) =>
    request<PatchPreview>(`${governance}/patches/${id}/preview`, { method: 'POST' }),
  promotePatch: (id: string, decision: Decision) =>
    request<{ message: string }>(`${governance}/patches/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),
  rollbackPatch: (id: string, decision: Decision) =>
    request<{ message: string }>(`${governance}/patches/${id}/rollback`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),
  audits: (limit = 100) => request<AuditView[]>(`${governance}/audits${query({ limit })}`),
  demoServices: () => request<DemoServiceState[]>('/api/demo/services'),
  setChaos: (serviceName: string, mutated: boolean) =>
    request<DemoServiceState>(`/api/demo/services/${encodeURIComponent(serviceName)}/chaos`, {
      method: 'POST',
      body: JSON.stringify({ mutated }),
    }),
};

/** Query keys in one place so live events can invalidate exactly what changed. */
export const keys = {
  stats: ['stats'] as const,
  config: ['config'] as const,
  services: ['services'] as const,
  service: (name: string) => ['services', name] as const,
  driftEvents: (filters: DriftFilters = {}) => ['drift-events', filters] as const,
  driftEvent: (id: string) => ['drift-event', id] as const,
  patches: (filters: PatchFilters = {}) => ['patches', filters] as const,
  patch: (id: string) => ['patch', id] as const,
  audits: ['audits'] as const,
  demoServices: ['demo-services'] as const,
};
