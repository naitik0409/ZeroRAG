# Workspace graph

This graph separates the current executable smoke test, the vendored upstream
monorepo, and the intended ZeroRAG design. Solid arrows describe current
dependencies or runtime flow; dashed arrows are planned and are not implemented
in this workspace yet.

```mermaid
flowchart TD
  subgraph workspace["ZeroRAG workspace"]
    plan["plan.md"]
    rootPkg["package.json"]

    subgraph smoke["Current: smoke/smoke.mjs"]
      runner["Smoke runner"]
      embed["fastembed<br/>BGESmallENV15"]
      vector["LanceDB<br/>vector search"]
      fts["LanceDB<br/>full-text search"]
      cache["smoke/local_cache<br/>ONNX model files"]
      data["smoke/data<br/>LanceDB tables and indexes"]

      runner -->|"initialize + embed"| embed
      embed -->|"loads model"| cache
      runner -->|"create table + query vectors"| vector
      runner -->|"create FTS index + query text"| fts
      vector -->|"persists"| data
      fts -->|"persists"| data
    end

    subgraph target["Planned: ZeroRAG pipeline (from plan.md)"]
      ingest["Ingestion<br/>load → chunk → embed"]
      retrieve["Retrieval<br/>hybrid search + fusion"]
      realtime["Realtime sources<br/>search → extract → cache"]
      answer["Answer<br/>LLM adapter or extractive mode"]

      ingest --> retrieve
      realtime -.-> retrieve
      retrieve --> answer
    end

    rootPkg -->|"declares"| embed
    rootPkg -->|"declares"| vector
    plan -.->|"describes"| target
  end

  subgraph upstream["Vendored upstream: upstream/embedJs"]
    core["@llm-tools/embedjs"]
    interfaces["@llm-tools/embedjs-interfaces"]
    utils["@llm-tools/embedjs-utils"]
    loaders["Loader packages"]
    models["Model adapter packages"]
    databases["Vector database adapter packages"]

    core --> interfaces
    core --> utils
    utils --> interfaces
    loaders --> interfaces
    loaders --> utils
    models --> interfaces
    databases --> interfaces
  end
```

## Evidence and boundaries

- The smoke runner is [smoke/smoke.mjs](./smoke/smoke.mjs); it embeds three
  sample strings, creates a LanceDB table, runs vector search, then attempts
  full-text search.
- The runtime model cache and LanceDB data are generated under
  `smoke/local_cache/` and `smoke/data/`; these are runtime artifacts, not
  source modules.
- Root dependencies are declared in [package.json](./package.json).
- The upstream workspace boundaries are declared in
  [upstream/embedJs/package.json](./upstream/embedJs/package.json). Its core
  dependency edges are corroborated by the package manifests under
  `upstream/embedJs/core/`, `upstream/embedJs/loaders/`,
  `upstream/embedJs/models/`, and `upstream/embedJs/databases/`.
- The dashed target pipeline is design intent from [plan.md](./plan.md), not
  working ZeroRAG implementation. In particular, realtime search, hybrid
  retrieval, and answer generation are not in the current smoke runner.
