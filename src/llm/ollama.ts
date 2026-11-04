import type { ChatMessage, LLMAdapter, LLMOptions } from '../interfaces.js';

export interface OllamaOptions {
    /** Default: http://localhost:11434 */
    baseUrl?: string;
    /** Model name pulled into Ollama, e.g. llama3.2, qwen3, gemma3 */
    model: string;
    fetchImpl?: typeof fetch;
}

interface OllamaChatResponse {
    message?: { content?: string };
    error?: string;
}

/**
 * Native adapter for a local Ollama server — fully offline, zero API cost.
 */
export class OllamaAdapter implements LLMAdapter {
    readonly name = 'ollama';
    private readonly options: OllamaOptions;

    constructor(options: OllamaOptions) {
        this.options = options;
    }

    private buildRequest(messages: ChatMessage[], opts: LLMOptions | undefined, stream: boolean) {
        const body: Record<string, unknown> = {
            model: this.options.model,
            messages,
            stream,
        };
        if (opts?.temperature !== undefined) body.options = { temperature: opts.temperature };
        if (opts?.maxTokens !== undefined) {
            body.options = { ...(body.options as object), num_predict: opts.maxTokens };
        }
        const url = `${(this.options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '')}/api/chat`;
        return { url, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } as RequestInit };
    }

    async complete(messages: ChatMessage[], opts?: LLMOptions): Promise<string> {
        const { url, init } = this.buildRequest(messages, opts, false);
        const doFetch = this.options.fetchImpl ?? fetch;
        const res = await doFetch(url, init);
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Ollama request failed (${res.status}): ${text.slice(0, 300)}`);
        }
        const data = (await res.json()) as OllamaChatResponse;
        if (data.error) throw new Error(`Ollama error: ${data.error}`);
        const content = data.message?.content;
        if (typeof content !== 'string') throw new Error('Ollama response missing message.content');
        return content;
    }

    async *stream(messages: ChatMessage[], opts?: LLMOptions): AsyncGenerator<string> {
        const { url, init } = this.buildRequest(messages, opts, true);
        const doFetch = this.options.fetchImpl ?? fetch;
        const res = await doFetch(url, init);
        if (!res.ok || !res.body) {
            const text = await res.text().catch(() => '');
            throw new Error(`Ollama stream request failed (${res.status}): ${text.slice(0, 300)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const chunk = JSON.parse(line) as OllamaChatResponse;
                    if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
                    if (chunk.message?.content) yield chunk.message.content;
                } catch (e) {
                    if (e instanceof Error && e.message.startsWith('Ollama error')) throw e;
                    // ignore partial lines
                }
            }
        }
    }
}
