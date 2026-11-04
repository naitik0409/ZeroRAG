# PLAN — ZeroRAG: Advanced Free Realtime RAG (npm package)

> Working name: **zerorag** (npm availability verified 2026-11-04; final name decided before publish).

## 1. Locked decisions

| Decision       | Choice                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approach       | Fork an open-source RAG, fix/upgrade/mod it — not from scratch                                                                                                                                                        |
| Base project   | `llm-tools/embedJs` (601★, Apache-2.0, Nx monorepo: loaders, chunkers, vector stores, model adapters)                                                                                                                 |
| LLM            | **No bundled LLM.** Pluggable `LLMAdapter` — adapts to whatever LLM/API the user's project has (OpenAI-compatible, Ollama, Groq, Anthropic, Vercel AI SDK…). Plus zero-LLM **extractive mode** for out-of-the-box use |
| Realtime layer | **Keyless sources only by default**: DuckDuckGo, Wikipedia, RSS/Atom, direct page extraction                                                                                                                          |
| Runtime        | Node.js 18+ first (browser later)                                                                                                                                                                                     |
| Cost           | $0 forever: local ONNX embeddings, embedded LanceDB, keyless search, user's own LLM                                                                                                                                   |
| Output         | Published npm package usable in any project                                                                                                                                                                           |

## 2. Target architecture

```
┌─ INGESTION ────────────────────────────────────────────────┐
│ Loaders (files, web, RSS, sitemap, YouTube, user text)     │
│   → Chunker (recursive / token / heading-aware)            │
│   → Embedder   [default: local bge-small via ONNX]         │
│                 [plug: user's own embed fn or API]         │
│   → Store      [default: LanceDB embedded, vector+FTS]     │
│                 [plug: user's own store adapter]           │
├─ REALTIME ─────────────────────────────────────────────────┤
│ SearchProvider[] (DDG web/news, Wikipedia, RSS)            │
│   → PageExtractor (HTML → readable Markdown)               │
│   → Freshness scoring + TTL cache + circuit breakers       │
│   → optional: user's own provider (SearXNG/Tavily/etc.)    │
├─ RETRIEVAL ────────────────────────────────────────────────┤
│ Hybrid: vector + FTS/BM25 → RRF fusion → [rerank optional] │
│ Query analyst: intent + freshness routing                  │
│ Agent loop: retrieve → relevance judge → rewrite → retry   │
├─ GENERATION ───────────────────────────────────────────────┤
│ LLMAdapter interface (complete/stream)                     │
│   adapters: openai-compatible*, anthropic, google,         │
│             ollama, vercel-ai-bridge, custom function      │
│   *covers Groq/DeepSeek/vLLM/LM Studio/Gemini-compat       │
│ Extractive fallback (no LLM): sentence-select + citations  │
│ Output: answer + structured sources with URLs/dates        │
└────────────────────────────────────────────────────────────┘
```

**Core principle: adapter-first.** Five interfaces — `EmbeddingProvider`, `VectorStore`, `LLMAdapter`, `SearchProvider`, `Extractor`. Zero-config default = fully free; users swap any layer.

## 3. Why EmbedJs (and what we do to it)

- **Salvage:** loaders, splitters, base embedding/model abstractions, vector-store adapters (keep LanceDB/memory; cloud ones optional), monorepo/build tooling.
- **Replace/upgrade:** paid defaults → local free stack; add LanceDB, hybrid FTS search, realtime search layer, LLM-agnostic adapter, agent judge loop, extractive mode, CLI + `defineConfig`.
- **Compliance:** Apache-2.0 — retain `LICENSE` + `NOTICE` attribution; publish under new name (allowed).

## 4. Strategy — phased execution

| Phase                       | Goal                                                                                                                        | Exit gate                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **P0 — Acquire & audit**    | Clone embedJs, inventory what we keep, smoke-test LanceDB + local ONNX embeddings on this machine, verify npm name          | Smoke test green                                              |
| **P1 — Free core**          | New core pipeline: local embedder + LanceDB hybrid search + citations; strip paid defaults                                  | `ingest → ask` works with zero keys                           |
| **P2 — LLM-agnostic layer** | `LLMAdapter` + adapters (openai-compat, ollama, anthropic, google, vercel-ai, custom fn), streaming, extractive no-LLM mode | Answer from 3 different LLM configs + extractive mode         |
| **P3 — Realtime layer**     | DDG/Wikipedia/RSS providers, page extraction, freshness scoring, cache + rate-limit + circuit-breaker + fallback            | "Latest news about X" returns dated fresh sources, no API key |
| **P4 — Agentic quality**    | Freshness routing, query rewriting/multi-query, relevance judge, optional local reranker, structured results                | Eval set passes                                               |
| **P5 — DX & publish**       | CLI, `defineConfig`, docs/examples, ESM+CJS, peerDeps, changesets → npm publish v1.0                                        | `npx zerorag init` → working demo                             |

**Post-v1 backlog:** browser build, MCP server package, GraphRAG, scheduled watchers, Qdrant/pgvector adapters.

## 5. Engineering conventions

TypeScript strict · adapters in separate folders · heavy optionals as `peerDependencies` · vitest per phase · lint + typecheck before every phase exit · changesets semver · docs live with code.

## 6. Risks & mitigations

| Risk                                      | Mitigation                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| DDG unofficial endpoints break/rate-limit | Multi-source fallback (Wikipedia/RSS), circuit breakers, cache; pluggable providers (SearXNG/Tavily) |
| embedJs code sprawl / stale deps          | Audit-and-port in P0 — inventory what we keep, don't blind-merge                                     |
| `onnxruntime-node` native-install issues  | Optional/peer layer; user-provided embedder always works                                             |
| npm name collision                        | Verified available in P0; re-verify before publish                                                   |
| Apache-2.0 obligations                    | Keep LICENSE + NOTICE in published package                                                           |

## 7. Immediate execution steps (P0)

1. ~~Write `plan.md`~~ (this file)
2. ~~Clone embedJs → `upstream/embedJs`, run its tests, inventory modules~~
3. ~~Smoke test: `@lancedb/lancedb` + `fastembed` on this machine (Windows, Node 24)~~
4. ~~Scaffold our package at repo root under name `zerorag`~~

## 8. P0 AUDIT RESULTS (2026-11-04)

**Smoke test: GREEN**

- `fastembed` bge-small-en-v1.5: 384-dim vectors, 3.5s warm init, no API key
- LanceDB: vector search ✓, FTS index ✓ (`createIndex(col,{config:Index.fts()})` + `search(q,"fts",[col])`)
- Note: npm 11 blocks install scripts by default (`npm approve-scripts`); onnxruntime works anyway

**Upstream structure (40 packages, Nx monorepo):**

- `core/embedjs-interfaces` — BaseLoader, BaseEmbeddings, BaseModel, BaseStore, BaseVectorDatabase ✓ port shapes
- `core/embedjs` — RAGApplication orchestrator (addLoader→chunk→embed→insert; search→query w/ sources) ✓ port pattern
- `core/embedjs-utils` — cleanString, truncate, arrays, web utils ✓ port
- `databases/embedjs-lancedb` — exists but **weak**: fake `md5` sample row hack, vectors JSON-stringified (no native types), cosine recomputed in JS (ignores LanceDB `_distance`), no FTS/hybrid → **rewrite**
- `loaders/*` — text, local-path, url, json in core; web/pdf/markdown/csv/sitemap/youtube/xml/image/msoffice/confluence optional → port high-value ones
- `models/*` — openai, ollama, anthropic, mistral, cohere, vertex, llama-cpp, huggingface → replace with unified `LLMAdapter`
- Chunking: `@langchain/textsplitters` (MIT) RecursiveCharacterTextSplitter → keep as dep
- **No tests anywhere upstream**; paid defaults (OpenAI-only SIMPLE_MODELS, no local embedder); `query()` throws without model (no extractive fallback)

**Verdict:** build `zerorag` as a single package at repo root (not the Nx monorepo), porting interfaces/orchestration/loaders/utils from upstream; rewrite LanceDB adapter, embeddings, model layer, add realtime + extractive. Apache-2.0: ship LICENSE + NOTICE crediting embedJs.
