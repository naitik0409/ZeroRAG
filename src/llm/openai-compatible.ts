import type { ChatMessage, LLMAdapter, LLMOptions } from '../interfaces.js';

export interface OpenAICompatibleOptions {
    /** API base, e.g. https://api.openai.com/v1, https://api.groq.com/openai/v1, http://localhost:11434/v1 */
    baseUrl: string;
    /** Model id, e.g. gpt-4o-mini, llama-3.3-70b-versatile, qwen3 */
    model: string;
    /** Optional — many local servers (Ollama, vLLM, LM Studio) accept any/no key */
    apiKey?: string;
    defaultHeaders?: Record<string, string>;
    /** Injectable fetch for tests / custom agents */
    fetchImpl?: typeof fetch;
}

interface ChatCompletionChunk {
    choices?: { delta?: { content?: string | null }; message?: { content?: string | null } }[];
}

/**
 * Adapter for every OpenAI-compatible endpoint: OpenAI, Groq, DeepSeek,
 * Together, Fireworks, Gemini's OpenAI-compat layer, Ollama (/v1),
 * vLLM, LM Studio, and llama.cpp server.
 */
export class OpenAICompatibleAdapter implements LLMAdapter {
    readonly name = 'openai-compatible';
    private readonly options: OpenAICompatibleOptions;

    constructor(options: OpenAICompatibleOptions) {
        this.options = options;
    }

    private buildRequest(messages: ChatMessage[], opts: LLMOptions | undefined, stream: boolean) {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            ...this.options.defaultHeaders,
        };
        if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;

        const body: Record<string, unknown> = {
            model: this.options.model,
            messages,
            stream,
        };
        if (opts?.temperature !== undefined) body.temperature = opts.temperature;
        if (opts?.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

        const url = `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`;
        return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } as RequestInit };
    }

    async complete(messages: ChatMessage[], opts?: LLMOptions): Promise<string> {
        const { url, init } = this.buildRequest(messages, opts, false);
        const doFetch = this.options.fetchImpl ?? fetch;
        const res = await doFetch(url, init);
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`OpenAI-compatible request failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`);
        }
        const data = (await res.json()) as ChatCompletionChunk;
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('OpenAI-compatible response missing choices[0].message.content');
        return content;
    }

    async *stream(messages: ChatMessage[], opts?: LLMOptions): AsyncGenerator<string> {
        const { url, init } = this.buildRequest(messages, opts, true);
        const doFetch = this.options.fetchImpl ?? fetch;
        const res = await doFetch(url, init);
        if (!res.ok || !res.body) {
            const text = await res.text().catch(() => '');
            throw new Error(`OpenAI-compatible stream request failed (${res.status}): ${text.slice(0, 300)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:')) continue;
                    const payload = trimmed.slice(5).trim();
                    if (payload === '[DONE]') return;
                    try {
                        const chunk = JSON.parse(payload) as ChatCompletionChunk;
                        const delta = chunk.choices?.[0]?.delta?.content;
                        if (delta) yield delta;
                    } catch {
                        // ignore partial/keepalive lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
