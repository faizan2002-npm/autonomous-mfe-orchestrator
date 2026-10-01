export interface UpstreamRequest {
  baseUrl: string;
  path: string;
  method: string;
  query?: string;
  body?: unknown;
  timeoutMs?: number;
}

/** JSON transport shared by gateway routes; leaves drift handling to callers. */
export async function requestUpstream(
  request: UpstreamRequest,
): Promise<{ status: number; payload: unknown }> {
  const url = `${request.baseUrl.replace(/\/$/, '')}/${request.path.replace(/^\/+/, '')}${request.query || ''}`;
  const method = request.method.toUpperCase();
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
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
