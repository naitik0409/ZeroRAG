import { describe, expect, it } from 'vitest';

import { splitText } from '../src/core/chunker.js';

describe('splitText', () => {
    it('returns non-empty pieces for simple text', async () => {
        const pieces = await splitText('Hello world. This is a test.');
        expect(pieces.length).toBeGreaterThan(0);
        expect(pieces.join(' ')).toContain('Hello world');
    });

    it('splits long text into multiple overlapping chunks', async () => {
        const text = Array.from({ length: 200 }, (_, i) => `sentence number ${i} about topic`).join(
            ' ',
        );
        const pieces = await splitText(text, { chunkSize: 80, chunkOverlap: 20 });
        expect(pieces.length).toBeGreaterThan(3);
        for (const piece of pieces) {
            expect(piece.length).toBeLessThan(200);
        }
    });

    it('drops whitespace-only pieces', async () => {
        const pieces = await splitText('   \n\n   ');
        expect(pieces).toEqual([]);
    });
});
