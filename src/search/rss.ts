import { XMLParser } from 'fast-xml-parser';

import type { SearchProvider } from '../interfaces.js';
import type { SearchResult } from '../types.js';
import { decodeEntities, htmlToText } from '../util/html.js';
import { tokenize } from '../util/text.js';

export interface RssOptions {
    fetchImpl?: typeof fetch;
    /** Max items read per feed. Default 30 */
    maxItemsPerFeed?: number;
}

interface FeedItem {
    title: string;
    url: string;
    snippet: string;
    date?: string;
    time: number;
    relevance: number;
    provider: string;
}

const USER_AGENT = 'zerorag/0.1 (keyless rss search provider)';

function asArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function pickText(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (typeof obj['#text'] === 'string') return obj['#text'];
    }
    return '';
}

function pickLink(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        for (const entry of value) {
            const href = pickLink(entry);
            if (href) return href;
        }
        return '';
    }
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (typeof obj['@_href'] === 'string') return obj['@_href'];
        if (typeof obj.href === 'string') return obj.href;
        if (typeof obj['#text'] === 'string') return obj['#text'];
    }
    return '';
}

/**
 * Keyless freshness source: fetch RSS/Atom feeds and rank items against the
 * query (keyword overlap, recency as tiebreaker). Pass Google News RSS feeds
 * for excellent free news coverage, e.g.
 * https://news.google.com/rss/search?q=...
 */
export class RssProvider implements SearchProvider {
    readonly name = 'rss';
    private readonly fetchImpl: typeof fetch;

    constructor(
        private readonly feedUrls: string[],
        private readonly options: RssOptions = {},
    ) {
        if (feedUrls.length === 0) throw new Error('RssProvider requires at least one feed URL');
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    async search(query: string, opts: { maxResults?: number } = {}): Promise<SearchResult[]> {
        const maxResults = opts.maxResults ?? 8;
        const queryTokens = tokenize(query);
        const items: FeedItem[] = [];

        await Promise.all(
            this.feedUrls.map(async (feedUrl) => {
                try {
                    const res = await this.fetchImpl(feedUrl, {
                        headers: {
                            'user-agent': USER_AGENT,
                            accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
                        },
                        signal: AbortSignal.timeout(10_000),
                    });
                    if (!res.ok) return;
                    const xml = await res.text();
                    items.push(...this.parseFeed(xml, feedUrl, queryTokens));
                } catch {
                    // Skip unreachable feeds — resilience over strictness
                }
            }),
        );

        return items
            .sort((a, b) => b.relevance - a.relevance || b.time - a.time)
            .slice(0, maxResults)
            .map(({ relevance: _r, time: _t, provider, ...result }) => ({
                ...result,
                provider,
            }));
    }

    private parseFeed(xml: string, feedUrl: string, queryTokens: string[]): FeedItem[] {
        const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
        const doc = parser.parse(xml) as Record<string, unknown>;

        const rssChannel = (doc.rss as Record<string, unknown> | undefined)?.channel as
            | Record<string, unknown>
            | undefined;
        const atomFeed = doc.feed as Record<string, unknown> | undefined;
        const maxItems = this.options.maxItemsPerFeed ?? 30;
        const rawItems = asArray(
            (rssChannel?.item as unknown | unknown[]) ??
                (atomFeed?.entry as unknown | unknown[]) ??
                [],
        ).slice(0, maxItems) as Record<string, unknown>[];

        const feedHost = safeHost(feedUrl);
        const items: FeedItem[] = [];

        for (const raw of rawItems) {
            const title = decodeEntities(pickText(raw?.title)).trim();
            const url = pickLink(raw?.link ?? raw?.guid ?? raw?.id);
            const description = decodeEntities(
                pickText(raw?.description ?? raw?.summary ?? raw?.content),
            );
            if (!title && !description) continue;

            const dateRaw = pickText(
                raw?.pubDate ?? raw?.published ?? raw?.updated ?? raw?.['dc:date'],
            );
            const time = dateRaw ? Date.parse(dateRaw) : Number.NaN;

            const haystack = `${title} ${description}`.toLowerCase();
            const overlap =
                queryTokens.length > 0
                    ? queryTokens.filter((t) => haystack.includes(t)).length / queryTokens.length
                    : 0;

            items.push({
                title: title || url,
                url,
                snippet: htmlToText(description).slice(0, 500),
                date: Number.isFinite(time) ? new Date(time).toISOString() : undefined,
                time: Number.isFinite(time) ? time : 0,
                relevance: overlap,
                provider: `rss:${feedHost}`,
            });
        }

        for (const item of items) item.url = item.url || feedUrl;
        return items;
    }
}

function safeHost(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return 'feed';
    }
}
