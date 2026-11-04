import type { EmbeddingProvider, LLMAdapter, Loader } from '../interfaces.js';
import type { AskResult, Chunk, InsertChunk, LoaderResult, ScoredChunk, Source } from '../types.js';
import { FastEmbedProvider } from '../embeddings/fastembed.js';
import { FileLoader } from '../loaders/file.js';
import { TextLoader } from '../loaders/text.js';
import { LanceDBStore } from '../store/lancedb.js';
import type { VectorStore } from '../interfaces.js';
import { extractiveAnswer } from './extractive.js';

export interface ZeroRAGOptions {
    /** Embedding provider. Default: local FastEmbedProvider (bge-small, ONNX, no API key) */
    embedder?: EmbeddingProvider;
    /** Vector store. Default: embedded LanceDB at ./.zerorag */
    store?: VectorStore;
    /** Bring-your-own LLM. When omitted, ask() runs in extractive (zero-LLM) mode. */
    llm?: LLMAdapter;
    chunkSize?: number;
    chunkOverlap?: number;
    topK?: number;
    systemMessage?: string;
    maxExtractiveSentences?: number;
}

const DEFAULT_SYSTEM_MESSAGE =
    'You are a helpful assistant. Answer the question using only the provided context. ' +
    'If the context does not contain the answer, say that you do not know. ' +
    'Cite supporting sources inline using [n] markers.';

const INSERT_BATCH_SIZE = 64;

export class ZeroRAG {
    private readonly seenLoaders = new Set<string>();

    private constructor(
        private readonly embedder: EmbeddingProvider,
        private readonly store: VectorStore,
        private readonly options: ZeroRAGOptions,
    ) {}

    /** Create and initialize a RAG instance with free, local defaults. */
    static async create(options: ZeroRAGOptions = {}): Promise<ZeroRAG> {
        const embedder = options.embedder ?? new FastEmbedProvider();
        await embedder.init?.();
        const dimensions = await embedder.getDimensions();

        const store = options.store ?? new LanceDBStore();
        await store.init({ dimensions });

        return new ZeroRAG(embedder, store, options);
    }

    async addText(
        text: string,
        opts: { source?: string; metadata?: Record<string, unknown> } = {},
    ): Promise<LoaderResult> {
        const loader = new TextLoader(text, {
            source: opts.source,
            metadata: opts.metadata,
            chunkSize: this.options.chunkSize,
            chunkOverlap: this.options.chunkOverlap,
        });
        return this.addLoader(loader);
    }

    async addFile(
        path: string,
        opts: { extensions?: string[]; metadata?: Record<string, unknown> } = {},
    ): Promise<LoaderResult> {
        const loader = new FileLoader(path, {
            extensions: opts.extensions,
            metadata: opts.metadata,
            chunkSize: this.options.chunkSize,
            chunkOverlap: this.options.chunkOverlap,
        });
        return this.addLoader(loader);
    }

    async addLoader(loader: Loader, force = false): Promise<LoaderResult> {
        const loaderId = loader.getUniqueId();
        if (!force && this.seenLoaders.has(loaderId)) {
            return { loaderId, chunksAdded: 0 };
        }
        let buffer: Chunk[] = [];
        let chunksAdded = 0;

        const flush = async (): Promise<void> => {
            if (buffer.length === 0) return;
            const vectors = await this.embedder.embedDocuments(buffer.map((c) => c.pageContent));
            const start = chunksAdded;
            const insert: InsertChunk[] = buffer.map((chunk, idx) => ({
                ...chunk,
                vector: vectors[idx] ?? [],
                metadata: {
                    ...chunk.metadata,
                    loaderId,
                    id: `${loaderId}_${start + idx}`,
                },
            }));
            await this.store.add(insert);
            chunksAdded += buffer.length;
            buffer = [];
        };

        for await (const chunk of loader.getChunks()) {
            buffer.push(chunk);
            if (buffer.length >= INSERT_BATCH_SIZE) await flush();
        }
        await flush();
        this.seenLoaders.add(loaderId);

        return { loaderId, chunksAdded };
    }

    /** Retrieve relevant chunks for a query (hybrid when the store supports it). */
    async search(query: string, k?: number): Promise<ScoredChunk[]> {
        const topK = k ?? this.options.topK ?? 5;
        const queryVector = await this.embedder.embedQuery(query);
        if (this.store.hybridSearch) {
            return this.store.hybridSearch(query, queryVector, topK);
        }
        return this.store.search(queryVector, topK);
    }

    /**
     * Answer a question. Uses the configured LLM adapter when present,
     * otherwise falls back to zero-LLM extractive answering.
     */
    async ask(
        query: string,
        opts: { maxSentences?: number } = {},
    ): Promise<AskResult> {
        const chunks = await this.search(query);
        const sources = buildSources(chunks);

        if (!this.options.llm) {
            const { answer } = await extractiveAnswer(query, chunks, this.embedder, {
                maxSentences: opts.maxSentences ?? this.options.maxExtractiveSentences ?? 5,
            });
            return {
                answer: answer || 'No relevant context found in the knowledge base.',
                mode: 'extractive',
                sources,
                chunks,
            };
        }

        const context = chunks.map((chunk, i) => `[${i + 1}] ${chunk.pageContent}`).join('\n\n');
        const systemMessage = this.options.systemMessage ?? DEFAULT_SYSTEM_MESSAGE;
        const answer = await this.options.llm.complete([
            { role: 'system', content: systemMessage },
            {
                role: 'user',
                content: `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer the question using the context above. Use [n] citations.`,
            },
        ]);

        return { answer, mode: 'llm', sources, chunks };
    }

    async getChunkCount(): Promise<number> {
        return this.store.count();
    }

    async deleteLoader(loaderId: string): Promise<boolean> {
        this.seenLoaders.delete(loaderId);
        return this.store.deleteByLoader(loaderId);
    }

    async reset(): Promise<void> {
        this.seenLoaders.clear();
        return this.store.reset();
    }
}

/** Map retrieved chunks to numbered citation sources. */
export function buildSources(chunks: ScoredChunk[]): Source[] {
    return chunks.map((chunk, i) => {
        const url = typeof chunk.metadata.url === 'string' ? chunk.metadata.url : undefined;
        const label = typeof chunk.metadata.source === 'string' ? chunk.metadata.source : `chunk ${i + 1}`;
        return {
            id: i + 1,
            label,
            url,
            loader: typeof chunk.metadata.type === 'string' ? chunk.metadata.type : undefined,
        };
    });
}
