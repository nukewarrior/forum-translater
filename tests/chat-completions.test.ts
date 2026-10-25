// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { aiEndpoint, aiRequestBody, ChatCompletionStreamDecoder, decodeChatCompletion, translateAi } from '../src/translation/ai';
import { DEFAULTS, type AiProfile } from '../src/settings';

const ai: AiProfile = { ...DEFAULTS.ai, protocol: 'chat-completions',
  baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: '', reasoningEffort: 'auto' };
const chunk = (payload: unknown): string => 'data: ' + JSON.stringify(payload) + '\n\n';
const completed = (text: string): string => JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('uses Chat Completions fields without a Responses-specific payload', () => {
  expect(aiEndpoint(ai)).toBe('https://api.example.com/v1/chat/completions');
  const body = aiRequestBody(ai, [{ text: 'Hello' }]) as Record<string, unknown>;
  expect(body).toMatchObject({ model: 'test-model', stream: true });
  expect(body.messages).toEqual([{ role: 'system', content: expect.any(String) }, { role: 'user', content: expect.stringContaining('Hello') }]);
  expect(body).not.toHaveProperty('input');
  expect(body).not.toHaveProperty('reasoning');
  expect(body).not.toHaveProperty('reasoning_effort');
  expect(body).not.toHaveProperty('store');
});
it('decodes fragmented SSE without rendering reasoning tokens', () => {
  const decoder = new ChatCompletionStreamDecoder();
  const text = chunk({ choices: [{ delta: { reasoning_content: 'private thinking' } }] })
    + chunk({ choices: [{ delta: { content: '{"section_0":"你' } }] })
    + chunk({ choices: [{ delta: { content: '好"}' } }] }) + 'data: [DONE]\n\n';
  expect(decoder.push(text.slice(0, 13))).toBe('');
  expect(decoder.push(text, true)).toBe('{"section_0":"你好"}');
  expect(decoder.done).toBe(true);
  const bad = new ChatCompletionStreamDecoder();
  expect(() => bad.push(chunk({ choices: [{ delta: {}, finish_reason: 'length' }] }), true)).toThrow('长度限制');
});
it('rejects truncated non-stream content and accepts a complete choice', () => {
  expect(decodeChatCompletion(completed('{"section_0":"你好"}'))).toBe('{"section_0":"你好"}');
  expect(() => decodeChatCompletion(JSON.stringify({ choices: [{ message: { content: 'x' }, finish_reason: 'length' }] }))).toThrow('长度限制');
});
it('sends no Authorization header for an empty API Key', async () => {
  const transport = vi.fn((options: GmRequestOptions) => {
    queueMicrotask(() => options.onload?.({ status: 200, responseText: completed('{"section_0":"你好"}') }));
    return { abort: vi.fn() };
  });
  vi.stubGlobal('GM_xmlhttpRequest', transport);
  await expect(translateAi('Hello', ai, new AbortController().signal)).resolves.toBe('你好');
  expect(transport).toHaveBeenCalledOnce();
  expect(transport.mock.calls[0]?.[0].headers).not.toHaveProperty('Authorization');
  expect(transport.mock.calls[0]?.[0].url).toContain('/chat/completions');
});
it('retries once without streaming only after an explicit unsupported-stream error', async () => {
  const transport = vi.fn((options: GmRequestOptions) => {
    queueMicrotask(() => options.onload?.(transport.mock.calls.length === 1
      ? { status: 400, responseText: '{"error":{"message":"stream is not supported"}}' }
      : { status: 200, responseText: completed('{"section_0":"你好"}') }));
    return { abort: vi.fn() };
  });
  vi.stubGlobal('GM_xmlhttpRequest', transport);
  await expect(translateAi('Hello', ai, new AbortController().signal)).resolves.toBe('你好');
  expect(transport).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(transport.mock.calls[0]?.[0].data)).stream).toBe(true);
  expect(JSON.parse(String(transport.mock.calls[1]?.[0].data)).stream).toBe(false);
});
