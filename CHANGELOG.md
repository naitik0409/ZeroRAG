# Changelog

All notable changes to this project are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-05

Initial release.

### Added

- **Core pipeline** — `ZeroRAG.create()` with local defaults: `FastEmbedProvider` (fastembed, BGE-small, ONNX, 384-dim) and embedded LanceDB at `./.zerorag`
- **Ingestion** — `addText`, `addFile`, `addLoader` with loader-ID dedupe; LangChain-powered chunking (500/100 defaults); markdown / text / HTML / source-code loaders
- **Hybrid retrieval** — LanceDB vector kNN (cosine) + full-text search fused with Reciprocal Rank Fusion; `MemoryStore` for tests/in-memory use
- **Extractive (zero-LLM) answers** — `ask()` works with no LLM configured: scores retrieved sentences against the query
- **LLM adapters** (bring-your-own, none bundled) — `OpenAICompatibleAdapter` (SSE streaming), `OllamaAdapter` (NDJSON streaming), `AnthropicAdapter` (SSE streaming), `GeminiAdapter`, `FunctionAdapter`
- **Realtime keyless web search** — `LiveSearch` orchestrator with multi-provider fan-out, RRF fusion by normalized URL, TTL cache, per-provider circuit breakers, and page extraction (HTML → text)
  - `DuckDuckGoProvider` (web + `searchNews` with dates, rate-limited)
  - `WikipediaProvider` (MediaWiki API)
  - `RssProvider` (any RSS/Atom feeds, relevance + recency ranking)
  - `ZeroRAG.searchLive()` and `ask({ live: true })` for web-grounded answers with citations
- **Utilities** — `htmlToText`, `tokenize`, `cosineSimilarity`, `lexicalOverlap`, `fuseResults`, `normalizeUrl`, `defineConfig`
- **Build & tooling** — TypeScript strict (`noUncheckedIndexedAccess`), tsup dual ESM/CJS + declaration builds, Vitest suite (58 tests), Biome lint/format, GitHub Actions CI + npm release workflow

### Notes

- Interfaces, chunking orchestration, and design patterns derived from [EmbedJs](https://github.com/llm-tools/embedJs) (Apache-2.0); see `NOTICE`. The upstream LanceDB adapter was rewritten (native vectors, cosine, hybrid FTS+RRF).
