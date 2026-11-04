import { describe, expect, it, vi } from 'vitest';

import { RssProvider, WikipediaProvider } from '../src/index.js';

const SAMPLE_SEARCH_JSON = {
    query: {
        search: [
            {
                title: 'Aurora (astronomy)',
                snippet: 'An <span class="searchmatch">aurora</span> is a natural light display.',
            },
            {
                title: 'Aurora Borealis',
                snippet: 'The <b>aurora</b> borealis occurs near the poles.',
            },
        ],
    },
};

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Tech Feed</title>
  <item>
    <title>Aurora detected over Norway</title>
    <link>https://news.example.com/aurora-norway</link>
    <description>&lt;p&gt;Skywatchers saw &lt;b&gt;brilliant&lt;/b&gt; auroras last night.&lt;/p&gt;</description>
    <pubDate>Mon, 03 Nov 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Unrelated football result</title>
    <link>https://news.example.com/football</link>
    <description>The match ended in a draw.</description>
    <pubDate>Tue, 04 Nov 2026 09:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Aurora watch issued</title>
    <link>https://news.example.com/aurora-watch</link>
    <description>New aurora watch for northern regions.</description>
    <pubDate>Wed, 05 Nov 2026 08:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

describe('WikipediaProvider (mocked fetch)', () => {
    it('maps MediaWiki search results to SearchResult', async () => {
        const fetchImpl = vi.fn(
            async () => new Response(JSON.stringify(SAMPLE_SEARCH_JSON), { status: 200 }),
        );
        const wp = new WikipediaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

        const results = await wp.search('aurora', { maxResults: 2 });
        expect(results).toHaveLength(2);
        expect(results[0]?.title).toBe('Aurora (astronomy)');
        expect(results[0]?.url).toContain('en.wikipedia.org/wiki/');
        expect(results[0]?.snippet).toContain('natural light display');
        expect(results[0]?.provider).toBe('wikipedia');
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('throws on HTTP errors', async () => {
        const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
        const wp = new WikipediaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
        await expect(wp.search('x')).rejects.toThrow('Wikipedia search failed');
    });
});

describe('RssProvider (mocked fetch)', () => {
    it('parses RSS items, ranks by query relevance, includes dates', async () => {
        const fetchImpl = vi.fn(async () => new Response(SAMPLE_RSS, { status: 200 }));
        const rss = new RssProvider(['https://feeds.example.com/tech.xml'], {
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        const results = await rss.search('aurora norway', { maxResults: 5 });
        expect(results.length).toBe(3);
        // Both aurora items outrank the unrelated football item
        expect(results[results.length - 1]?.title).toBe('Unrelated football result');
        expect(results[0]?.title).toContain('Aurora');
        expect(results[0]?.url).toBe('https://news.example.com/aurora-norway');
        expect(results[0]?.date).toBeDefined();
        expect(results[0]?.provider).toContain('rss:');
        // HTML in descriptions is converted to text
        expect(results[0]?.snippet).toContain('brilliant');
        expect(results[0]?.snippet).not.toContain('<b>');
    });

    it('survives unreachable feeds (returns empty, no throw)', async () => {
        const fetchImpl = vi.fn(async () => {
            throw new Error('network down');
        });
        const rss = new RssProvider(['https://dead.example.com/feed'], {
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        await expect(rss.search('anything')).resolves.toEqual([]);
    });

    it('requires at least one feed URL', () => {
        expect(() => new RssProvider([])).toThrow();
    });
});
