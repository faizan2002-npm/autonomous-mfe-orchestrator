import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  traceId: string;
  spanId: string;
  requestId: string;
  orgId?: string;
  userId?: string;
}

const contextStorage = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext | undefined {
  return contextStorage.getStore();
}

export function initializeContext(context: RequestContext): void {
  contextStorage.enterWith(context);
}

export function runWithContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return contextStorage.run(context, fn);
}

export function runWithContextAsync<T>(
  context: RequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return contextStorage.run(context, fn);
}

export function getTraceId(): string {
  return getContext()?.traceId || '';
}

export function getSpanId(): string {
  return getContext()?.spanId || '';
}

export function getRequestId(): string {
  return getContext()?.requestId || '';
}

export function getOrgId(): string | undefined {
  return getContext()?.orgId;
}

export function getUserId(): string | undefined {
  return getContext()?.userId;
}

export function updateContext(updates: Partial<RequestContext>): void {
  const current = getContext();
  if (current) {
    const updated: RequestContext = { ...current, ...updates };
    initializeContext(updated);
  }
}
