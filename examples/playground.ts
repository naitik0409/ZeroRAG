/**
 * Interactive playground — try zerorag with real queries.
 *
 *   npm run playground
 *
 * On start it ingests the project docs (so you can ask about zerorag itself),
 * then accepts commands on stdin. Type /help for commands.
 */
import { createInterface } from 'node:readline/promises';

import { DuckDuckGoProvider, RssProvider, WikipediaProvider, ZeroRAG } from '../src/index.js';

const SUGGESTED = [
    ['How do I configure an Ollama adapter?', '/asklive'],
    ['What is hybrid search and how does RRF work?', '/ask'],
    ['Explain the circuit breaker defaults', '/ask'],
    ['latest space telescope discovery', '/live'],
    ['aurora forecast tonight', '/live'],
    ['node.js release', '/news'],
];

async function main() {
    console.log('──────────────────────────────────────────────────────────');
    console.log('  zerorag playground  —  free, keyless, zero LLM required');
    console.log('──────────────────────────────────────────────────────────\n');

    console.log('creating rag (local embeddings + LanceDB) ...');
    const rag = await ZeroRAG.create({
        live: true,
        topK: 6,
    });

    console.log('ingesting project docs (README + docs/USAGE.md) ...');
    for (const file of ['./README.md', './docs/USAGE.md']) {
        try {
            const { chunksAdded } = await rag.addFile(file);
            console.log(`  ✓ ${file} (${chunksAdded} chunks)`);
        } catch (e) {
            console.log(`  ✗ ${file}: ${(e as Error).message}`);
        }
    }
    console.log(`total chunks: ${await rag.getChunkCount()}`);

    const ddg = new DuckDuckGoProvider();
    const wiki = new WikipediaProvider();
    const rss = new RssProvider(
        ['https://news.google.com/rss/search?q=technology+when:1d', 'https://hnrss.org/frontpage'],
        {},
    );

    printHelp();
    console.log('try one of these:');
    for (const [q, cmd] of SUGGESTED) console.log(`  ${cmd} ${q}`);
    console.log('');

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const ask = async (q: string) => {
        const t0 = Date.now();
        const { answer, sources, mode } = await rag.ask(q, { maxSentences: 4 });
        console.log(`\n[${mode} · ${Date.now() - t0}ms] ${answer}`);
        for (const s of sources.slice(0, 5)) {
            console.log(`  [${s.id}] ${s.label}${s.url ? ` — ${s.url}` : ''}`);
        }
    };

    process.stdout.write('\nzerorag> ');
    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (!line) {
            process.stdout.write('zerorag> ');
            continue;
        }
        const [cmd, ...rest] = line.split(/\s+/);
        const q = rest.join(' ');
        const t0 = Date.now();
        let quit = false;

        try {
            switch (cmd) {
                case '/quit':
                case '/exit':
                    quit = true;
                    break;

                case '/help':
                    printHelp();
                    break;

                case '/count':
                    console.log(`chunks: ${await rag.getChunkCount()}`);
                    break;

                case '/ingest': {
                    if (!q) {
                        console.log('usage: /ingest <file-or-dir>');
                        break;
                    }
                    const r = await rag.addFile(q);
                    console.log(`ingested ${r.chunksAdded} chunks (loaderId ${r.loaderId})`);
                    break;
                }

                case '/search': {
                    if (!q) {
                        console.log('usage: /search <query>');
                        break;
                    }
                    const hits = await rag.search(q, 5);
                    console.log(`${hits.length} hits · ${Date.now() - t0}ms`);
                    for (const [i, h] of hits.entries()) {
                        const text = h.pageContent.slice(0, 110).replace(/\s+/g, ' ');
                        console.log(
                            `  ${i + 1}. [${h.score.toFixed(3)}] ${String(h.metadata.source ?? '')} :: ${text}…`,
                        );
                    }
                    break;
                }

                case '/live': {
                    if (!q) {
                        console.log('usage: /live <query>');
                        break;
                    }
                    const results = await rag.searchLive(q, { maxResults: 6 });
                    console.log(`${results.length} live results · ${Date.now() - t0}ms`);
                    for (const [i, r] of results.entries()) {
                        const date = r.date ? `(${r.date.slice(0, 10)})` : '';
                        console.log(
                            `  ${i + 1}. ${r.title}  ${date}\n     ${r.url}  [${r.provider}]`,
                        );
                    }
                    break;
                }

                case '/web': {
                    if (!q) {
                        console.log('usage: /web <query>');
                        break;
                    }
                    const results = await wiki.search(q, { maxResults: 5 });
                    console.log(`${results.length} wikipedia results · ${Date.now() - t0}ms`);
                    for (const [i, r] of results.entries()) {
                        console.log(`  ${i + 1}. ${r.title}\n     ${r.url}`);
                    }
                    break;
                }

                case '/news': {
                    if (!q) {
                        console.log('usage: /news <query>');
                        break;
                    }
                    const results = await ddg.searchNews(q, { maxResults: 6, freshWithinDays: 7 });
                    console.log(`${results.length} news results · ${Date.now() - t0}ms`);
                    for (const [i, r] of results.entries()) {
                        const date = r.date ? r.date.slice(0, 10) : '????-??-??';
                        console.log(`  ${i + 1}. ${date}  ${r.title}\n     ${r.url}`);
                    }
                    break;
                }

                case '/rss': {
                    const results = await rss.search(q || 'technology', { maxResults: 6 });
                    console.log(`${results.length} rss results · ${Date.now() - t0}ms`);
                    for (const [i, r] of results.entries()) {
                        const date = r.date ? r.date.slice(0, 10) : '????-??-??';
                        console.log(
                            `  ${i + 1}. ${date}  ${r.title}\n     ${r.url}  [${r.provider}]`,
                        );
                    }
                    break;
                }

                case '/asklive': {
                    if (!q) {
                        console.log('usage: /asklive <question>');
                        break;
                    }
                    const t = Date.now();
                    const { answer, sources, mode } = await rag.ask(q, {
                        live: true,
                        maxLivePages: 2,
                        maxSentences: 4,
                    });
                    console.log(`\n[${mode} · ${Date.now() - t}ms] ${answer}`);
                    for (const s of sources.slice(0, 6)) {
                        console.log(`  [${s.id}] ${s.label}${s.url ? ` — ${s.url}` : ''}`);
                    }
                    break;
                }

                case '/ask': {
                    if (!q) {
                        console.log('usage: /ask <question>');
                        break;
                    }
                    await ask(q);
                    break;
                }

                default:
                    // bare text = ask against your docs
                    await ask(line);
            }
        } catch (e) {
            console.log(`error: ${(e as Error).message}`);
        }

        if (quit) break;
        process.stdout.write('\nzerorag> ');
    }
    rl.close();
}

function printHelp() {
    console.log(`
commands
  <any text>        ask your docs (extractive, zero-LLM)     e.g. How do chunks work?
  /ask <q>          same, explicitly
  /asklive <q>      answer grounded in live web pages too    e.g. What is RRF fusion?
  /search <q>       hybrid retrieval, show scored chunks
  /live <q>         keyless web search (DDG + Wikipedia)
  /web <q>          Wikipedia only
  /news <q>         DuckDuckGo news, dated (last 7 days)
  /rss [q]          Google News + HNRSS feeds, ranked by relevance+recency
  /ingest <path>    ingest a file or directory into the index
  /count            number of indexed chunks
  /help             this help
  /quit             exit
`);
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
