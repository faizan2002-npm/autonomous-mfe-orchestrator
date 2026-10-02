const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GenerateOptions {
  apiKey: string;
  model: string;
  prompt: string;
  systemInstruction?: string;
  timeoutMs?: number;
  /** Overrides the Gemini API host; used by tests. */
  baseUrl?: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

/** One bounded, non-streaming Gemini generateContent call returning the answer text. */
export async function generateText(options: GenerateOptions): Promise<string> {
  const baseUrl = (options.baseUrl ?? GEMINI_BASE_URL).replace(/\/$/, '');
  const response = await fetch(
    `${baseUrl}/models/${encodeURIComponent(options.model)}:generateContent`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      // The key travels in a header, never the URL, so it stays out of access logs.
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': options.apiKey,
      },
      body: JSON.stringify({
        ...(options.systemInstruction && {
          systemInstruction: { parts: [{ text: options.systemInstruction }] },
        }),
        contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
        generationConfig: { temperature: 0.1 },
      }),
    },
  );
  const data = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    throw new Error(
      `Gemini returned status ${response.status}${data.error?.message ? `: ${data.error.message}` : ''}`,
    );
  }
  if (data.promptFeedback?.blockReason) {
    throw new Error(
      `Gemini blocked the prompt: ${data.promptFeedback.blockReason}`,
    );
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}
