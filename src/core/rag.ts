import { FastEmbedProvider } from '../embeddings/fastembed.js';
import type { EmbeddingProvider, LLMAdapter, Loader, VectorStore } from '../interfaces.js';
import { FileLoader } from '../loaders/file.js';
import { TextLoader } from '../loaders/text.js';
import { LiveSearch, type LiveSearchConfig } from '../search/live.js';
import { LanceDBStore } from '../store/lancedb.js';
import type {
    AskResult,
    Chunk,
    InsertChunk,
    LoaderResult,
    ScoredChunk,
    SearchResult,
    Source,
} from '../types.js';
import { extractiveAnswer } from './extractive.js';

export interface ZeroRAGOptions {
    /** Embedding provider. Default: local FastEmbedProvider (bge-small, ONNX, no API key) */
    embedder?: EmbeddingProvider;
    /** Vector store. Default: embedded LanceDB at ./.zerorag */
    store?: VectorStore;
    /** Bring-your-own LLM. When omitted, ask() runs in extractive (zero-LLM) mode. */
    llm?: LLMAdapter;
    /**
     * Enable keyless realtime web search. `true` = default providers
     * (DuckDuckGo + Wikipedia); an object = custom LiveSearchConfig.
     */
    live?: boolean | LiveSearchConfig;
    chunkSize?: number;
    chunkOverlap?: number;
    topK?: number;
    systemMessage?: string;
    maxExtractiveSentences?: number;
}

export interface AskLiveOptions {
    /** Fetch live web results and merge them into context. Default: false */
    live?: boolean;
    /** Max live web results to pull. Default: 5 */
    maxLiveResults?: number;
    /** Max live pages to fetch and extract for grounding. Default: 3 */
    maxLivePages?: number;
    /** Restrict live results to the last N days (freshness). */
    freshWithinDays?: number;
    maxSentences?: number;
}

const DEFAULT_SYSTEM_MESSAGE =
    'You are a helpful assistant. Answer the question using only the provided context. ' +
    'If the context does not contain the answer, say that you do not know. ' +
    'Cite supporting sources inline using [n] markers.';

const INSERT_BATCH_SIZE = 64;

export class ZeroRAG {
    private readonly seenLoaders = new Set<string>();
    private readonly liveSearch: LiveSearch | null;

    private constructor(
        private readonly embedder: EmbeddingProvider,
        private readonly store: VectorStore,
        private readonly options: ZeroRAGOptions,
        liveSearch: LiveSearch | null,
    ) {
        this.liveSearch = liveSearch;
    }

    /** Create and initialize a RAG instance with free, local defaults. */
    static async create(options: ZeroRAGOptions = {}): Promise<ZeroRAG> {
        const embedder = options.embedder ?? new FastEmbedProvider();
        await embedder.init?.();
        const dimensions = await embedder.getDimensions();

        const store = options.store ?? new LanceDBStore();
        await store.init({ dimensions });

        const liveSearch = options.live
            ? new LiveSearch(typeof options.live === 'object' ? options.live : {})
            : null;

        return new ZeroRAG(embedder, store, options, liveSearch);
    }

    async addText(
        text: string,
        opts: { source?: string; metadata?: Record<string, unknown>; force?: boolean } = {},
    ): Promise<LoaderResult> {
        const loader = new TextLoader(text, {
            source: opts.source,
            metadata: opts.metadata,
            chunkSize: this.options.chunkSize,
            chunkOverlap: this.options.chunkOverlap,
        });
        return this.addLoader(loader, opts.force ?? false);
    }

    async addFile(
        path: string,
        opts: { extensions?: string[]; metadata?: Record<string, unknown>; force?: boolean } = {},
    ): Promise<LoaderResult> {
        const loader = new FileLoader(path, {
            extensions: opts.extensions,
            metadata: opts.metadata,
            chunkSize: this.options.chunkSize,
            chunkOverlap: this.options.chunkOverlap,
        });
        return this.addLoader(loader, opts.force ?? false);
    }

    async addLoader(loader: Loader, force = false): Promise<LoaderResult> {
        const loaderId = loader.getUniqueId();
        if (force) {
            // re-ingest: drop any existing copy first so chunks never duplicate
            await this.store.deleteByLoader(loaderId);
            this.seenLoaders.delete(loaderId);
        } else if (this.seenLoaders.has(loaderId)) {
            return { loaderId, chunksAdded: 0 };
        } else if (await this.store.hasLoader?.(loaderId)) {
            // persistent store already holds this loader from a previous process
            this.seenLoaders.add(loaderId);
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

    /** Search the live web (keyless sources). Requires `live` at create() — or auto-enables defaults. */
    async searchLive(
        query: string,
        opts: { maxResults?: number; freshWithinDays?: number } = {},
    ): Promise<SearchResult[]> {
        const live = this.liveSearch ?? new LiveSearch();
        return live.search(query, opts);
    }

    /**
     * Answer a question. Uses the configured LLM adapter when present,
     * otherwise falls back to zero-LLM extractive answering.
     * Pass `{ live: true }` to ground the answer in fresh web results too.
     */
    async ask(query: string, opts: AskLiveOptions = {}): Promise<AskResult> {
        const chunks = await this.search(query);

        // Realtime grounding: prepend fresh web pages as high-priority context
        if (opts.live && this.liveSearch) {
            try {
                const liveChunks = await this.fetchLiveChunks(query, opts);
                chunks.unshift(...liveChunks);
            } catch {
                // Live layer is best-effort — degrade to index-only answers
            }
        }

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

    /**
     * Pull live web results, extract the top pages, and return them as
     * ScoredChunks ranked above index results (fresh content wins).
     */
    private async fetchLiveChunks(query: string, opts: AskLiveOptions): Promise<ScoredChunk[]> {
        const live = this.liveSearch;
        if (!live) return [];

        const results = await live.search(query, {
            maxResults: opts.maxLiveResults ?? 5,
            freshWithinDays: opts.freshWithinDays,
        });
        const pages = await Promise.all(
            results
                .slice(0, opts.maxLivePages ?? 3)
                .map((url) => live.fetchPage(url.url).catch(() => null)),
        );

        const chunks: ScoredChunk[] = [];
        pages.forEach((page, i) => {
            if (!page?.text) return;
            const result = results[i];
            if (!result) return;
            chunks.push({
                pageContent: page.text,
                metadata: {
                    source: page.title || result.title,
                    url: page.url,
                    type: 'live',
                    title: page.title ?? result.title,
                    provider: result.provider,
                    ...(result.date ? { date: result.date } : {}),
                },
                score: 1,
            });
        });
        return chunks;
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
        const label =
            typeof chunk.metadata.source === 'string' ? chunk.metadata.source : `chunk ${i + 1}`;
        return {
            id: i + 1,
            label,
            url,
            loader: typeof chunk.metadata.type === 'string' ? chunk.metadata.type : undefined,
        };
    });
}
