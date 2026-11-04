// Core

export {
    type ChunkingOptions,
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_CHUNK_SIZE,
    splitText,
} from './core/chunker.js';
export { defineConfig } from './core/config.js';
export {
    type ExtractiveOptions,
    type ExtractiveResult,
    extractiveAnswer,
    splitSentences,
} from './core/extractive.js';
export { type AskLiveOptions, buildSources, ZeroRAG, type ZeroRAGOptions } from './core/rag.js';
// Defaults / adapters
export { type FastEmbedOptions, FastEmbedProvider } from './embeddings/fastembed.js';
export type {
    ChatMessage,
    ChatRole,
    EmbeddingProvider,
    LLMAdapter,
    LLMOptions,
    Loader,
    SearchProvider,
    VectorStore,
} from './interfaces.js';
export { AnthropicAdapter, type AnthropicOptions } from './llm/anthropic.js';
export { FunctionAdapter, type LLMFunction } from './llm/function.js';
export { GeminiAdapter, type GeminiOptions } from './llm/google.js';
export { OllamaAdapter, type OllamaOptions } from './llm/ollama.js';
// LLM adapters (bring-your-own — zerorag ships no LLM of its own)
export { OpenAICompatibleAdapter, type OpenAICompatibleOptions } from './llm/openai-compatible.js';
export { FileLoader, type FileLoaderOptions } from './loaders/file.js';
export { TextLoader, type TextLoaderOptions } from './loaders/text.js';
export { type DuckDuckGoOptions, DuckDuckGoProvider } from './search/duckduckgo.js';
// Realtime (keyless live web search)
export {
    type FetchPageResult,
    fuseResults,
    LiveSearch,
    type LiveSearchConfig,
    normalizeUrl,
} from './search/live.js';
export { type RssOptions, RssProvider } from './search/rss.js';
export { type WikipediaOptions, WikipediaProvider } from './search/wikipedia.js';
export { LanceDBStore, type LanceDBStoreOptions } from './store/lancedb.js';
export { MemoryStore, rrfFusion } from './store/memory.js';
// Types & interfaces
export type {
    AskResult,
    Chunk,
    ChunkMetadata,
    InsertChunk,
    LoaderResult,
    ScoredChunk,
    SearchResult,
    Source,
} from './types.js';
export { decodeEntities, htmlToText } from './util/html.js';
// Utilities
export { cosineSimilarity, distanceToScore, lexicalOverlap, tokenize } from './util/text.js';
