import type { ChatMessage, LLMAdapter, LLMOptions } from '../interfaces.js';

export interface AnthropicOptions {
    apiKey: string;
    /** e.g. claude-sonnet-4-5, claude-haiku-4-5 */
    model: string;
    baseUrl?: string;
    anthropicVersion?: string;
    maxTokens?: number;
    fetchImpl?: typeof fetch;
}

interface AnthropicResponse {
    content?: { type: string; text?: string }[];
    error?: { message?: string };
}

/** Adapter for the Anthropic Messages API. */
export class AnthropicAdapter implements LLMAdapter {
    readonly name = 'anthropic';
    private readonly options: AnthropicOptions;

    constructor(options: AnthropicOptions) {
        this.options = options;
    }

    private buildBody(messages: ChatMessage[], opts: LLMOptions | undefined, stream: boolean) {
        const system = messages
            .filter((m) => m.role === 'system')
            .map((m) => m.content)
            .join('\n\n');
        const rest = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        const body: Record<string, unknown> = {
            model: this.options.model,
            max_tokens: opts?.maxTokens ?? this.options.maxTokens ?? 1024,
            messages: rest,
            stream,
        };
        if (system) body.system = system;
        if (opts?.temperature !== undefined) body.temperature = opts.temperature;
        return body;
    }

    private headers(): Record<string, string> {
        return {
            'content-type': 'application/json',
            'x-api-key': this.options.apiKey,
            'anthropic-version': this.options.anthropicVersion ?? '2023-06-01',
        };
    }

    async complete(messages: ChatMessage[], opts?: LLMOptions): Promise<string> {
        const url = `${(this.options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
        const doFetch = this.options.fetchImpl ?? fetch;
        const res = await doFetch(url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(this.buildBody(messages, opts, false)),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Anthropic request failed (${res.status}): ${text.slice(0, 300)}`);
        }
        const data = (await res.json()) as AnthropicResponse;
        if (data.error?.message) throw new Error(`Anthropic error: ${data.error.message}`);
        const text = data.content?.find((b) => b.type === 'text')?.text;
        if (typeof text !== 'string')
            throw new Error('Anthropic response missing content text block');
        return text;
    }

    async *stream(messages: ChatMessage[], opts?: LLMOptions): AsyncGenerator<string> {
        const url = `${(this.options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
        const doFetch = this.options.fetchImpl ?? fetch;
        const res = await doFetch(url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(this.buildBody(messages, opts, true)),
        });
        if (!res.ok || !res.body) {
            const text = await res.text().catch(() => '');
            throw new Error(
                `Anthropic stream request failed (${res.status}): ${text.slice(0, 300)}`,
            );
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
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                try {
                    const event = JSON.parse(payload) as {
                        type?: string;
                        delta?: { text?: string };
                    };
                    if (event.type === 'content_block_delta' && event.delta?.text) {
                        yield event.delta.text;
                    }
                } catch {
                    // ignore partial lines
                }
            }
        }
    }
}
