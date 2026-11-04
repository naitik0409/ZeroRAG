import { describe, expect, it } from 'vitest';

import {
    AnthropicAdapter,
    type ChatMessage,
    FunctionAdapter,
    GeminiAdapter,
    OllamaAdapter,
    OpenAICompatibleAdapter,
} from '../src/index.js';

const messages: ChatMessage[] = [
    { role: 'system', content: 'Be helpful.' },
    { role: 'user', content: 'hello' },
];

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function asFetch(
    fn: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
    return fn as unknown as typeof fetch;
}

describe('OpenAICompatibleAdapter', () => {
    it('completes against a mocked Groq-style endpoint with auth header', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        const adapter = new OpenAICompatibleAdapter({
            baseUrl: 'https://api.groq.com/openai/v1',
            model: 'llama-3.3-70b-versatile',
            apiKey: 'gsk_test',
            fetchImpl: asFetch((url, init) => {
                calls.push({ url, init });
                return jsonResponse({ choices: [{ message: { content: 'HI FROM MODEL' } }] });
            }),
        });

        const out = await adapter.complete(messages);
        expect(out).toBe('HI FROM MODEL');
        expect(calls[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');

        const headers = calls[0]?.init?.headers as Record<string, string>;
        expect(headers.authorization).toBe('Bearer gsk_test');
        const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
        expect(body.model).toBe('llama-3.3-70b-versatile');
        expect(body.stream).toBe(false);
        expect(Array.isArray(body.messages)).toBe(true);
    });

    it('works without an API key (Ollama /v1 or vLLM style)', async () => {
        const adapter = new OpenAICompatibleAdapter({
            baseUrl: 'http://localhost:11434/v1',
            model: 'qwen3',
            fetchImpl: asFetch(() =>
                jsonResponse({ choices: [{ message: { content: 'local ok' } }] }),
            ),
        });
        expect(await adapter.complete(messages)).toBe('local ok');
    });

    it('streams SSE deltas', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"content":"Hel"}}]}',
            'data: {"choices":[{"delta":{"content":"lo"}}]}',
            'data: [DONE]',
            '',
        ].join('\n');
        const adapter = new OpenAICompatibleAdapter({
            baseUrl: 'http://localhost:11434/v1',
            model: 'qwen3',
            fetchImpl: asFetch(() => new Response(sse, { status: 200 })),
        });

        const chunks: string[] = [];
        for await (const delta of adapter.stream!(messages)) chunks.push(delta);
        expect(chunks.join('')).toBe('Hello');
    });

    it('throws with status code on HTTP errors', async () => {
        const adapter = new OpenAICompatibleAdapter({
            baseUrl: 'https://api.example.com/v1',
            model: 'x',
            fetchImpl: asFetch(() => new Response('rate limited', { status: 429 })),
        });
        await expect(adapter.complete(messages)).rejects.toThrow(/429/);
    });
});

describe('OllamaAdapter', () => {
    it('completes against a mocked native /api/chat endpoint', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        const adapter = new OllamaAdapter({
            model: 'llama3.2',
            fetchImpl: asFetch((url, init) => {
                calls.push({ url, init });
                return jsonResponse({ message: { content: 'OFFLINE ANSWER' } });
            }),
        });

        expect(await adapter.complete(messages)).toBe('OFFLINE ANSWER');
        expect(calls[0]?.url).toBe('http://localhost:11434/api/chat');
        const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
        expect(body.model).toBe('llama3.2');
        expect(body.stream).toBe(false);
    });

    it('streams NDJSON chunks', async () => {
        const ndjson = [
            JSON.stringify({ message: { content: 'one ' } }),
            JSON.stringify({ message: { content: 'two' } }),
            '',
        ].join('\n');
        const adapter = new OllamaAdapter({
            model: 'llama3.2',
            fetchImpl: asFetch(() => new Response(ndjson, { status: 200 })),
        });

        const chunks: string[] = [];
        for await (const delta of adapter.stream!(messages)) chunks.push(delta);
        expect(chunks.join('')).toBe('one two');
    });

    it('surfaces Ollama error payloads', async () => {
        const adapter = new OllamaAdapter({
            model: 'missing',
            fetchImpl: asFetch(() => jsonResponse({ error: 'model not found' })),
        });
        await expect(adapter.complete(messages)).rejects.toThrow(/model not found/);
    });
});

describe('AnthropicAdapter', () => {
    it('splits system prompt and posts to /v1/messages', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        const adapter = new AnthropicAdapter({
            apiKey: 'sk-ant-test',
            model: 'claude-haiku-4-5',
            fetchImpl: asFetch((url, init) => {
                calls.push({ url, init });
                return jsonResponse({ content: [{ type: 'text', text: 'CLAUDE SAYS HI' }] });
            }),
        });

        expect(await adapter.complete(messages)).toBe('CLAUDE SAYS HI');
        expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');

        const headers = calls[0]?.init?.headers as Record<string, string>;
        expect(headers['x-api-key']).toBe('sk-ant-test');
        expect(headers['anthropic-version']).toBe('2023-06-01');

        const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
        expect(body.system).toBe('Be helpful.');
        expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(body.model).toBe('claude-haiku-4-5');
    });

    it('surfaces API error payloads', async () => {
        const adapter = new AnthropicAdapter({
            apiKey: 'bad',
            model: 'claude-haiku-4-5',
            fetchImpl: asFetch(() =>
                jsonResponse({ error: { message: 'invalid x-api-key' } }, 401),
            ),
        });
        await expect(adapter.complete(messages)).rejects.toThrow(/401/);
    });
});

describe('GeminiAdapter', () => {
    it('maps roles and posts to generateContent', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        const adapter = new GeminiAdapter({
            apiKey: 'AIza-test',
            model: 'gemini-2.0-flash',
            fetchImpl: asFetch((url, init) => {
                calls.push({ url, init });
                return jsonResponse({
                    candidates: [{ content: { parts: [{ text: 'GEMINI HELLO' }] } }],
                });
            }),
        });

        expect(await adapter.complete(messages)).toBe('GEMINI HELLO');
        expect(calls[0]?.url).toContain('/models/gemini-2.0-flash:generateContent?key=AIza-test');

        const body = JSON.parse(String(calls[0]?.init?.body)) as {
            systemInstruction: { parts: { text: string }[] };
            contents: unknown[];
        };
        expect(body.systemInstruction.parts[0]?.text).toBe('Be helpful.');
        expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
    });

    it('maps assistant messages to the model role', async () => {
        let captured: { contents?: unknown[] } = {};
        const adapter = new GeminiAdapter({
            apiKey: 'k',
            model: 'gemini-2.0-flash',
            fetchImpl: asFetch((_url, init) => {
                captured = JSON.parse(String(init?.body));
                return jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
            }),
        });

        await adapter.complete([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello there' },
            { role: 'user', content: 'again' },
        ]);
        expect((captured.contents ?? []).map((c) => (c as { role: string }).role)).toEqual([
            'user',
            'model',
            'user',
        ]);
    });
});

describe('FunctionAdapter', () => {
    it('delegates to the provided function (Vercel AI SDK bridge)', async () => {
        const adapter = new FunctionAdapter(async (msgs, opts) => {
            expect(msgs).toEqual(messages);
            expect(opts?.temperature).toBe(0.2);
            return 'FROM CUSTOM FN';
        });

        expect(await adapter.complete(messages, { temperature: 0.2 })).toBe('FROM CUSTOM FN');
    });
});
