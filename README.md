# ZeroRAG

> **Free realtime RAG for Node.js** — local embeddings, hybrid vector+keyword search, keyless live web sources, bring-your-own LLM. **$0 API cost, forever.**

[![npm version](https://img.shields.io/npm/v/zerorag.svg?label=zerorag)](https://www.npmjs.com/package/zerorag)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-58%20passing-brightgreen.svg)](#development)

**Zero API keys. Zero cloud accounts. Zero usage bills.**

- **Local embeddings** — `fastembed` (ONNX, BGE-small) runs in-process, 384-dim, no GPU needed
- **Hybrid search** — LanceDB vector search + full-text (FTS) fused with Reciprocal Rank Fusion
- **Realtime web** — DuckDuckGo + Wikipedia + RSS, all keyless, with circuit breakers and caching
- **Bring-your-own LLM** — OpenAI-compatible, Ollama, Anthropic, Gemini adapters, or extractive zero-LLM answers
- **Zero-LLM mode** — extractive answering scores sentences against the query; works fully offline
- **Typed & tested** — TypeScript strict, ESM + CJS builds, 58 unit tests

> **📖 Full detailed guide: [docs/USAGE.md](docs/USAGE.md)** — every API, all adapters, live search, custom providers, recipes, and troubleshooting.

---

## Install

```bash
npm install zerorag
```

Requires **Node.js ≥ 18**. Everything runs locally — no API keys required at any point.

## Quickstart

```ts
import { ZeroRAG } from 'zerorag';

const rag = await ZeroRAG.create(); // local embeddings + embedded LanceDB

await rag.addText('TypeScript is a typed superset of JavaScript.', { source: 'ts.md' });
await rag.addFile('./docs/manual.md');

const hits = await rag.search('What is TypeScript?');
// → [{ pageContent, score, metadata: { source: 'ts.md' } }, ...]

const { answer, sources } = await rag.ask('What is TypeScript?');
console.log(answer); // extractive answer, no LLM needed
console.log(sources); // numbered citations with URLs
```

### Realtime answers from the live web

```ts
const rag = await ZeroRAG.create({ live: true }); // keyless: DuckDuckGo + Wikipedia

const results = await rag.searchLive('aurora forecast tonight');
// → [{ title, url, snippet, date?, provider }, ...]  (RRF-fused, cached, rate-limited)

const { answer, sources } = await rag.ask('Where can I see the aurora tonight?', {
    live: true, // grounds the answer in fresh web pages
    maxLivePages: 3, // fetch + extract up to 3 pages
    freshWithinDays: 7, // DDG freshness filter
});
```

Live search is **best-effort by design**: failed providers trip circuit breakers, `ask()` degrades to index-only answers, and identical queries are cached for 5 minutes.

### Answer with your own LLM (optional)

```ts
import { ZeroRAG, OllamaAdapter, OpenAICompatibleAdapter, AnthropicAdapter } from 'zerorag';

// Local, fully offline:
const rag = await ZeroRAG.create({ llm: new OllamaAdapter({ model: 'llama3.1' }) });

// Or any OpenAI-compatible endpoint (OpenAI, Together, Groq, LM Studio, vLLM...):
const rag2 = await ZeroRAG.create({
    llm: new OpenAICompatibleAdapter({
        apiKey: process.env.API_KEY,
        baseUrl: 'https://api.openai.com/v1',
    }),
});

const { answer, mode } = await rag.ask('Explain the architecture'); // mode: 'llm'
```

No LLM configured? `ask()` automatically runs in **extractive mode** — it picks the most query-relevant sentences from retrieved chunks. Free, instant, offline.

---

## API

### `ZeroRAG.create(options?) → Promise<ZeroRAG>`

| Option                       | Default                       | Description                                            |
| ---------------------------- | ----------------------------- | ------------------------------------------------------ |
| `embedder`                   | `FastEmbedProvider`           | Any `EmbeddingProvider` (local by default)             |
| `store`                      | `LanceDBStore` (`./.zerorag`) | Any `VectorStore`; `MemoryStore` for tests             |
| `llm`                        | —                             | Any `LLMAdapter`; omit for extractive mode             |
| `live`                       | `false`                       | `true` or `LiveSearchConfig` to enable realtime search |
| `chunkSize` / `chunkOverlap` | `500` / `100`                 | Chunking for `addText` / `addFile`                     |
| `topK`                       | `5`                           | Default retrieval depth                                |
| `systemMessage`              | helpful-assistant             | LLM system prompt                                      |
| `maxExtractiveSentences`     | `5`                           | Extractive answer length cap                           |

### Methods

| Method                                                 | Description                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| `addText(text, { source?, metadata? })`                | Ingest a string → chunks → vectors → store                  |
| `addFile(path, { extensions?, metadata? })`            | Ingest a file (md, txt, html, ...)                          |
| `addLoader(loader, force?)`                            | Custom `Loader`; deduped by `getUniqueId()`                 |
| `search(query, k?)`                                    | Hybrid retrieval → `ScoredChunk[]`                          |
| `searchLive(query, { maxResults?, freshWithinDays? })` | Keyless web search → `SearchResult[]`                       |
| `ask(query, { live?, maxLivePages?, ... })`            | Answer with citations → `{ answer, mode, sources, chunks }` |
| `getChunkCount()` / `deleteLoader(id)` / `reset()`     | Store management                                            |

### LLM adapters

| Adapter                   | Endpoint                                   | Streaming |
| ------------------------- | ------------------------------------------ | --------- |
| `OpenAICompatibleAdapter` | OpenAI, Together, Groq, LM Studio, vLLM... | ✅ SSE    |
| `OllamaAdapter`           | `http://localhost:11434`                   | ✅ NDJSON |
| `AnthropicAdapter`        | Claude API                                 | ✅ SSE    |
| `GeminiAdapter`           | Google Gemini API                          | —         |
| `FunctionAdapter`         | any function (Vercel AI SDK bridge)        | —         |

All adapters take `{ model?, apiKey?, baseUrl?, fetchImpl? }` — `fetchImpl` makes them fully mockable in tests.

### Live search providers

| Provider                | Keyless | Notes                                                              |
| ----------------------- | ------- | ------------------------------------------------------------------ |
| `DuckDuckGoProvider`    | ✅      | Web + `searchNews()` (dated articles), rate-limited                |
| `WikipediaProvider`     | ✅      | MediaWiki API, any language                                        |
| `RssProvider`           | ✅      | Your feed URLs (e.g. Google News RSS), relevance + recency ranking |
| custom `SearchProvider` | —       | Just implement `{ name, search(query, opts) }`                     |

Compose them via `new LiveSearch({ providers: [...] })` or `ZeroRAG.create({ live: { providers: [...] } })`.

### Utilities

`htmlToText`, `tokenize`, `cosineSimilarity`, `lexicalOverlap`, `splitText`, `fuseResults`, `defineConfig`, `extractiveAnswer` — all exported from the package root.

---

## Architecture

```
                       ┌─────────────────────────────────────────────┐
   addText/addFile ──► │  Loader → chunker (langchain) → embeddings  │  (all local)
                       └──────────────────┬──────────────────────────┘
                                          ▼
                       ┌─────────────────────────────────────────────┐
   search(query)  ───► │  LanceDB: vector kNN + FTS → RRF fusion     │
                       └──────────────────┬──────────────────────────┘
                                          ▼
   searchLive(q)  ───► │  LiveSearch: DDG/Wikipedia/RSS fan-out      │  (keyless)
                       │  → breaker + TTL cache → RRF by URL         │
                       └──────────────────┬──────────────────────────┘
                                          ▼
   ask(query)     ───► │  LLM adapter (yours)  —or—  extractive      │
                       │  + numbered [n] sources                     │
                       └─────────────────────────────────────────────┘
```

Everything behind an interface (`EmbeddingProvider`, `VectorStore`, `LLMAdapter`, `Loader`, `SearchProvider`) — swap any layer, ship no keys.

## Why zerorag?

|                        | zerorag               | LangChain + hosted APIs | EmbedJs     |
| ---------------------- | --------------------- | ----------------------- | ----------- |
| API cost               | **$0**                | per-token / per-request | $0 (no LLM) |
| Embeddings             | local (fastembed)     | often hosted            | local       |
| Vector store           | embedded LanceDB      | varies                  | LanceDB*    |
| Realtime web (keyless) | ✅ DDG/Wikipedia/RSS  | needs API keys          | ❌          |
| LLM                    | bring-your-own / none | required                | none        |
| Setup                  | `npm i zerorag`       | multi-package           | Nx monorepo |

\* upstream LanceDB adapter used placeholder vectors — zerorag's is a full rewrite with native vectors, cosine, and hybrid FTS+RRF.

## Development

```bash
npm install
npm run typecheck      # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run lint           # biome check
npm run test           # vitest (58 tests, offline)
npm run build          # tsup → dist/ (ESM + CJS + .d.ts)
npm run example        # offline end-to-end demo, zero keys
npm run example:live   # keyless realtime web demo (needs network)
```

Network-gated checks (live DDG) run separately; the default suite is fully offline except first-run model download.

## Credits & license

**Developed and maintained by [Naitik](https://github.com/naitik0409).**

Apache-2.0. Interfaces, chunking orchestration, and design patterns are derived from [**EmbedJs**](https://github.com/llm-tools/embedJs) (Apache-2.0) — see `NOTICE`. All other code is original to this project.
