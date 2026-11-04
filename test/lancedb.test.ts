import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LanceDBStore, ZeroRAG } from '../src/index.js';
import { FakeEmbedder } from './fakes.js';

describe('LanceDBStore (real embedded database)', () => {
    let dir: string;
    let rag: ZeroRAG;
    let store: LanceDBStore;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'zerorag-test-'));
        store = new LanceDBStore({ path: dir });
        rag = await ZeroRAG.create({ embedder: new FakeEmbedder(), store, topK: 3 });
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('persists chunks and finds them by vector search', async () => {
        await rag.addText('Cats are small domesticated felines that purr.', { source: 'cats.md' });
        await rag.addText('Diesel engines compress air before injecting fuel.', {
            source: 'engines.md',
        });

        expect(await rag.getChunkCount()).toBe(2);

        const hits = await rag.search('tell me about cats');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0]?.pageContent).toContain('Cats');
        expect(hits[0]?.score).toBeGreaterThan(0.1);
    });

    it('supports hybrid search (vector + full-text)', async () => {
        await rag.addText('Kubernetes orchestrates containers across a cluster.', {
            source: 'k8s.md',
        });
        await rag.addText('Sourdough bread requires a starter culture of flour and water.', {
            source: 'bread.md',
        });

        // hybridSearch exists on LanceDBStore and is used by ZeroRAG.search
        expect(typeof store.hybridSearch).toBe('function');
        const queryVector = await new FakeEmbedder().embedQuery('kubernetes cluster');
        const results = await store.hybridSearch('kubernetes cluster', queryVector, 3);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]?.pageContent).toContain('Kubernetes');
    });

    it('reopens an existing database directory', async () => {
        await rag.addText('Persistent knowledge that survives reopen.', { source: 'p.md' });

        const store2 = new LanceDBStore({ path: dir });
        const rag2 = await ZeroRAG.create({ embedder: new FakeEmbedder(), store: store2 });
        expect(await rag2.getChunkCount()).toBe(1);
        const hits = await rag2.search('persistent knowledge');
        expect(hits[0]?.pageContent).toContain('Persistent');
    });

    it('does not duplicate chunks when re-ingesting after a restart', async () => {
        await rag.addText('Seeded once, never duplicated on reopen.', { source: 'seed.md' });
        expect(await rag.getChunkCount()).toBe(1);

        const store2 = new LanceDBStore({ path: dir });
        const rag2 = await ZeroRAG.create({ embedder: new FakeEmbedder(), store: store2 });
        const again = await rag2.addText('Seeded once, never duplicated on reopen.', {
            source: 'seed.md',
        });
        expect(again.chunksAdded).toBe(0);
        expect(await rag2.getChunkCount()).toBe(1);

        const forced = await rag2.addText('Seeded once, never duplicated on reopen.', {
            source: 'seed.md',
            force: true,
        });
        expect(forced.chunksAdded).toBeGreaterThan(0);
        expect(await rag2.getChunkCount()).toBe(forced.chunksAdded);
    });

    it('deletes by loader and resets', async () => {
        const { loaderId } = await rag.addText('Temporary facts about zebras.', { source: 'z.md' });
        expect(await rag.getChunkCount()).toBe(1);

        await store.deleteByLoader(loaderId);
        expect(await rag.getChunkCount()).toBe(0);

        await rag.addText('More content after delete.', { source: 'm.md' });
        await rag.reset();
        expect(await rag.getChunkCount()).toBe(0);
    });

    it('rejects vectors with wrong dimensions', async () => {
        await expect(
            store.add([
                {
                    pageContent: 'bad',
                    vector: [1, 2, 3],
                    metadata: { id: 'bad_0', loaderId: 'bad' },
                },
            ]),
        ).rejects.toThrow();
    });
});
