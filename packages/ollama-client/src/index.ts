export interface GenerateOptions {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs?: number;
}

/** One reusable client for bounded, non-streaming Ollama requests. */
export async function generateText(options: GenerateOptions): Promise<string> {
  const response = await fetch(
    `${options.baseUrl.replace(/\/$/, '')}/api/generate`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        prompt: options.prompt,
        stream: false,
        options: { temperature: 0.1 },
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Ollama returned status ${response.status}`);
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== 'object' ||
    !('response' in data) ||
    typeof data.response !== 'string' ||
    !data.response.trim()
  ) {
    throw new Error('Ollama returned an empty or invalid response');
  }
  return data.response;
}
