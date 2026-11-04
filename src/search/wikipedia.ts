import type { SearchProvider } from '../interfaces.js';
import type { SearchResult } from '../types.js';
import { htmlToText } from '../util/html.js';

export interface WikipediaOptions {
    /** Language subdomain. Default: en */
    lang?: string;
    fetchImpl?: typeof fetch;
}

const USER_AGENT = 'zerorag/0.1 (keyless wikipedia search provider)';

/** Keyless Wikipedia search via the public MediaWiki API. */
export class WikipediaProvider implements SearchProvider {
    readonly name = 'wikipedia';
    private readonly lang: string;
    private readonly fetchImpl: typeof fetch;

    constructor(options: WikipediaOptions = {}) {
        this.lang = options.lang ?? 'en';
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    async search(query: string, opts: { maxResults?: number } = {}): Promise<SearchResult[]> {
        const limit = Math.min(opts.maxResults ?? 5, 20);
        const url =
            `https://${this.lang}.wikipedia.org/w/api.php` +
            `?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
            `&srlimit=${limit}&format=json&origin=*`;

        const res = await this.fetchImpl(url, {
            headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Wikipedia search failed (${res.status})`);

        const data = (await res.json()) as {
            query?: { search?: { title: string; snippet: string }[] };
        };
        const hits = data.query?.search ?? [];

        return hits.map((hit) => ({
            title: hit.title,
            url: `https://${this.lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
            snippet: htmlToText(hit.snippet),
            provider: this.name,
        }));
    }
}
