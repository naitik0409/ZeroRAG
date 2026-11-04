import { ZeroRAG, FastEmbedProvider } from '../src/index.js';

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const query = args.slice(1).join(' ');

    if (!command || !query) {
        console.log('Usage:');
        console.log('  npx tsx examples/cli.ts --ask "your question"');
        console.log('  npx tsx examples/cli.ts --asklive "your question"');
        console.log('  npx tsx examples/cli.ts --search "your question"');
        console.log('  npx tsx examples/cli.ts --live "your question"');
        process.exit(1);
    }

    const rag = await ZeroRAG.create({
        embedder: new FastEmbedProvider(),
        topK: 5,
    });

    let mode: string | undefined;
    let answer: string;
    let sources: { label: string; score?: number; url?: string }[] = [];

    try {
        if (command === '--ask') {
            const r = await rag.ask(query);
            mode = r.mode;
            answer = r.answer;
            sources = r.sources?.map((s: any) => ({
                label: s.label,
                score: s.score?.toFixed ? Number(s.score.toFixed(3)) : undefined,
                url: s.url,
            })) || [];
            console.log('\n=== Extractive Answer ===');
            console.log('Mode:', mode);
            console.log('Answer:', answer);
            console.log('Sources:', sources.length ? sources.map((s) => `${s.label} (score ${s.score ?? ''})`).join(', ') : 'none');
        } else if (command === '--asklive') {
            const r = await rag.ask(query, { live: true, maxLivePages: 2 });
            mode = r.mode;
            answer = r.answer;
            sources = (r.sources || []).map((s: any) => ({
                label: s.label,
                url: s.url,
            }));
            console.log('\n=== Live-Grounded Answer ===');
            console.log('Mode:', mode);
            console.log('Answer:', answer);
            console.log('Sources:', sources.length ? sources.map((s) => `${s.label} — ${s.url ?? ''}`).join(' | ') : 'none');
            console.log('Live mode: fresh web results included');
        } else if (command === '--search') {
            const hits = await rag.search(query, 5);
            console.log('\n=== Hybrid Search ===');
            console.log(`Found ${hits.length} hits:`);
            hits.forEach((h, i) => {
                const src = h.metadata.source ?? 'unknown';
                console.log(`  ${i + 1}. [${h.score.toFixed(3)}] ${src}`);
                console.log(`     ${h.pageContent?.slice(0, 120).replace(/\s+/g, ' ')}…`);
            });
        } else if (command === '--live') {
            const liveResults = await rag.searchLive(query, { maxResults: 5 });
            console.log('\n=== Keyless Live Search ===');
            console.log(`Found ${liveResults.length} results:`);
            liveResults.forEach((r, i) => {
                const date = r.date ? `( ${r.date.slice(0, 10)} )` : '';
                console.log(`  ${i + 1}. ${r.title}${date}`);
                console.log(`     ${r.url}  [${r.provider}]`);
            });
        } else {
            console.log(`Unknown command: ${command}`);
            process.exit(1);
        }
    } catch (e) {
        console.error('Error:', (e as Error).message);
        process.exit(1);
    } finally {
        await rag.reset();
    }
}

main();