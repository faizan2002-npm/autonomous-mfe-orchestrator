import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateText } from './index.js';

async function withServer(
  handler: (req: IncomingMessage, body: string) => [number, unknown],
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const [status, payload] = handler(req, body);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('sends the key as a header and joins non-thought answer parts', async () => {
  let seen: { url?: string; key?: string; body?: Record<string, unknown> } = {};
  await withServer(
    (req, body) => {
      seen = {
        url: req.url,
        key: req.headers['x-goog-api-key'] as string,
        body: JSON.parse(body),
      };
      return [
        200,
        {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'thinking...', thought: true },
                  { text: '(data) => ' },
                  { text: 'data' },
                ],
              },
            },
          ],
        },
      ];
    },
    async (baseUrl) => {
      const text = await generateText({
        baseUrl,
        apiKey: 'test-key',
        model: 'gemini-test',
        prompt: 'adapt',
        systemInstruction: 'rules',
      });
      assert.equal(text, '(data) => data');
    },
  );
  assert.equal(seen.url, '/models/gemini-test:generateContent');
  assert.equal(seen.key, 'test-key');
  assert.deepEqual(seen.body?.systemInstruction, {
    parts: [{ text: 'rules' }],
  });
});

test('surfaces API errors and blocked prompts without leaking the key', async () => {
  await withServer(
    () => [
      400,
      { error: { message: 'API key not valid', status: 'INVALID_ARGUMENT' } },
    ],
    async (baseUrl) => {
      await assert.rejects(
        generateText({
          baseUrl,
          apiKey: 'secret-key',
          model: 'm',
          prompt: 'p',
        }),
        (error: Error) =>
          /status 400: API key not valid/.test(error.message) &&
          !error.message.includes('secret-key'),
      );
    },
  );
  await withServer(
    () => [200, { promptFeedback: { blockReason: 'SAFETY' } }],
    async (baseUrl) => {
      await assert.rejects(
        generateText({ baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }),
        /blocked the prompt: SAFETY/,
      );
    },
  );
});
