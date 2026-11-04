import { describe, expect, it, vi } from 'vitest';

import type { SearchProvider, SearchResult } from '../src/index.js';
import { fuseResults, LiveSearch, normalizeUrl } from '../src/index.js';

function result(url: string, title: string, provider = 'fake'): SearchResult {
    return { title, url, snippet: `about ${title}`, provider };
}

function provider(
    name: string,
    impl: (query: string) => Promise<SearchResult[]> | SearchResult[],
): SearchProvider & { calls: number } {
    const p = {
        name,
        calls: 0,
        async search(query: string): Promise<SearchResult[]> {
            p.calls += 1;
            return impl(query);
        },
    };
    return p;
}

describe('normalizeUrl', () => {
    it('strips fragments, www, utm params, and trailing slashes', () => {
        expect(
            normalizeUrl('https://www.example.com/a/?utm_source=x&utm_medium=y&fbclid=1#frag'),
        ).toBe('https://example.com/a');
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('keeps meaningful query params in original order', () => {
        expect(normalizeUrl('https://example.com/s?q=hello&page=2')).toBe(
            'https://example.com/s?q=hello&page=2',
        );
    });

    it('returns the input for unparseable URLs', () => {
        expect(normalizeUrl('not a url')).toBe('not a url');
    });
});

describe('fuseResults (RRF)', () => {
    it('merges duplicate URLs across providers and ranks by fused score', () => {
        const a = [
            result('https://example.com/x', 'X from A', 'alpha'),
            result('https://a.com/1', 'A1', 'alpha'),
        ];
        const b = [
            result('https://www.example.com/x/', 'X from B', 'beta'),
            result('https://b.com/2', 'B1', 'beta'),
        ];

        const fused = fuseResults([a, b], 10);
        expect(fused).toHaveLength(3);
        expect(fused[0]?.url).toContain('example.com/x');
        // top item appeared in both lists → higher RRF score
        const scores = fuseResults([a, b], 10);
        expect(scores[0]).toBeDefined();
    });

    it('respects the k limit', () => {
        const list = Array.from({ length: 20 }, (_, i) => result(`https://e.com/${i}`, `t${i}`));
        expect(fuseResults([list], 5)).toHaveLength(5);
    });
});

describe('LiveSearch', () => {
    it('fans out to all providers and fuses', async () => {
        const p1 = provider('p1', () => [result('https://one.com/', 'One')]);
        const p2 = provider('p2', () => [result('https://two.com/', 'Two')]);
        const live = new LiveSearch({ providers: [p1, p2] });

        const results = await live.search('hello');
        expect(results).toHaveLength(2);
        expect(p1.calls).toBe(1);
        expect(p2.calls).toBe(1);
    });

    it('caches results within the TTL', async () => {
        const p = provider('cacheable', () => [result('https://c.com/', 'C')]);
        const live = new LiveSearch({ providers: [p], cacheTtlMs: 60_000 });

        await live.search('q1');
        await live.search('q1');
        expect(p.calls).toBe(1);

        await live.search('q2');
        expect(p.calls).toBe(2);
    });

    it('skips failed providers but still returns results from healthy ones', async () => {
        const good = provider('good', () => [result('https://good.com/', 'Good')]);
        const bad = provider('bad', () => {
            throw new Error('boom');
        });
        const live = new LiveSearch({ providers: [good, bad] });

        const results = await live.search('q');
        expect(results).toHaveLength(1);
        expect(results[0]?.url).toBe('https://good.com/');
    });

    it('opens the circuit after consecutive failures', async () => {
        let fail = true;
        const flaky = provider('flaky', () => {
            if (fail) throw new Error('down');
            return [result('https://back.com/', 'Back')];
        });
        const healthy = provider('healthy', () => [result('https://ok.com/', 'Ok')]);
        const live = new LiveSearch({
            providers: [flaky, healthy],
            breakerThreshold: 2,
            breakerCooldownMs: 60_000,
        });

        await live.search('q'); // flaky fails once
        await live.search('q'); // flaky fails twice → circuit opens
        const callsAfterOpen = flaky.calls;
        await live.search('q');

        // circuit open → provider not called a third time
        expect(flaky.calls).toBe(callsAfterOpen);
        // healthy provider keeps serving
        fail = false;
        const results = await live.search('q');
        expect(results.some((r) => r.url === 'https://ok.com/')).toBe(true);
    });

    it('throws when every provider fails and there is no cache', async () => {
        const bad1 = provider('bad1', () => {
            throw new Error('e1');
        });
        const bad2 = provider('bad2', () => {
            throw new Error('e2');
        });
        const live = new LiveSearch({ providers: [bad1, bad2] });
        await expect(live.search('q')).rejects.toThrow();
    });

    it('fetchPage extracts readable text from HTML', async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(
                    '<html><head><title>Page T</title><script>x()</script></head><body><h1>Head</h1><p>Body text &amp; more.</p></body></html>',
                    {
                        headers: { 'content-type': 'text/html' },
                    },
                ),
        );
        const live = new LiveSearch({
            providers: [],
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        const page = await live.fetchPage('https://example.com/article');
        expect(page.title).toBe('Page T');
        expect(page.text).toContain('Head');
        expect(page.text).toContain('Body text & more.');
        expect(page.text).not.toContain('x()');
    });

    it('searchWithPages returns results plus extracted pages', async () => {
        const p = provider('p', () => [result('https://page.com/', 'P')]);
        const fetchImpl = vi.fn(
            async () =>
                new Response('<html><body><p>extracted content</p></body></html>', {
                    headers: { 'content-type': 'text/html' },
                }),
        );
        const live = new LiveSearch({
            providers: [p],
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        const { results, pages } = await live.searchWithPages('q', { maxPages: 1 });
        expect(results).toHaveLength(1);
        expect(pages).toHaveLength(1);
        expect(pages[0]?.text).toContain('extracted content');
    });
});
