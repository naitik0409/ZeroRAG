# zerorag — Full Usage Guide

**A complete, practical guide to zerorag** — free realtime RAG for Node.js.

> **Developer:** Naitik ([@naitik0409](https://github.com/naitik0409)) · Report issues at [github.com/naitik0409/ZeroRAG/issues](https://github.com/naitik0409/ZeroRAG/issues)

**Table of contents**

1. [Installation](#1-installation)
2. [Concepts](#2-concepts)
3. [Quickstart](#3-quickstart)
4. [Ingesting data](#4-ingesting-data)
5. [Searching (retrieval)](#5-searching-retrieval)
6. [Asking questions (answering)](#6-asking-questions-answering)
7. [LLM adapters](#7-llm-adapters)
8. [Realtime web search](#8-realtime-web-search)
9. [Configuration reference](#9-configuration-reference)
10. [Building your own pieces](#10-building-your-own-pieces)
11. [Recipes](#11-recipes)
12. [Storage, data & performance](#12-storage-data--performance)
13. [Troubleshooting & FAQ](#13-troubleshooting--faq)
14. [API summary](#14-api-summary)

---

## 1. Installation

```bash
npm install zerorag
```

**Requirements**

|          |                                                                                             |
| -------- | ------------------------------------------------------------------------------------------- |
| Node.js  | ≥ 18 (uses global `fetch`, `AbortSignal.timeout`)                                           |
| OS       | Windows, macOS, Linux (tested on Node 18/20/22/24)                                          |
| GPU      | not needed                                                                                  |
| API keys | **none required**                                                                           |
| Network  | only for first-run model download, your LLM endpoint (optional), and live search (optional) |

On first use, zerorag downloads a small quantized embedding model (~34 MB, BGE-small) from HuggingFace into a local cache. After that everything runs offline unless you opt into live search.

---

## 2. Concepts

zerorag is a **retrieval-augmented generation pipeline with zero mandatory cloud dependencies**:

```
Documents ──► chunk ──► embed (local) ──► LanceDB (vector + full-text)
                                                  │
Question ──► embed ──► hybrid search (RRF) ◄──────┘
                     (+ optional live web search: DuckDuckGo / Wikipedia / RSS)
                                                  │
                                                  ▼
                              LLM adapter (yours)  —or—  extractive picker
                                                  │
                                                  ▼
                              answer + numbered [n] sources
```

Five swappable interfaces power everything:

| Interface           | Default implementation           | Purpose                     |
| ------------------- | -------------------------------- | --------------------------- |
| `EmbeddingProvider` | `FastEmbedProvider` (local ONNX) | text → vectors              |
| `VectorStore`       | `LanceDBStore` (embedded)        | store + hybrid search       |
| `LLMAdapter`        | _none_ (extractive fallback)     | generate answers            |
| `Loader`            | `TextLoader`, `FileLoader`       | parse documents into chunks |
| `SearchProvider`    | DuckDuckGo, Wikipedia, RSS       | realtime web results        |

**Design rules**

- Nothing requires a paid API key. LLMs are strictly bring-your-own.
- Live sources are best-effort: timeouts, circuit breakers, caches, and graceful degradation are built in.
- Everything is typed (`strict` + `noUncheckedIndexedAccess`) and ships ESM + CJS.

---

## 3. Quickstart

```ts
import { ZeroRAG } from 'zerorag';

// 1. Create — local embeddings + embedded LanceDB at ./.zerorag
const rag = await ZeroRAG.create();

// 2. Ingest
await rag.addText('TypeScript is a typed superset of JavaScript.', { source: 'ts.md' });
await rag.addFile('./docs'); // directory: ingests .md, .txt, .json, .csv, ...

// 3. Search
const hits = await rag.search('What is TypeScript?');
console.log(hits[0].pageContent, hits[0].score);

// 4. Ask (extractive mode — zero LLM, zero cost)
const { answer, sources, mode } = await rag.ask('What is TypeScript?');
console.log(mode); // 'extractive'
console.log(answer); // most relevant sentences, in original order
console.log(sources); // [{ id: 1, label: 'ts.md', ... }]
```

Run the bundled demos:

```bash
npm run example       # offline ingest → search → ask
npm run example:live  # keyless realtime web search + web-grounded answer
```

---

## 4. Ingesting data

### 4.1 Strings — `addText`

```ts
await rag.addText('Long text ...', {
    source: 'my-doc.md', // shows up in citations
    metadata: { author: 'Naitik', tags: ['guide'] }, // arbitrary, stored per chunk
});
// → { loaderId, chunksAdded }
```

### 4.2 Files and directories — `addFile`

```ts
// Single file
await rag.addFile('./README.md');

// Whole directory (recursive), default text extensions:
// .txt .md .markdown .csv .json .jsonl .log .yml .yaml
await rag.addFile('./docs');

// Custom extensions
await rag.addFile('./src', { extensions: ['.ts', '.tsx', '.js'] });
```

Metadata: `source` is set to the file path; your `metadata` is merged into every chunk.

### 4.3 Deduplication

Each loader has a stable ID (path-hash for files). Re-adding the same file is a no-op:

```ts
await rag.addFile('./docs/a.md'); // { chunksAdded: 8 }
await rag.addFile('./docs/a.md'); // { chunksAdded: 0 }  (skipped)
await rag.addFile('./docs/a.md', true); // force re-ingest (force=true on addLoader)
```

> `addText`/`addFile` don't expose `force` directly — use `addLoader(new TextLoader(...), true)`.

### 4.4 Chunking

Chunks are produced by `splitText` (LangChain recursive character splitter).

| Option         | Default | Notes                       |
| -------------- | ------- | --------------------------- |
| `chunkSize`    | `500`   | target characters per chunk |
| `chunkOverlap` | `100`   | overlap between neighbors   |

Set globally at create time (passed through `addText`/`addFile`), or per-loader:

```ts
const rag = await ZeroRAG.create({ chunkSize: 800, chunkOverlap: 120 });
```

### 4.5 Custom loaders

Implement `Loader` — an ID plus an async generator of chunks:

```ts
import type { Loader, Chunk } from 'zerorag';

class MyLoader implements Loader {
    getUniqueId() {
        return `my-${this.url}`;
    }

    async *getChunks(): AsyncGenerator<Chunk> {
        const text = await fetch(this.url).then((r) => r.text());
        yield {
            pageContent: text.slice(0, 500),
            metadata: { source: this.url, type: 'web' },
        };
    }
}

await rag.addLoader(new MyLoader('https://example.com/doc'));
```

### 4.6 Removing and resetting

```ts
const { loaderId } = await rag.addFile('./big-doc.md');
await rag.deleteLoader(loaderId); // remove its chunks
await rag.reset(); // wipe the entire store
console.log(await rag.getChunkCount());
```

---

## 5. Searching (retrieval)

```ts
const hits = await rag.search('how do webhooks work?'); // default topK = 5
const top3 = await rag.search('how do webhooks work?', 3);
```

Each hit is a `ScoredChunk`:

```ts
{
  pageContent: '...',
  score: 0.83,                       // higher = better (cosine → 0..1)
  metadata: {
    source: 'docs/webhooks.md',
    id: 'file_ab12..._7',
    loaderId: 'file_ab12...',
    // ...your metadata
  }
}
```

**How it works:** the query is embedded locally, then `LanceDBStore.hybridSearch` runs

1. **vector kNN** (cosine) over all chunks, and
2. **full-text search** (LanceDB FTS) over the same chunks,

then fuses both ranked lists with **Reciprocal Rank Fusion** (`score = Σ 1/(60+rank)`). This means exact keyword matches ("HTTP 429") _and_ semantic matches ("rate limit error") both win.

**Tuning**

- Raise `topK` at create time for broader recall (`ZeroRAG.create({ topK: 10 })`).
- For pure in-memory use (tests, demos): `store: new MemoryStore()` — vector-only search, no disk.

---

## 6. Asking questions (answering)

```ts
const result = await rag.ask('What is the SLA for refunds?');
```

`AskResult`:

```ts
{
  answer: string,
  mode: 'extractive' | 'llm',
  sources: [{ id: 1, label: 'refunds.md', url?: string, loader?: string }, ...],
  chunks: ScoredChunk[],   // exactly what was fed to the answerer
}
```

### 6.1 Extractive mode (default — zero LLM)

When no `llm` is configured, zerorag builds the answer from the retrieved text itself:

1. Split all retrieved chunks into sentences.
2. **Lexical prefilter** keeps the best ≤48 candidates (fast even for huge live pages).
3. Embed candidates locally and rank by `0.65·cosine + 0.35·lexicalOverlap`.
4. Keep sentences scoring ≥ 60% of the best score, cap at `maxSentences` (default 5).
5. Emit them **in original reading order** (coherent, quotable).

Tuning:

```ts
await rag.ask(q, { maxSentences: 8 }); // per-call length

await ZeroRAG.create({
    maxExtractiveSentences: 8, // default for all calls
});
```

Lower-level control: `extractiveAnswer(query, chunks, embedder, { semanticWeight, lexicalWeight, relativeThreshold, maxEmbedCandidates })`.

### 6.2 LLM mode

Configure any adapter (see §7) and every `ask()` goes through it with this prompt shape:

```
system: You are a helpful assistant. Answer using only the provided context...
user:   Context:
        [1] ...chunk text...
        [2] ...

        Question: ...
        Answer ... Use [n] citations.
```

Customize the system prompt:

```ts
await ZeroRAG.create({
    llm: new OllamaAdapter({ model: 'llama3.1' }),
    systemMessage: 'You are a terse support engineer. Cite [n] after every claim.',
});
```

### 6.3 Web-grounded answers

```ts
const rag = await ZeroRAG.create({ live: true });

const { answer, sources } = await rag.ask('What happened in the election today?', {
    live: true, // pull fresh web pages into context
    maxLiveResults: 5, // web results considered (default 5)
    maxLivePages: 3, // pages fetched & extracted (default 3)
    freshWithinDays: 1, // freshness filter (default: provider default)
});
```

Live chunks are **prepended at score 1.0**, so the freshest content is cited first (`sources[0].url` will be the live page). If the live layer fails, `ask()` silently degrades to index-only — it never throws for network reasons.

---

## 7. LLM adapters

zerorag ships **no model of its own**. Bring your own via `LLMAdapter`:

```ts
interface LLMAdapter {
    name: string;
    complete(messages: ChatMessage[], opts?: LLMOptions): Promise<string>;
    stream?(messages: ChatMessage[], opts?: LLMOptions): AsyncGenerator<string>;
}
```

`ChatMessage = { role: 'system'|'user'|'assistant', content: string }`
`LLMOptions = { temperature?: number, maxTokens?: number }`

### 7.1 OpenAI-compatible (OpenAI, Groq, DeepSeek, Together, vLLM, LM Studio…)

```ts
import { OpenAICompatibleAdapter } from 'zerorag';

new OpenAICompatibleAdapter({
    baseUrl: 'https://api.openai.com/v1', // required
    model: 'gpt-4o-mini', // required
    apiKey: process.env.OPENAI_API_KEY, // optional (local servers often need none)
    defaultHeaders: { 'x-custom': '1' }, // optional
    fetchImpl: myFetch, // optional, for tests
});
```

Streaming (SSE):

```ts
const stream = adapter.stream(messages);
for await (const delta of stream) process.stdout.write(delta);
```

Works unchanged against: Groq (`https://api.groq.com/openai/v1`), DeepSeek, Together, Fireworks, Ollama's `/v1`, LM Studio, llama.cpp server.

### 7.2 Ollama (fully local)

```ts
import { OllamaAdapter } from 'zerorag';

new OllamaAdapter({
    model: 'llama3.2', // required (pull it: ollama pull llama3.2)
    baseUrl: 'http://localhost:11434', // default
});
```

Streaming uses Ollama's NDJSON format. `temperature`/`maxTokens` map to Ollama's `options.temperature` / `num_predict`.

### 7.3 Anthropic (Claude)

```ts
import { AnthropicAdapter } from 'zerorag';

new AnthropicAdapter({
    apiKey: process.env.ANTHROPIC_API_KEY!, // required
    model: 'claude-sonnet-4-5', // required
    baseUrl: 'https://api.anthropic.com', // default
    anthropicVersion: '2023-06-01', // default
    maxTokens: 1024, // default (overridable per call)
});
```

System messages are extracted and sent as the top-level `system` field; streaming is SSE.

### 7.4 Google Gemini

```ts
import { GeminiAdapter } from 'zerorag';

new GeminiAdapter({
    apiKey: process.env.GEMINI_API_KEY!, // required
    model: 'gemini-2.0-flash', // required
});
```

Maps `assistant` → `model` role, `system` → `systemInstruction`. No streaming (use `complete`).

### 7.5 FunctionAdapter (any function — the escape hatch)

```ts
import { FunctionAdapter } from 'zerorag';

// Bridge to the Vercel AI SDK, LangChain, an in-house gateway, a test double...
new FunctionAdapter(async (messages, opts) => {
    const { text } = await generateText({ model: openai('gpt-4o-mini'), messages });
    return text;
});
```

### 7.6 Streaming through `ask()` — composing yourself

`ask()` is request/response. To stream, compose the pieces directly:

```ts
const chunks = await rag.search(question);
const context = chunks.map((c, i) => `[${i + 1}] ${c.pageContent}`).join('\n\n');

const stream = adapter.stream([
    { role: 'system', content: 'Answer using only the context. Cite [n].' },
    { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
]);

for await (const token of stream) process.stdout.write(token);
```

---

## 8. Realtime web search

All sources are **keyless**. Nothing to sign up for.

### 8.1 Enable it

```ts
// Defaults: DuckDuckGo (web) + Wikipedia, fused with RRF
const rag = await ZeroRAG.create({ live: true });

// Or with a full config
const rag = await ZeroRAG.create({
    live: {
        providers: [new DuckDuckGoProvider(), new WikipediaProvider()],
        cacheTtlMs: 5 * 60_000,
        breakerThreshold: 3,
        breakerCooldownMs: 60_000,
        maxResults: 8,
        providerTimeoutMs: 15_000,
        pageTimeoutMs: 10_000,
        maxPageChars: 20_000,
    },
});
```

### 8.2 Search the web

```ts
const results = await rag.searchLive('aurora forecast tonight', {
    maxResults: 6,
    freshWithinDays: 7, // DDG time filter: 1 → day, 7 → week, 30 → month
});
// [
//   { title, url, snippet, date?, provider: 'duckduckgo' | 'wikipedia' | ... },
//   ...
// ]
```

### 8.3 Answer from the web

See §6.3. TL;DR: `rag.ask(q, { live: true, freshWithinDays: 1 })`.

### 8.4 Standalone `LiveSearch`

Use the orchestrator directly — no RAG instance needed:

```ts
import { LiveSearch, DuckDuckGoProvider, WikipediaProvider, RssProvider } from 'zerorag';

const live = new LiveSearch({
    providers: [
        new DuckDuckGoProvider(),
        new WikipediaProvider({ lang: 'en' }),
        new RssProvider(['https://news.google.com/rss/search?q=space+telescope']),
    ],
});

const results = await live.search('space telescope', { maxResults: 10 });

// Search + fetch the top pages as readable text:
const { results: hits, pages } = await live.searchWithPages('space telescope', {
    maxPages: 3,
});
// pages: [{ url, title, text }, ...] — HTML stripped, entities decoded
```

### 8.5 Providers in detail

#### `DuckDuckGoProvider`

```ts
new DuckDuckGoProvider({
    safeSearch: SafeSearchType.MODERATE, // OFF | MODERATE | STRICT
    minIntervalMs: 800, // rate-limit guard between calls
});
```

- `search(query, { maxResults, freshWithinDays })` → web results.
- `searchNews(query, { maxResults, freshWithinDays })` → news results **with `date` (ISO)** — the freshness workhorse.
- All HTTP calls are bounded (10–15 s) — a slow DDG can never hang you.
- DDG occasionally rate-limits shared IPs ("anomaly detected"). zerorag treats that as a provider failure: the circuit breaker opens, other providers keep serving.

#### `WikipediaProvider`

```ts
new WikipediaProvider({ lang: 'de', fetchImpl }); // lang default 'en'
```

Uses the public MediaWiki search API. Snippets are HTML-stripped. 10 s timeout.

#### `RssProvider`

```ts
new RssProvider(
    [
        'https://news.google.com/rss/search?q=when:1d+aurora', // Google News (great free source)
        'https://hnrss.org/frontpage',
        'https://feeds.bbci.co.uk/news/world/rss.xml',
    ],
    { maxItemsPerFeed: 30 }, // optional
);
```

- Parses RSS 2.0 **and** Atom (title / link / guid, `pubDate` / `published` / `updated`).
- Ranks by **query-token overlap**, breaking ties by **recency** — so "aurora news" surfaces the freshest aurora items first.
- Each result: `{ title, url, snippet, date?, provider: 'rss:<host>' }`.
- Unreachable feeds are skipped; if _all_ fail you get `[]` (never a throw).

### 8.6 Resilience model

| Mechanism                | Default                | Behavior                                                                                     |
| ------------------------ | ---------------------- | -------------------------------------------------------------------------------------------- |
| **TTL cache**            | 5 min                  | identical queries served from memory (`useCache: false` to bypass)                           |
| **Circuit breaker**      | 3 failures → 60 s open | open providers are skipped (no wasted timeouts), half-open trial after cooldown              |
| **Per-provider timeout** | 15 s                   | one hung source can't stall the fan-out                                                      |
| **Page fetch timeout**   | 10 s                   | `AbortSignal.timeout` on every extraction                                                    |
| **RRF merge**            | `k=60`                 | duplicate URLs from different providers fuse (normalized: strips `www.`, `utm_*`, fragments) |
| **Stale-on-error**       | —                      | total provider failure → last cached result if available, else throws                        |
| **`ask()` degradation**  | —                      | live failure is swallowed; you get an index-only answer                                      |

### 8.7 Custom search provider

```ts
import type { SearchProvider, SearchResult } from 'zerorag';

class GitHubTrending implements SearchProvider {
    readonly name = 'github-trending';

    async search(query: string, opts?: { maxResults?: number; freshWithinDays?: number }) {
        // Return ranked results; throw freely — LiveSearch handles failures.
        return [{ title, url, snippet, date?, provider: this.name }];
    }
}

const live = new LiveSearch({ providers: [new GitHubTrending()] });
```

---

## 9. Configuration reference

### `ZeroRAG.create(options)`

| Option                   | Type                          | Default                                | Description              |
| ------------------------ | ----------------------------- | -------------------------------------- | ------------------------ |
| `embedder`               | `EmbeddingProvider`           | `FastEmbedProvider`                    | local BGE-small, 384-dim |
| `store`                  | `VectorStore`                 | `LanceDBStore({ path: './.zerorag' })` | embedded hybrid store    |
| `llm`                    | `LLMAdapter`                  | —                                      | omit → extractive mode   |
| `live`                   | `boolean \| LiveSearchConfig` | `false`                                | enable realtime search   |
| `chunkSize`              | `number`                      | `500`                                  | characters per chunk     |
| `chunkOverlap`           | `number`                      | `100`                                  | overlap between chunks   |
| `topK`                   | `number`                      | `5`                                    | default retrieval depth  |
| `systemMessage`          | `string`                      | helpful assistant                      | LLM system prompt        |
| `maxExtractiveSentences` | `number`                      | `5`                                    | extractive answer cap    |

### `LiveSearch` config

| Option              | Default         | Description                   |
| ------------------- | --------------- | ----------------------------- |
| `providers`         | DDG + Wikipedia | fan-out list                  |
| `cacheTtlMs`        | `300_000`       | result cache TTL              |
| `breakerThreshold`  | `3`             | failures before circuit opens |
| `breakerCooldownMs` | `60_000`        | open-circuit duration         |
| `maxResults`        | `8`             | results after fusion          |
| `providerTimeoutMs` | `15_000`        | per-provider search deadline  |
| `pageTimeoutMs`     | `10_000`        | page extraction deadline      |
| `maxPageChars`      | `20_000`        | extracted text cap            |
| `fetchImpl`         | global `fetch`  | injectable for tests          |

### `ask(query, options)`

| Option            | Default                        | Description                          |
| ----------------- | ------------------------------ | ------------------------------------ |
| `live`            | `false`                        | ground the answer in fresh web pages |
| `maxLiveResults`  | `5`                            | web results to pull                  |
| `maxLivePages`    | `3`                            | pages fetched for context            |
| `freshWithinDays` | —                              | freshness filter                     |
| `maxSentences`    | `5` / `maxExtractiveSentences` | extractive answer length             |

### `extractiveAnswer(query, chunks, embedder, options)`

| Option               | Default | Description                             |
| -------------------- | ------- | --------------------------------------- |
| `maxSentences`       | `5`     | answer length                           |
| `semanticWeight`     | `0.65`  | weight of cosine similarity             |
| `lexicalWeight`      | `0.35`  | weight of token overlap                 |
| `relativeThreshold`  | `0.6`   | keep sentences ≥ 60% of best score      |
| `maxEmbedCandidates` | `48`    | lexical prefilter size before embedding |

---

## 10. Building your own pieces

### `EmbeddingProvider`

```ts
interface EmbeddingProvider {
    init?(): Promise<void>;
    embedDocuments(texts: string[]): Promise<number[][]>;
    embedQuery(text: string): Promise<number[]>;
    getDimensions(): Promise<number>;
}
```

All vectors from one provider must share a dimension (the store is initialized with it).

### `VectorStore`

```ts
interface VectorStore {
    init(opts: { dimensions: number }): Promise<void>;
    add(chunks: InsertChunk[]): Promise<void>;
    search(queryVector: number[], k: number): Promise<ScoredChunk[]>;
    hybridSearch?(query: string, queryVector: number[], k: number): Promise<ScoredChunk[]>;
    count(): Promise<number>;
    deleteByLoader(loaderId: string): Promise<boolean>;
    reset(): Promise<void>;
}
```

Implement `hybridSearch` if your store supports keyword search; `ZeroRAG.search()` prefers it automatically.

### `SearchProvider`

See §8.7.

### `LLMAdapter`

See §7.

---

## 11. Recipes

### 11.1 Zero-LLM docs Q&A bot

```ts
import { ZeroRAG } from 'zerorag';

const rag = await ZeroRAG.create({ topK: 8 });
await rag.addFile('./handbook');

const { answer, sources } = await rag.ask('How many vacation days do we get?');
// Fully offline after the one-time model download. $0.
```

### 11.2 Local LLM + your docs (Ollama)

```ts
import { ZeroRAG, OllamaAdapter } from 'zerorag';

const rag = await ZeroRAG.create({
    llm: new OllamaAdapter({ model: 'llama3.1' }),
    topK: 10,
});
await rag.addFile('./docs');
const { answer, sources } = await rag.ask('Summarize the deployment process');
```

### 11.3 Daily news monitor (RSS, dated)

```ts
import { RssProvider, DuckDuckGoProvider, LiveSearch } from 'zerorag';

const live = new LiveSearch({
    providers: [
        new RssProvider([
            'https://news.google.com/rss/search?q=when:1d+semiconductor',
            'https://hnrss.org/newest?q=chip',
        ]),
        new DuckDuckGoProvider(),
    ],
    cacheTtlMs: 10 * 60_000,
});

for (const item of await live.search('semiconductor export controls', { freshWithinDays: 1 })) {
    console.log(`${item.date?.slice(0, 10) ?? '????-??-??'}  ${item.title}\n  ${item.url}`);
}
```

### 11.4 Web-grounded chat with citations

```ts
const rag = await ZeroRAG.create({
    live: true,
    llm: new OpenAICompatibleAdapter({
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        apiKey: process.env.GROQ_API_KEY,
    }),
});

const { answer, sources } = await rag.ask('What changed in React 19 this week?', {
    live: true,
    freshWithinDays: 7,
});
console.log(answer);
for (const s of sources) console.log(`[${s.id}] ${s.label} — ${s.url}`);
```

### 11.5 Unit-testing your integration

No network, no model, no disk:

```ts
import { ZeroRAG, MemoryStore, FunctionAdapter } from 'zerorag';

const rag = await ZeroRAG.create({
    embedder: fakeEmbedder, // your deterministic double
    store: new MemoryStore(),
    llm: new FunctionAdapter(() => 'canned answer [1]'),
    live: { providers: [fakeSearchProvider], fetchImpl: fakeFetch },
});
```

All adapters accept `fetchImpl`, so HTTP is fully mockable.

### 11.6 Re-ingesting after source changes

```ts
await rag.reset(); // or deleteLoader(loaderId) per document
await rag.addFile('./docs'); // full re-index
```

---

## 12. Storage, data & performance

**Where things live**

| What                  | Location                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| Vector + FTS index    | `./.zerorag/` (LanceDB dir; override with `store: new LanceDBStore({ path })`) |
| Embedding model cache | fastembed's cache dir (per-user cache, ~34 MB)                                 |
| Telemetry             | **none**                                                                       |

**Deleting `.zerorag/` is always safe** — it's a pure cache of your documents (re-ingest to rebuild).

**Performance tips**

- Ingest in bulk (one `addFile` per directory beats many `addText` calls).
- `topK` is the main latency lever on search; 5–10 suits most RAG prompts.
- Extractive answering prefilters to ≤48 embedded sentences, so even 20k-char live pages stay fast.
- The first `embedDocuments` call pays one-time ONNX session warmup; subsequent calls reuse it.
- Live search results are cached 5 min — repeated queries in a chat loop are free.

**Platform notes**

- **Windows:** fully supported (tested on Node 24). onnxruntime-node runs CPU-only.
- **Serverless (Vercel/Cloudflare):** works where Node APIs + filesystem are available; for stateless deploys inject a remote `VectorStore` and shrink `chunkSize` for faster cold starts.

---

## 13. Troubleshooting & FAQ

**Q: `ask()` returns generic/unhelpful extractive answers.**
Ensure your chunks actually contain the answer (`await rag.search(q)` first). Tune `maxSentences`, raise `topK`, or add an LLM adapter. For extractive mode, questions that _name_ entities in your docs work best (it rewards lexical + semantic overlap).

**Q: DuckDuckGo says "anomaly detected" / returns nothing.**
DDG rate-limits shared IPs. zerorag's breaker opens and Wikipedia/RSS keep serving. Wait ~60 s, or add `RssProvider` (Google News RSS) for independent fresh results. In tests, mock the network.

**Q: Live results are missing dates.**
Only providers that know publication dates supply `date` — DDG news (`searchNews`), RSS with `pubDate`. Plain web results don't have one.

**Q: First run is slow.**
The embedding model downloads once (~34 MB). Set `showDownloadProgress: true` on `FastEmbedProvider` to watch it.

**Q: Where did my documents go? Are they sent anywhere?**
Nowhere. Chunks + vectors live in `./.zerorag`. Network egress happens only for: model download (first run), your LLM endpoint (if configured), and live providers (if you opt in).

**Q: How do I use a different embedding model?**
Implement `EmbeddingProvider` (e.g., wrap `@xenova/transformers`, an API embedding endpoint, or Ollama's `/api/embeddings`) and pass it as `embedder`. Dimensions are auto-detected via `getDimensions()`.

**Q: Can I run two RAG instances?**
Yes — give each its own `LanceDBStore({ path: './data/instance-b' })`. The default path is shared, so don't point two instances at the same directory concurrently.

**Q: ESM or CJS?**
Both. `import` gets `dist/index.js`, `require` gets `dist/index.cjs`, types via `dist/index.d.ts`.

**Q: How much does it cost?**
$0. Local embeddings, embedded store, keyless search, extractive answers. The only possible cost is your own LLM token usage, if you choose to configure one.

---

## 14. API summary

```ts
// Core
ZeroRAG.create(options?) → Promise<ZeroRAG>
  .addText(text, { source?, metadata? })       → LoaderResult
  .addFile(path, { extensions?, metadata? })    → LoaderResult
  .addLoader(loader, force?)                    → LoaderResult
  .search(query, k?)                            → ScoredChunk[]
  .searchLive(query, { maxResults?, freshWithinDays? }) → SearchResult[]
  .ask(query, { live?, maxLivePages?, maxLiveResults?, freshWithinDays?, maxSentences? })
                                                → AskResult
  .getChunkCount() / .deleteLoader(id) / .reset()

// Embeddings & stores
FastEmbedProvider({ model?, cacheDir?, showDownloadProgress? })
LanceDBStore({ path?, tableName? })
MemoryStore()

// LLM adapters
OpenAICompatibleAdapter({ baseUrl, model, apiKey?, defaultHeaders?, fetchImpl? })
OllamaAdapter({ model, baseUrl?, fetchImpl? })
AnthropicAdapter({ apiKey, model, baseUrl?, anthropicVersion?, maxTokens?, fetchImpl? })
GeminiAdapter({ apiKey, model, baseUrl?, fetchImpl? })
FunctionAdapter(fn, name?)

// Live search
LiveSearch({ providers?, cacheTtlMs?, breakerThreshold?, breakerCooldownMs?,
             maxResults?, providerTimeoutMs?, pageTimeoutMs?, maxPageChars?, fetchImpl? })
  .search(query, { maxResults?, freshWithinDays?, useCache? }) → SearchResult[]
  .fetchPage(url)                                   → { url, title?, text }
  .searchWithPages(query, { maxPages?, ... })       → { results, pages }

DuckDuckGoProvider({ safeSearch?, minIntervalMs? })  // .search / .searchNews
WikipediaProvider({ lang?, fetchImpl? })
RssProvider(feedUrls, { fetchImpl?, maxItemsPerFeed? })

// Loaders
TextLoader(text, { source?, metadata?, chunkSize?, chunkOverlap? })
FileLoader(path, { extensions?, metadata?, chunkSize?, chunkOverlap? })

// Utilities
extractiveAnswer(query, chunks, embedder, options?) → { answer, usedChunks }
splitSentences(text) / splitText(text, opts) / tokenize(text)
cosineSimilarity(a, b) / lexicalOverlap(a, b) / distanceToScore(d)
htmlToText(html) / decodeEntities(text)
fuseResults(lists, k, rrfK?) / normalizeUrl(url)
defineConfig(config)   // typed zerorag.config.ts helper
```

---

## Credits

- **Developer & maintainer:** [Naitik](https://github.com/naitik0409) — zerorag is built and maintained by Naitik.
- Interfaces, chunking orchestration, and design patterns are derived from [EmbedJs](https://github.com/llm-tools/embedJs) (Apache-2.0) — see `NOTICE`.
- [fastembed](https://github.com/Anush008/fastembed) · [LanceDB](https://lancedb.github.io/) · [duck-duck-scrape](https://github.com/muchnameless/duck-duck-scrape) · [@langchain/textsplitters](https://js.langchain.com/) · [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)

**License:** Apache-2.0 — see [LICENSE](../LICENSE).
