/**
 * Realtime demo — zero API keys.
 *
 *   npm run example:live
 *
 * 1. Keyless web search (DuckDuckGo + Wikipedia, RRF-fused)
 * 2. Web-grounded extractive answer (no LLM needed)
 */
import { ZeroRAG } from '../src/index.js';

async function main(): Promise<void> {
    const rag = await ZeroRAG.create({ live: true });

    console.log('── searchLive("latest space telescope discovery") ──');
    const results = await rag.searchLive('latest space telescope discovery', {
        maxResults: 6,
        freshWithinDays: 7,
    });
    for (const r of results) {
        console.log(
            ` • ${r.title}\n   ${r.url}${r.date ? `  (${r.date.slice(0, 10)})` : ''}  [${r.provider}]`,
        );
    }

    console.log('\n── ask({ live: true }) — extractive, zero-LLM ──');
    const { answer, sources, mode } = await rag.ask(
        'What are the latest space telescope discoveries?',
        {
            live: true,
            maxLivePages: 2,
            freshWithinDays: 7,
        },
    );
    console.log(`mode: ${mode}`);
    console.log(answer.split('\n').slice(0, 8).join('\n'));
    console.log('\nsources:');
    for (const s of sources.slice(0, 5)) {
        console.log(` [${s.id}] ${s.label}${s.url ? ` — ${s.url}` : ''}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
