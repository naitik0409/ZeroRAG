import { createHash } from 'node:crypto';

import type { Loader } from '../interfaces.js';
import type { Chunk } from '../types.js';
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE, splitText, type ChunkingOptions } from '../core/chunker.js';

export interface TextLoaderOptions extends ChunkingOptions {
    source?: string;
    metadata?: Record<string, unknown>;
}

export class TextLoader implements Loader {
    private readonly text: string;
    private readonly opts: TextLoaderOptions;
    private readonly uniqueId: string;

    constructor(text: string, opts: TextLoaderOptions = {}) {
        this.text = text;
        this.opts = opts;
        const digest = createHash('sha1').update(text).digest('hex').slice(0, 16);
        this.uniqueId = `text_${digest}`;
    }

    getUniqueId(): string {
        return this.uniqueId;
    }

    async *getChunks(): AsyncGenerator<Chunk> {
        const pieces = await splitText(this.text, this.opts);
        const source = this.opts.source ?? 'inline text';
        let i = 0;
        for (const pageContent of pieces) {
            yield {
                pageContent,
                metadata: {
                    type: 'text',
                    source,
                    index: i++,
                    ...this.opts.metadata,
                },
            };
        }
    }
}
