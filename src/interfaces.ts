import type { Chunk, InsertChunk, ScoredChunk, SearchResult } from './types.js';

export interface EmbeddingProvider {
    init?(): Promise<void>;
    embedDocuments(texts: string[]): Promise<number[][]>;
    embedQuery(text: string): Promise<number[]>;
    getDimensions(): Promise<number>;
}

export interface VectorStore {
    init(opts: { dimensions: number }): Promise<void>;
    add(chunks: InsertChunk[]): Promise<number>;
    search(query: number[], k: number): Promise<ScoredChunk[]>;
    /** Optional hybrid (vector + full-text) search; falls back to search() when absent */
    hybridSearch?(query: string, queryVector: number[], k: number): Promise<ScoredChunk[]>;
    count(): Promise<number>;
    deleteByLoader(loaderId: string): Promise<boolean>;
    /** Optional: whether a loader's chunks already exist in the store (persistent dedupe across restarts) */
    hasLoader?(loaderId: string): Promise<boolean>;
    reset(): Promise<void>;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
    role: ChatRole;
    content: string;
}

export interface LLMOptions {
    temperature?: number;
    maxTokens?: number;
}

/**
 * Bring-your-own-LLM adapter. Any provider (OpenAI, Ollama, Groq, Anthropic,
 * local servers exposing an HTTP API, or a custom function) can be wrapped in
 * this interface. zerorag never ships or requires a specific LLM.
 */
export interface LLMAdapter {
    readonly name: string;
    complete(messages: ChatMessage[], opts?: LLMOptions): Promise<string>;
    stream?(messages: ChatMessage[], opts?: LLMOptions): AsyncGenerator<string>;
}

export interface Loader {
    getUniqueId(): string;
    getChunks(): AsyncGenerator<Chunk>;
}

export interface SearchProvider {
    readonly name: string;
    search(
        query: string,
        opts?: { maxResults?: number; freshWithinDays?: number },
    ): Promise<SearchResult[]>;
}
