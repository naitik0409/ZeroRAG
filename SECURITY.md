# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ latest |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, email: **[SECURITY_EMAIL_PLACEHOLDER]** (replace with your contact before publishing) or use [GitHub private vulnerability reporting](https://github.com/<you>/zerorag/security/advisories/new).

You should receive an acknowledgment within 72 hours. Please include:

- Description of the issue and potential impact
- Steps to reproduce (proof-of-concept preferred)
- Affected version(s)

We will work with you on a fix and coordinated disclosure.

## Security notes for users

zerorag is designed to run **entirely on your machine**:

- **No telemetry, no outbound calls except**: embedding model download (first run, from HuggingFace), your configured LLM endpoint, and keyless live-search sources (DuckDuckGo, Wikipedia, RSS feeds you configure) when you opt into `live`.
- **Data stays local**: documents, chunks, and vectors are stored in `./.zerorag` on disk unless you provide a custom `VectorStore`.
- **API keys are yours**: if you configure an LLM adapter with an `apiKey`, it is passed only to the endpoint you specify (or `baseUrl`).
- **Untrusted content**: live web pages and ingested documents are treated as untrusted data. If you feed retrieved content to an LLM, standard prompt-injection precautions apply — consider constraining `systemMessage` and validating tool calls.

## Scope

In scope: the `zerorag` package as published on npm, including its default providers and adapters.

Out of scope: vulnerabilities in third-party dependencies (report upstream), issues requiring physical/local access to the machine, and social engineering.
