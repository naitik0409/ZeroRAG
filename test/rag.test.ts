import { describe, expect, it } from 'vitest';

import { MemoryStore, ZeroRAG } from '../src/index.js';
import { FakeEmbedder, FakeLLM } from './fakes.js';

describe('ZeroRAG pipeline (MemoryStore, zero keys)', () => {
    async function makeRag(llm?: FakeLLM) {
        return ZeroRAG.create({
            embedder: new FakeEmbedder(),
            store: new MemoryStore(),
            ...(llm ? { llm } : {}),
            topK: 3,
        });
    }

    it('ingests text and retrieves the relevant chunk', async () => {
        const rag = await makeRag();
        await rag.addText(
            'TypeScript is a typed superset of JavaScript that compiles to plain JS.',
            {
                source: 'ts.md',
            },
        );
        await rag.addText('Bananas are yellow fruits rich in potassium.', { source: 'fruit.md' });

        const hits = await rag.search('What is TypeScript?');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0]?.pageContent).toContain('TypeScript');
        expect(hits[0]?.metadata.source).toBe('ts.md');
        expect(hits[0]?.score).toBeGreaterThan(0);
    });

    it('answers in extractive mode with sources when no LLM is configured', async () => {
        const rag = await makeRag();
        await rag.addText('The Eiffel Tower is located in Paris and was completed in 1889.', {
            source: 'paris.md',
        });

        const result = await rag.ask('Where is the Eiffel Tower?');
        expect(result.mode).toBe('extractive');
        expect(result.answer.length).toBeGreaterThan(0);
        expect(result.answer).toContain('Eiffel Tower');
        expect(result.sources.length).toBeGreaterThan(0);
        expect(result.sources[0]?.id).toBe(1);
        expect(result.sources[0]?.label).toBe('paris.md');
        expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('answers through the LLM adapter when configured', async () => {
        const llm = new FakeLLM();
        const rag = await makeRag(llm);
        await rag.addText('Node.js is an asynchronous event-driven JavaScript runtime.', {
            source: 'node.md',
        });

        const result = await rag.ask('What is Node.js?');
        expect(result.mode).toBe('llm');
        expect(result.answer).toContain('FAKE ANSWER');
        expect(llm.lastMessages).not.toBeNull();
        expect(llm.lastMessages?.[0]?.role).toBe('system');
        expect(llm.lastMessages?.[1]?.content).toContain('[1]');
        expect(llm.lastMessages?.[1]?.content).toContain('What is Node.js?');
    });

    it('counts chunks, deletes by loader, and resets', async () => {
        const rag = await makeRag();
        const { loaderId, chunksAdded } = await rag.addText(
            'Alpha beta gamma. Delta epsilon zeta.',
            {
                source: 'a.md',
            },
        );
        expect(chunksAdded).toBeGreaterThan(0);
        expect(await rag.getChunkCount()).toBe(chunksAdded);

        expect(await rag.deleteLoader(loaderId)).toBe(true);
        expect(await rag.getChunkCount()).toBe(0);

        await rag.addText('Something else entirely.', { source: 'b.md' });
        await rag.reset();
        expect(await rag.getChunkCount()).toBe(0);
    });

    it('deduplicates identical text via loader ids', async () => {
        const rag = await makeRag();
        const first = await rag.addText('Identical content for dedupe test.', { source: 'x.md' });
        const second = await rag.addText('Identical content for dedupe test.', { source: 'x.md' });
        expect(second.loaderId).toBe(first.loaderId);
        expect(await rag.getChunkCount()).toBe(first.chunksAdded);
    });

    it('deduplicates across instances sharing a store (restart simulation)', async () => {
        const store = new MemoryStore();
        const rag1 = await ZeroRAG.create({ embedder: new FakeEmbedder(), store });
        const first = await rag1.addText('Durable content that should not duplicate.', {
            source: 'd.md',
        });

        // new instance = fresh seenLoaders set, same underlying store
        const rag2 = await ZeroRAG.create({ embedder: new FakeEmbedder(), store });
        const second = await rag2.addText('Durable content that should not duplicate.', {
            source: 'd.md',
        });
        expect(second.chunksAdded).toBe(0);
        expect(await rag2.getChunkCount()).toBe(first.chunksAdded);

        // force re-ingests without duplicating
        const forced = await rag2.addText('Durable content that should not duplicate.', {
            source: 'd.md',
            force: true,
        });
        expect(forced.chunksAdded).toBeGreaterThan(0);
        expect(await rag2.getChunkCount()).toBe(first.chunksAdded);
    });
});
