export interface UpstreamRequest {
  baseUrl: string;
  path: string;
  method: string;
  query?: string;
  body?: unknown;
  timeoutMs?: number;
  /** Extra headers sent upstream, e.g. service credentials. */
  headers?: Record<string, string>;
  /** Transport override, e.g. an SSRF-guarded fetch. */
  fetch?: typeof fetch;
}

/** JSON transport shared by gateway routes; leaves drift handling to callers. */
export async function requestUpstream(
  request: UpstreamRequest,
): Promise<{ status: number; payload: unknown }> {
  const url = `${request.baseUrl.replace(/\/$/, '')}/${request.path.replace(/^\/+/, '')}${request.query || ''}`;
  const method = request.method.toUpperCase();
  const send = request.fetch ?? fetch;
  const response = await send(url, {
    method,
    headers: { ...request.headers, 'content-type': 'application/json' },
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
  return { status: response.status, payload };
}
