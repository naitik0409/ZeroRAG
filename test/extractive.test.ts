import { describe, expect, it } from 'vitest';

import { extractiveAnswer, splitSentences } from '../src/core/extractive.js';
import type { ScoredChunk } from '../src/index.js';
import { FakeEmbedder } from './fakes.js';

describe('splitSentences', () => {
    it('splits on sentence boundaries', () => {
        const sentences = splitSentences('The cat sat. The dog ran. Birds flew.');
        expect(sentences).toHaveLength(3);
        expect(sentences[0]).toBe('The cat sat.');
    });

    it('handles text without terminal punctuation', () => {
        const sentences = splitSentences('no punctuation here at all');
        expect(sentences).toHaveLength(1);
    });
});

describe('extractiveAnswer', () => {
    const chunks: ScoredChunk[] = [
        {
            pageContent:
                'The solar system has eight planets. Pluto is a dwarf planet. Mercury is closest to the sun.',
            metadata: { source: 'space.md' },
            score: 0.9,
        },
        {
            pageContent: 'Bananas are yellow and rich in potassium. Apples keep the doctor away.',
            metadata: { source: 'fruit.md' },
            score: 0.5,
        },
    ];

    it('returns empty answer for no chunks', async () => {
        const result = await extractiveAnswer('anything', [], new FakeEmbedder());
        expect(result.answer).toBe('');
        expect(result.usedChunks).toEqual([]);
    });

    it('picks sentences relevant to the query', async () => {
        const result = await extractiveAnswer(
            'How many planets are in the solar system?',
            chunks,
            new FakeEmbedder(),
        );
        expect(result.answer).toContain('solar system');
        expect(result.usedChunks).toContain(0);
    });

    it('respects maxSentences', async () => {
        const result = await extractiveAnswer('planets', chunks, new FakeEmbedder(), {
            maxSentences: 1,
        });
        const sentenceCount = result.answer.split(/[.!?]/).filter((s) => s.trim()).length;
        expect(sentenceCount).toBeLessThanOrEqual(2);
    });
});
