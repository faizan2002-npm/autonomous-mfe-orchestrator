import { RetryPolicy, defaultRetryPolicy } from './retry-policy.js';

/** Simple in-memory cache for successful upstream responses. */
class ResponseCache {
  private readonly cache = new Map<string, { payload: unknown; expiresAt: number }>();
  private readonly maxEntries = 1000;

  get(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.payload;
  }

  set(key: string, payload: unknown, ttlMs: number): void {
    // Simple LRU: delete oldest entry if cache is full
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { payload, expiresAt: Date.now() + ttlMs });
  }
}

const responseCache = new ResponseCache();

export interface UpstreamRequest {
  baseUrl: string;
  path: string;
  method: string;
  query?: string;
  body?: unknown;
  timeoutMs?: number;
  /** Extra headers sent upstream, e.g. service credentials. */
  headers?: Record<string, string>;
  /** W3C Trace Context for distributed tracing (traceparent header). */
  traceparent?: string;
  /** Cache responses for GET requests; default 300000ms (5 min). Set to 0 to disable. */
  cacheTtlMs?: number;
  /** Transport override, e.g. an SSRF-guarded fetch. */
  fetch?: typeof fetch;
  /** Retry policy; defaults to 3 attempts with exponential backoff. */
  retry?: RetryPolicy | { maxAttempts?: number; initialDelayMs?: number; maxDelayMs?: number };
}

export { RetryPolicy };

/** JSON transport shared by gateway routes; leaves drift handling to callers. */
export async function requestUpstream(
  request: UpstreamRequest,
): Promise<{ status: number; payload: unknown }> {
  // Build retry policy from request options or use default
  let retryPolicy: RetryPolicy;
  if (request.retry instanceof RetryPolicy) {
    retryPolicy = request.retry;
  } else if (request.retry) {
    retryPolicy = new RetryPolicy(request.retry);
  } else {
    retryPolicy = defaultRetryPolicy;
  }

  // Execute with retry
  return retryPolicy.execute(
    () => performRequest(request),
    `${request.method} ${request.path}`,
  );
}

async function performRequest(
  request: UpstreamRequest,
): Promise<{ status: number; payload: unknown }> {
  const url = `${request.baseUrl.replace(/\/$/, '')}/${request.path.replace(/^\/+/, '')}${request.query || ''}`;
  const method = request.method.toUpperCase();
  const send = request.fetch ?? fetch;
  const cacheKey = `${method}:${url}`;
  const cacheTtlMs = request.cacheTtlMs ?? (method === 'GET' ? 300_000 : 0);

  // Check cache for GET requests
  if (method === 'GET' && cacheTtlMs > 0) {
    const cached = responseCache.get(cacheKey);
    if (cached !== undefined) {
      return { status: 200, payload: cached };
    }
  }

  // Build headers with traceparent for distributed tracing
  const headers: Record<string, string> = {
    ...request.headers,
    'content-type': 'application/json',
  };
  if (request.traceparent) {
    headers['traceparent'] = request.traceparent;
  }

  try {
    const response = await send(url, {
      method,
      headers,
      body:
        method === 'GET' || method === 'HEAD' || request.body === undefined
          ? undefined
          : JSON.stringify(request.body),
      signal: AbortSignal.timeout(request.timeoutMs ?? 10_000),
      redirect: 'manual',
    });

    const payload =
      response.status === 204 || response.status === 205 || method === 'HEAD'
        ? undefined
        : await response.json();

    // Cache successful GET responses
    if (method === 'GET' && cacheTtlMs > 0 && response.status < 300) {
      responseCache.set(cacheKey, payload, cacheTtlMs);
    }

    return { status: response.status, payload };
  } catch (error) {
    // On timeout, try to serve cached response as fallback
    if (
      method === 'GET' &&
      cacheTtlMs > 0 &&
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      const cached = responseCache.get(cacheKey);
      if (cached !== undefined) {
        return { status: 200, payload: cached }; // Serve stale cache
      }
    }
    throw error;
  }
}
