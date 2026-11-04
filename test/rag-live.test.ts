import { describe, expect, it } from 'vitest';

import type { SearchProvider, SearchResult } from '../src/index.js';
import { MemoryStore, ZeroRAG } from '../src/index.js';
import { FakeEmbedder, FakeLLM } from './fakes.js';

function liveProvider(results: SearchResult[]): SearchProvider {
    return {
        name: 'test-live',
        async search() {
            return results;
        },
    };
}

function htmlResponse(html: string): Response {
    return new Response(html, { headers: { 'content-type': 'text/html' } });
}

describe('ZeroRAG live integration', () => {
    it('searchLive returns fused web results', async () => {
        const rag = await ZeroRAG.create({
            embedder: new FakeEmbedder(),
            store: new MemoryStore(),
            live: {
                providers: [
                    liveProvider([
                        {
                            title: 'Solar storm news',
                            url: 'https://news.example.com/solar-storm',
                            snippet: 'Auroras visible further south than usual.',
                            provider: 'test-live',
                        },
                    ]),
                ],
            },
        });

        const results = await rag.searchLive('aurora news');
        expect(results).toHaveLength(1);
        expect(results[0]?.title).toBe('Solar storm news');
    });

    it('ask({live:true}) grounds the answer in fresh web pages', async () => {
        const llm = new FakeLLM();
        const rag = await ZeroRAG.create({
            embedder: new FakeEmbedder(),
            store: new MemoryStore(),
            llm,
            live: {
                providers: [
                    liveProvider([
                        {
                            title: 'Breaking: Aurora event',
                            url: 'https://news.example.com/aurora',
                            snippet: 'Live coverage',
                            provider: 'test-live',
                        },
                    ]),
                ],
                fetchImpl: (async () =>
                    htmlResponse(
                        '<html><head><title>Aurora live</title></head><body><p>Live: aurora visible over Oslo tonight at 21:00 UTC.</p></body></html>',
                    )) as unknown as typeof fetch,
            },
        });

        const result = await rag.ask('Where can I see the aurora tonight?', { live: true });
        expect(result.mode).toBe('llm');
        // live chunk is prepended at score 1 with type=live
        expect(result.chunks[0]?.metadata.type).toBe('live');
        expect(result.chunks[0]?.metadata.url).toBe('https://news.example.com/aurora');
        expect(result.chunks[0]?.pageContent).toContain('Oslo tonight');
        expect(result.sources[0]?.url).toBe('https://news.example.com/aurora');
        // LLM context includes the live page text
        expect(llm.lastMessages?.[1]?.content).toContain('Oslo tonight');
    });

    it('degrades gracefully when the live layer fails', async () => {
        const rag = await ZeroRAG.create({
            embedder: new FakeEmbedder(),
            store: new MemoryStore(),
            live: {
                providers: [
                    {
                        name: 'always-down',
                        async search() {
                            throw new Error('network down');
                        },
                    },
                ],
            },
        });
        await rag.addText('Paris is the capital of France.', { source: 'geo.md' });

        // searchLive surfaces the failure (callers may catch)...
        await expect(rag.searchLive('q')).rejects.toThrow();

        // ...but ask({live:true}) degrades to index-only instead of failing
        const result = await rag.ask('What is the capital of France?', { live: true });
        expect(result.answer).toContain('Paris');
        expect(result.chunks.some((c) => c.metadata.type === 'live')).toBe(false);
    });
});
