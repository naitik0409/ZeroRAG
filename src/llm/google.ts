import type { ChatMessage, LLMAdapter, LLMOptions } from '../interfaces.js';

export interface GeminiOptions {
    apiKey: string;
    /** e.g. gemini-2.0-flash, gemini-2.5-flash */
    model: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
}

interface GeminiResponse {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
}

/** Adapter for the Google Gemini generateContent API. */
export class GeminiAdapter implements LLMAdapter {
    readonly name = 'google-gemini';
    private readonly options: GeminiOptions;

    constructor(options: GeminiOptions) {
        this.options = options;
    }

    private buildBody(messages: ChatMessage[], opts: LLMOptions | undefined) {
        const system = messages
            .filter((m) => m.role === 'system')
            .map((m) => m.content)
            .join('\n\n');
        const contents = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            }));

        const body: Record<string, unknown> = { contents };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        const generationConfig: Record<string, unknown> = {};
        if (opts?.temperature !== undefined) generationConfig.temperature = opts.temperature;
        if (opts?.maxTokens !== undefined) generationConfig.maxOutputTokens = opts.maxTokens;
        if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
        return body;
    }

    async complete(messages: ChatMessage[], opts?: LLMOptions): Promise<string> {
        const base = (this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
        const url = `${base}/models/${this.options.model}:generateContent?key=${encodeURIComponent(this.options.apiKey)}`;
        const doFetch = this.options.fetchImpl ?? fetch;
        const res = await doFetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(this.buildBody(messages, opts)),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 300)}`);
        }
        const data = (await res.json()) as GeminiResponse;
        if (data.error?.message) throw new Error(`Gemini error: ${data.error.message}`);
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
        if (typeof text !== 'string' || text.length === 0) {
            throw new Error('Gemini response missing candidates[0].content.parts text');
        }
        return text;
    }
}
