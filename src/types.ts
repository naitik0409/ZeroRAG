export interface ChunkMetadata {
    id?: string;
    loaderId?: string;
    source?: string;
    type?: string;
    [key: string]: unknown;
}

export interface Chunk {
    pageContent: string;
    metadata: ChunkMetadata;
}

export interface InsertChunk extends Chunk {
    vector: number[];
}

export interface ScoredChunk extends Chunk {
    score: number;
}

export interface Source {
    /** Citation number, 1-based, matching [n] markers in answers */
    id: number;
    label: string;
    url?: string;
    loader?: string;
}

export interface AskResult {
    answer: string;
    mode: 'llm' | 'extractive';
    sources: Source[];
    chunks: ScoredChunk[];
}

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    /** ISO date if the provider knows it */
    date?: string;
    /** Provider name that produced this result */
    provider: string;
}

export interface LoaderResult {
    loaderId: string;
    chunksAdded: number;
}
