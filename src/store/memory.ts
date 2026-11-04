import type { VectorStore } from '../interfaces.js';
import type { InsertChunk, ScoredChunk } from '../types.js';
import { cosineSimilarity } from '../util/text.js';

interface MemoryRow {
    chunk: InsertChunk;
}

/** In-memory vector store — zero setup, ideal for tests and small datasets. */
export class MemoryStore implements VectorStore {
    private rows: MemoryRow[] = [];
    private dimensions = 0;

    async init(opts: { dimensions: number }): Promise<void> {
        this.dimensions = opts.dimensions;
    }

    async add(chunks: InsertChunk[]): Promise<number> {
        for (const chunk of chunks) {
            if (chunk.vector.length !== this.dimensions && this.dimensions > 0) {
                throw new Error(
                    `Vector dimension mismatch: expected ${this.dimensions}, got ${chunk.vector.length}`,
                );
            }
            this.rows.push({ chunk });
        }
        return chunks.length;
    }

    private toScored(row: MemoryRow, score: number): ScoredChunk {
        const { vector: _vector, ...rest } = row.chunk;
        return { ...rest, score };
    }

    async search(query: number[], k: number): Promise<ScoredChunk[]> {
        return this.rows
            .map((row) => this.toScored(row, cosineSimilarity(query, row.chunk.vector)))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
    }

    /** Lexical bag-of-words fallback used as the text half when no hybrid store is present. */
    async hybridSearch(query: string, queryVector: number[], k: number): Promise<ScoredChunk[]> {
        const vectorHits = await this.search(queryVector, k * 3);
        const queryTokens = new Set(
            query
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(Boolean),
        );
        const lexicalHits = this.rows
            .map((row) => {
                const tokens = row.chunk.pageContent.toLowerCase().split(/[^a-z0-9]+/);
                let overlap = 0;
                for (const t of tokens) if (queryTokens.has(t)) overlap++;
                return this.toScored(row, queryTokens.size > 0 ? overlap / queryTokens.size : 0);
            })
            .filter((c) => c.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, k * 3);

        return rrfFusion([vectorHits, lexicalHits], k);
    }

    async count(): Promise<number> {
        return this.rows.length;
    }

    async deleteByLoader(loaderId: string): Promise<boolean> {
        const before = this.rows.length;
        this.rows = this.rows.filter((row) => row.chunk.metadata.loaderId !== loaderId);
        return this.rows.length !== before;
    }

    async reset(): Promise<void> {
        this.rows = [];
    }
}

/** Reciprocal Rank Fusion over ranked lists. */
export function rrfFusion(lists: ScoredChunk[][], k: number, rrfK = 60): ScoredChunk[] {
    const fused = new Map<string, ScoredChunk & { rrfScore: number }>();

    for (const list of lists) {
        list.forEach((chunk, rank) => {
            const key = String(chunk.metadata.id ?? `${chunk.metadata.source}#${chunk.pageContent.slice(0, 64)}`);
            const add = 1 / (rrfK + rank + 1);
            const existing = fused.get(key);
            if (existing) {
                existing.rrfScore += add;
                if (chunk.score > existing.score) existing.score = chunk.score;
            } else {
                fused.set(key, { ...chunk, rrfScore: add });
            }
        });
    }

    return [...fused.values()]
        .sort((a, b) => b.rrfScore - a.rrfScore)
        .slice(0, k)
        .map(({ rrfScore: _rrf, ...chunk }) => chunk);
}
