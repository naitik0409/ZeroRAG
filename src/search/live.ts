import type { SearchProvider } from '../interfaces.js';
import type { SearchResult } from '../types.js';
import { htmlToText } from '../util/html.js';
import { DuckDuckGoProvider } from './duckduckgo.js';
import { WikipediaProvider } from './wikipedia.js';

export interface LiveSearchConfig {
    /** Providers tried (and merged) per query. Default: DuckDuckGo + Wikipedia */
    providers?: SearchProvider[];
    /** Result cache TTL in ms. Default: 5 minutes */
    cacheTtlMs?: number;
    /** Consecutive failures before a provider's circuit opens. Default: 3 */
    breakerThreshold?: number;
    /** How long an open circuit stays open, ms. Default: 60_000 */
    breakerCooldownMs?: number;
    /** Max results returned. Default: 8 */
    maxResults?: number;
    /** Page extraction cap, chars. Default: 20_000 */
    maxPageChars?: number;
    /** Page fetch timeout, ms. Default: 10_000 */
    pageTimeoutMs?: number;
    fetchImpl?: typeof fetch;
}

export interface FetchPageResult {
    url: string;
    title?: string;
    text: string;
}

const USER_AGENT = 'zerorag/0.1 (+https://github.com/zerorag/zerorag; keyless live search)';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_BREAKER_COOLDOWN_MS = 60 * 1000;

interface ProviderState {
    consecutiveFailures: number;
    openUntil: number;
}

/** Normalize URLs so the same page from different providers fuses as one. */
export function normalizeUrl(url: string): string {
    try {
        const u = new URL(url);
        u.hash = '';
        u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
        const keep = [...u.searchParams.entries()].filter(
            ([key]) => !key.startsWith('utm_') && !['fbclid', 'gclid', 'ref'].includes(key),
        );
        const clean = new URL(`${u.protocol}//${u.host}${u.pathname}`);
        for (const [key, value] of keep) clean.searchParams.append(key, value);
        let path = clean.pathname;
        if (path.endsWith('/') && path !== '/') path = path.slice(0, -1);
        return `${clean.protocol}//${clean.host}${path}${clean.search}`;
    } catch {
        return url;
    }
}

/**
 * Keyless realtime search orchestrator:
 * - multi-provider fan-out with Reciprocal Rank Fusion
 * - per-provider circuit breakers + TTL cache (resilience against flaky sources)
 * - page extraction (HTML → text) for grounding answers in fresh content
 */
export class LiveSearch {
    private readonly providers: SearchProvider[];
    private readonly cache = new Map<string, { expires: number; results: SearchResult[] }>();
    private readonly state = new Map<string, ProviderState>();
    private readonly config: Required<Omit<LiveSearchConfig, 'providers' | 'fetchImpl'>>;
    private readonly fetchImpl?: typeof fetch;

    constructor(config: LiveSearchConfig = {}) {
        this.providers = config.providers ?? [new DuckDuckGoProvider(), new WikipediaProvider()];
        this.fetchImpl = config.fetchImpl;
        this.config = {
            cacheTtlMs: config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
            breakerThreshold: config.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD,
            breakerCooldownMs: config.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS,
            maxResults: config.maxResults ?? 8,
            maxPageChars: config.maxPageChars ?? 20_000,
            pageTimeoutMs: config.pageTimeoutMs ?? 10_000,
        };
    }

    private cacheKey(query: string, freshWithinDays?: number): string {
        return `${query}::${freshWithinDays ?? 'any'}`;
    }

    private isCircuitOpen(provider: SearchProvider): boolean {
        const state = this.state.get(provider.name);
        if (!state) return false;
        if (state.openUntil > Date.now()) return true;
        if (state.openUntil > 0 && state.openUntil <= Date.now()) {
            // half-open: allow one trial
            state.consecutiveFailures = 0;
            state.openUntil = 0;
        }
        return false;
    }

    private recordFailure(provider: SearchProvider): void {
        const state = this.state.get(provider.name) ?? { consecutiveFailures: 0, openUntil: 0 };
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= this.config.breakerThreshold) {
            state.openUntil = Date.now() + this.config.breakerCooldownMs;
            state.consecutiveFailures = 0;
        }
        this.state.set(provider.name, state);
    }

    private recordSuccess(provider: SearchProvider): void {
        this.state.set(provider.name, { consecutiveFailures: 0, openUntil: 0 });
    }

    /** Search all healthy providers and fuse results (RRF by normalized URL). */
    async search(
        query: string,
        opts: { maxResults?: number; freshWithinDays?: number; useCache?: boolean } = {},
    ): Promise<SearchResult[]> {
        const key = this.cacheKey(query, opts.freshWithinDays);
        if (opts.useCache !== false) {
            const cached = this.cache.get(key);
            if (cached && cached.expires > Date.now()) return cached.results;
        }

        const settled = await Promise.allSettled(
            this.providers.map(async (provider) => {
                if (this.isCircuitOpen(provider)) {
                    throw new Error(`circuit-open: ${provider.name}`);
                }
                try {
                    const results = await provider.search(query, {
                        maxResults: this.config.maxResults,
                        freshWithinDays: opts.freshWithinDays,
                    });
                    this.recordSuccess(provider);
                    return results;
                } catch (error) {
                    this.recordFailure(provider);
                    throw error;
                }
            }),
        );

        const lists = settled
            .filter((s): s is PromiseFulfilledResult<SearchResult[]> => s.status === 'fulfilled')
            .map((s) => s.value)
            .filter((list) => list.length > 0);

        if (lists.length === 0) {
            // Total failure: serve stale cache if we have it, otherwise surface the first error
            const stale = this.cache.get(key);
            if (stale) return stale.results;
            const firstError = settled.find(
                (s): s is PromiseRejectedResult => s.status === 'rejected',
            );
            throw firstError?.reason instanceof Error
                ? firstError.reason
                : new Error('All live search providers failed');
        }

        const fused = fuseResults(lists, this.config.maxResults);
        this.cache.set(key, { expires: Date.now() + this.config.cacheTtlMs, results: fused });
        return fused;
    }

    /** Fetch a page and convert it to readable text (for grounding live answers). */
    async fetchPage(url: string): Promise<FetchPageResult> {
        const doFetch = this.fetchImpl ?? fetch;
        const res = await doFetch(url, {
            headers: {
                'user-agent': USER_AGENT,
                accept: 'text/html, application/xhtml+xml, text/plain',
            },
            signal: AbortSignal.timeout(this.config.pageTimeoutMs),
            redirect: 'follow',
        });
        if (!res.ok) throw new Error(`Page fetch failed (${res.status}) for ${url}`);

        const contentType = res.headers.get('content-type') ?? '';
        const raw = await res.text();

        if (contentType.includes('html') || /^\s*</.test(raw)) {
            const text = htmlToText(raw);
            const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            return {
                url,
                title: titleMatch?.[1]?.trim(),
                text: text.slice(0, this.config.maxPageChars),
            };
        }
        return { url, text: raw.slice(0, this.config.maxPageChars) };
    }

    /** Convenience: search + extract the top pages in one call. */
    async searchWithPages(
        query: string,
        opts: { maxResults?: number; maxPages?: number; freshWithinDays?: number } = {},
    ): Promise<{ results: SearchResult[]; pages: FetchPageResult[] }> {
        const results = await this.search(query, opts);
        const pages = await Promise.all(
            results
                .slice(0, opts.maxPages ?? 3)
                .map((r) => this.fetchPage(r.url).catch(() => null)),
        );
        return { results, pages: pages.filter((p): p is FetchPageResult => p !== null) };
    }
}

/** Reciprocal Rank Fusion across ranked result lists, keyed by normalized URL. */
export function fuseResults(lists: SearchResult[][], k: number, rrfK = 60): SearchResult[] {
    const fused = new Map<
        string,
        { result: SearchResult; rrfScore: number; providers: Set<string> }
    >();

    for (const list of lists) {
        list.forEach((result, rank) => {
            const key = normalizeUrl(result.url) || `${result.provider}:${result.title}`;
            const add = 1 / (rrfK + rank + 1);
            const existing = fused.get(key);
            if (existing) {
                existing.rrfScore += add;
                existing.providers.add(result.provider);
                // Prefer the entry that carries a date when duplicates disagree
                if (!existing.result.date && result.date) existing.result = result;
            } else {
                fused.set(key, { result, rrfScore: add, providers: new Set([result.provider]) });
            }
        });
    }

    return [...fused.values()]
        .sort((a, b) => b.rrfScore - a.rrfScore)
        .slice(0, k)
        .map(({ result }) => result);
}
