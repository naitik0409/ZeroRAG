// Core
export { ZeroRAG, buildSources, type ZeroRAGOptions } from './core/rag.js';
export { defineConfig } from './core/config.js';
export { extractiveAnswer, splitSentences, type ExtractiveOptions, type ExtractiveResult } from './core/extractive.js';
export { splitText, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, type ChunkingOptions } from './core/chunker.js';

// Defaults / adapters
export { FastEmbedProvider, type FastEmbedOptions } from './embeddings/fastembed.js';
export { LanceDBStore, type LanceDBStoreOptions } from './store/lancedb.js';
export { MemoryStore, rrfFusion } from './store/memory.js';
export { TextLoader, type TextLoaderOptions } from './loaders/text.js';
export { FileLoader, type FileLoaderOptions } from './loaders/file.js';

// Utilities
export { cosineSimilarity, distanceToScore, lexicalOverlap, tokenize } from './util/text.js';

// Types & interfaces
export type {
    Chunk,
    ChunkMetadata,
    InsertChunk,
    ScoredChunk,
    Source,
    AskResult,
    SearchResult,
    LoaderResult,
} from './types.js';
export type {
    EmbeddingProvider,
    VectorStore,
    LLMAdapter,
    LLMOptions,
    ChatMessage,
    ChatRole,
    Loader,
    SearchProvider,
} from './interfaces.js';
