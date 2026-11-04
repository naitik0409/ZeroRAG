/**
 * P1 gate demo: ingest → search → ask with ZERO API keys.
 * Uses local FastEmbed embeddings + embedded LanceDB + extractive answering.
 *
 * Run: npm run example
 */
import { ZeroRAG } from '../src/index.js';

const rag = await ZeroRAG.create({
    // Defaults: FastEmbedProvider (local ONNX) + LanceDBStore (./.zerorag-example)
    topK: 3,
});

await rag.addText(
    'The Aurora Borealis, or northern lights, is a natural light display in the sky caused by charged particles from the sun colliding with atmospheric gases. It is best viewed from high-latitude regions such as Norway, Iceland and Canada.',
    { source: 'aurora.md' },
);
await rag.addText(
    'LanceDB is an embedded vector database built on the Lance columnar format. It runs in-process, requires no server, and supports vector search, full-text search and SQL filtering.',
    { source: 'lancedb.md' },
);
await rag.addText(
    'Expresso is a fictional coffee brand used in documentation examples. Their signature drink is the double-shot oat latte.',
    { source: 'brand.md' },
);

console.log('Indexed chunks:', await rag.getChunkCount());

const hits = await rag.search('what causes the northern lights?');
console.log(
    '\nSearch hits:',
    hits.map((h) => ({ source: h.metadata.source, score: Number(h.score.toFixed(3)) })),
);

const result = await rag.ask('What causes the aurora borealis and where can you see it?');
console.log('\nMode:', result.mode);
console.log('Answer:', result.answer);
console.log('Sources:', result.sources);

await rag.reset();
