import { describe, expect, it } from 'vitest';

import { FastEmbedProvider } from '../src/index.js';

describe('FastEmbedProvider (real local model)', () => {
    it('initializes locally and returns 384-dim vectors', async () => {
        const provider = new FastEmbedProvider();
        await provider.init();

        const dims = await provider.getDimensions();
        expect(dims).toBe(384);

        const docs = await provider.embedDocuments(['hello world', 'retrieval augmented generation']);
        expect(docs).toHaveLength(2);
        expect(docs[0]).toHaveLength(384);

        const query = await provider.embedQuery('hello world');
        expect(query).toHaveLength(384);
    }, 120_000);

    it('embeds semantically similar text closer than unrelated text', async () => {
        const provider = new FastEmbedProvider();
        const [a, b, c] = await provider.embedDocuments([
            'the cat sat on the mat',
            'a feline resting on the rug',
            'quantum chromodynamics lattice simulations',
        ]);
        expect(a && b && c).toBeTruthy();

        const dot = (x: number[], y: number[]) =>
            x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
        const similar = dot(a!, b!);
        const dissimilar = dot(a!, c!);
        expect(similar).toBeGreaterThan(dissimilar);
    }, 120_000);
});
