import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

import type { Loader } from '../interfaces.js';
import type { Chunk } from '../types.js';
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE, splitText, type ChunkingOptions } from '../core/chunker.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.jsonl', '.log', '.yml', '.yaml']);

export interface FileLoaderOptions extends ChunkingOptions {
    /** Extensions to include (with dot), default: common text formats */
    extensions?: string[];
    metadata?: Record<string, unknown>;
}

/** Loads a single file or recursively loads a directory of text files. */
export class FileLoader implements Loader {
    private readonly path: string;
    private readonly opts: FileLoaderOptions;
    private readonly uniqueId: string;

    constructor(path: string, opts: FileLoaderOptions = {}) {
        this.path = resolve(path);
        this.opts = opts;
        this.uniqueId = `file_${createHash('sha1').update(this.path).digest('hex').slice(0, 16)}`;
    }

    getUniqueId(): string {
        return this.uniqueId;
    }

    private async listFiles(): Promise<string[]> {
        const extensions = new Set((this.opts.extensions ?? [...TEXT_EXTENSIONS]).map((e) => e.toLowerCase()));
        const files: string[] = [];

        const walk = async (p: string): Promise<void> => {
            const info = await stat(p);
            if (info.isFile()) {
                if (extensions.has(extname(p).toLowerCase())) files.push(p);
            } else if (info.isDirectory()) {
                const entries = await readdir(p, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                    await walk(join(p, entry.name));
                }
            }
        };

        await walk(this.path);
        return files.sort();
    }

    async *getChunks(): AsyncGenerator<Chunk> {
        const files = await this.listFiles();
        const rootDir = (await stat(this.path)).isDirectory() ? this.path : resolve(this.path, '..');

        for (const file of files) {
            const raw = await readFile(file, 'utf8');
            const text = file.endsWith('.json') || file.endsWith('.jsonl') ? this.normalizeJson(file, raw) : raw;
            if (!text.trim()) continue;

            const source = relative(rootDir, file) || file;
            const pieces = await splitText(text, this.opts);
            let i = 0;
            for (const pageContent of pieces) {
                yield {
                    pageContent,
                    metadata: {
                        type: 'file',
                        source,
                        path: file,
                        index: i++,
                        ...this.opts.metadata,
                    },
                };
            }
        }
    }

    private normalizeJson(file: string, raw: string): string {
        if (file.endsWith('.jsonl')) {
            return raw
                .split('\n')
                .filter((l) => l.trim())
                .map((l) => {
                    try {
                        return JSON.stringify(JSON.parse(l));
                    } catch {
                        return l;
                    }
                })
                .join('\n');
        }
        try {
            return JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
            return raw;
        }
    }
}
