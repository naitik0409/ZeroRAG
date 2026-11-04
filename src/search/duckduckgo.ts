import { search as ddgSearch, SafeSearchType, SearchTimeType, searchNews } from 'duck-duck-scrape';

import type { SearchProvider } from '../interfaces.js';
import type { SearchResult } from '../types.js';

export interface DuckDuckGoOptions {
    safeSearch?: SafeSearchType;
    /** Minimum ms between outbound DDG calls (rate-limit guard). Default 800 */
    minIntervalMs?: number;
}

function stripBold(text: string): string {
    return text.replace(/<\/?b>/gi, '').trim();
}

function daysToTimeType(days: number): SearchTimeType {
    if (days <= 1) return SearchTimeType.DAY;
    if (days <= 7) return SearchTimeType.WEEK;
    if (days <= 30) return SearchTimeType.MONTH;
    return SearchTimeType.YEAR;
}

export interface LiveSearchOptions_ {
    maxResults?: number;
    /** Restrict to results from the last N days (maps to DDG time filter) */
    freshWithinDays?: number;
}

/**
 * Keyless DuckDuckGo provider (web + news). No API key, no signup.
 * Includes a per-instance rate-limit guard — DDG throttles aggressive callers.
 */
export class DuckDuckGoProvider implements SearchProvider {
    readonly name = 'duckduckgo';
    private lastCallAt = 0;

    constructor(private readonly options: DuckDuckGoOptions = {}) {}

    private async throttle(): Promise<void> {
        const min = this.options.minIntervalMs ?? 800;
        const wait = this.lastCallAt + min - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        this.lastCallAt = Date.now();
    }

    async search(query: string, opts: LiveSearchOptions_ = {}): Promise<SearchResult[]> {
        await this.throttle();
        const result = await ddgSearch(query, {
            safeSearch: this.options.safeSearch ?? SafeSearchType.MODERATE,
            ...(opts.freshWithinDays ? { time: daysToTimeType(opts.freshWithinDays) } : {}),
        });

        return result.results.slice(0, opts.maxResults ?? 8).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: stripBold(r.description),
            provider: this.name,
        }));
    }

    /** News search with publication dates — the freshness workhorse. */
    async searchNews(
        query: string,
        opts: { maxResults?: number; freshWithinDays?: number } = {},
    ): Promise<SearchResult[]> {
        await this.throttle();
        const result = await searchNews(query, {
            ...(opts.freshWithinDays ? { time: daysToTimeType(opts.freshWithinDays) } : {}),
        });

        return result.results.slice(0, opts.maxResults ?? 8).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.excerpt,
            date: Number.isFinite(r.date) ? new Date(r.date).toISOString() : undefined,
            provider: `${this.name}:news`,
        }));
    }
}
