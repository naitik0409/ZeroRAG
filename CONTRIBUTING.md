# Contributing to zerorag

Thanks for your interest in improving zerorag! This document explains the workflow and quality gates.

## Ground rules

- **Zero-key principle**: nothing may require a paid API key. Realtime sources must stay keyless; LLMs are bring-your-own only.
- **Apache-2.0**: contributions are accepted under the project's license. Your original code, not copied from incompatible licenses.
- Be kind in issues and PRs (see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)).

## Getting started

```bash
git clone https://github.com/naitik0409/ZeroRAG
cd zerorag
npm install
npm run test        # must pass before you change anything
```

## Workflow

1. **Open an issue first** for large changes (new provider, store backend, API changes).
2. Branch from `main`: `feat/<short-name>` or `fix/<short-name>`.
3. Make your change with tests. Match the existing style (Biome formats for you).
4. Run the full gate before pushing:

   ```bash
   npm run typecheck && npm run lint && npm run test && npm run build
   ```

5. Open a PR with a clear description of _what_ changed and _why_.

## Quality gates (enforced in CI)

| Gate                                        | Command             |
| ------------------------------------------- | ------------------- |
| Types (strict + `noUncheckedIndexedAccess`) | `npm run typecheck` |
| Lint + format                               | `npm run lint`      |
| Tests (offline, deterministic)              | `npm run test`      |
| Build (ESM + CJS + d.ts)                    | `npm run build`     |

## Adding a live search provider

Implement the `SearchProvider` interface — nothing else is needed:

```ts
import type { SearchProvider, SearchResult } from 'zerorag';

export class MyProvider implements SearchProvider {
    readonly name = 'my-source';

    async search(query: string, opts?: { maxResults?: number; freshWithinDays?: number }) {
        // return ranked results; throw on failure (circuit breaker handles it)
        return [{ title, url, snippet, date?, provider: this.name }];
    }
}
```

Then wire it into `new LiveSearch({ providers: [new MyProvider()] })`. Add a test with a mocked `fetchImpl` — never hit the network in the default test suite.

## Adding an LLM adapter

Implement `LLMAdapter` (`complete()` required, `stream()` optional). Accept `fetchImpl` in options so tests can mock HTTP. Follow the patterns in `src/llm/`.

## Commit messages

Conventional commits preferred: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.

## Questions

Open a discussion issue. Maintainer response time is best-effort — this is a free, community project.
