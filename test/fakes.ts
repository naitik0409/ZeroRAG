import type { ChatMessage, EmbeddingProvider, LLMAdapter, LLMOptions } from '../src/index.js';

/** Deterministic bag-of-words embedder for fast, offline tests. */
export class FakeEmbedder implements EmbeddingProvider {
    constructor(private readonly dim = 64) {}

    private vector(text: string): number[] {
        const v = new Array<number>(this.dim).fill(0);
        for (const token of text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean)) {
            let h = 2166136261;
            for (let i = 0; i < token.length; i++) {
                h ^= token.charCodeAt(i);
                h = Math.imul(h, 16777619) >>> 0;
            }
            const idx = h % this.dim;
            v[idx] = (v[idx] ?? 0) + 1;
        }
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        return v.map((x) => x / norm);
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        return texts.map((t) => this.vector(t));
    }

    async embedQuery(text: string): Promise<number[]> {
        return this.vector(text);
    }

    async getDimensions(): Promise<number> {
        return this.dim;
    }
}

/** Records the messages it received and returns a canned answer. */
export class FakeLLM implements LLMAdapter {
    readonly name = 'fake';
    lastMessages: ChatMessage[] | null = null;
    lastOptions: LLMOptions | undefined;

    async complete(messages: ChatMessage[], opts?: LLMOptions): Promise<string> {
        this.lastMessages = messages;
        this.lastOptions = opts;
        return 'FAKE ANSWER WITH CITATION [1]';
    }
}
