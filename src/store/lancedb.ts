import { connect, Index, type Table } from '@lancedb/lancedb';

import type { VectorStore } from '../interfaces.js';
import type { InsertChunk, ScoredChunk } from '../types.js';
import { distanceToScore } from '../util/text.js';
import { rrfFusion } from './memory.js';

export interface LanceDBStoreOptions {
    /** Directory for the embedded database. Default: `./.zerorag` */
    path?: string;
    /** Table name. Default: `documents` */
    tableName?: string;
}

/**
 * Embedded LanceDB store with native vectors (no JSON stringification),
 * cosine scoring, and hybrid vector + full-text search fused via RRF.
 */
export class LanceDBStore implements VectorStore {
    private table: Table | null = null;
    private ftsStale = false;
    private readonly path: string;
    private readonly tableName: string;

    constructor(options: LanceDBStoreOptions = {}) {
        this.path = options.path ?? './.zerorag';
        this.tableName = options.tableName ?? 'documents';
    }

    async init(opts: { dimensions: number }): Promise<void> {
        const db = await connect(this.path);
        const names = await db.tableNames();

        if (names.includes(this.tableName)) {
            this.table = await db.openTable(this.tableName);
        } else {
            // Create with a placeholder row (avoids depending on apache-arrow for a
            // schema-only create), then drop the placeholder immediately.
            this.table = await db.createTable(
                this.tableName,
                [
                    {
                        id: '__zerorag_init__',
                        pageContent: '',
                        vector: new Array<number>(opts.dimensions).fill(0),
                        loaderId: '',
                        metadata: '{}',
                    },
                ],
                { existOk: true },
            );
            await this.table.delete(`id = '__zerorag_init__'`);
        }
        this.ftsStale = false;
    }

    private requireTable(): Table {
        if (!this.table) throw new Error('LanceDBStore not initialized — call init() first');
        return this.table;
    }

    async add(chunks: InsertChunk[]): Promise<number> {
        if (chunks.length === 0) return 0;
        const table = this.requireTable();

        const rows = chunks.map((chunk) => ({
            id: String(chunk.metadata.id ?? crypto.randomUUID()),
            pageContent: chunk.pageContent,
            vector: chunk.vector,
            loaderId: String(chunk.metadata.loaderId ?? ''),
            metadata: JSON.stringify(chunk.metadata),
        }));

        await table.add(rows);
        if (rows.length > 0) this.ftsStale = true;
        return rows.length;
    }

    private toScored(row: Record<string, unknown>, score: number): ScoredChunk {
        let metadata: Record<string, unknown> = {};
        try {
            metadata = JSON.parse(String(row.metadata ?? '{}')) as Record<string, unknown>;
        } catch {
            metadata = {};
        }
        metadata.id = String(row.id ?? metadata.id ?? '');
        metadata.loaderId = String(row.loaderId ?? metadata.loaderId ?? '');
        return {
            pageContent: String(row.pageContent ?? ''),
            metadata,
            score,
        };
    }

    async search(query: number[], k: number): Promise<ScoredChunk[]> {
        const table = this.requireTable();
        const results = await table.vectorSearch(query).distanceType('cosine').limit(k).toArray();
        return results.map((row) => {
            const distance = typeof row._distance === 'number' ? row._distance : Number.NaN;
            return this.toScored(
                row as unknown as Record<string, unknown>,
                distanceToScore(distance, 'cosine'),
            );
        });
    }

    /** Ensure a full-text index exists on pageContent; rebuild when stale. */
    private async ensureFtsIndex(): Promise<boolean> {
        const table = this.requireTable();
        if (!this.ftsStale) {
            try {
                const indices = await table.listIndices();
                const hasFts = indices.some((idx) => idx.columns.includes('pageContent'));
                if (hasFts) return true;
            } catch {
                // fall through and try to create
            }
        }

        try {
            const count = await table.countRows();
            if (count === 0) return false;
            await table.createIndex('pageContent', {
                config: Index.fts(),
                replace: true,
                waitTimeoutSeconds: 120,
            });
            this.ftsStale = false;
            return true;
        } catch {
            return false;
        }
    }

    async hybridSearch(query: string, queryVector: number[], k: number): Promise<ScoredChunk[]> {
        const table = this.requireTable();
        const candidateK = Math.max(k * 3, 15);

        const vectorHits = await this.search(queryVector, candidateK);

        const ftsReady = await this.ensureFtsIndex();
        if (!ftsReady) return vectorHits.slice(0, k);

        try {
            const ftsRows = await table
                .search(query, 'fts', ['pageContent'])
                .limit(candidateK)
                .toArray();
            const ftsHits = ftsRows.map((row) =>
                this.toScored(row as unknown as Record<string, unknown>, 0),
            );
            if (ftsHits.length === 0) return vectorHits.slice(0, k);
            return rrfFusion([vectorHits, ftsHits], k);
        } catch {
            // FTS unavailable (stale/corrupt index) — degrade to vector search
            return vectorHits.slice(0, k);
        }
    }

    async count(): Promise<number> {
        return this.requireTable().countRows();
    }

    async deleteByLoader(loaderId: string): Promise<boolean> {
        const table = this.requireTable();
        const safe = loaderId.replace(/'/g, "''");
        await table.delete(`loaderId = '${safe}'`);
        this.ftsStale = true;
        return true;
    }

    async hasLoader(loaderId: string): Promise<boolean> {
        const table = this.requireTable();
        const safe = loaderId.replace(/'/g, "''");
        const rows = await table.query().where(`loaderId = '${safe}'`).limit(1).toArray();
        return rows.length > 0;
    }

    async reset(): Promise<void> {
        const table = this.requireTable();
        await table.delete('id IS NOT NULL');
        this.ftsStale = true;
    }
}
