import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export interface ChunkingOptions {
    chunkSize?: number;
    chunkOverlap?: number;
}

export const DEFAULT_CHUNK_SIZE = 500;
export const DEFAULT_CHUNK_OVERLAP = 100;

export async function splitText(text: string, opts: ChunkingOptions = {}): Promise<string[]> {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: opts.chunkSize ?? DEFAULT_CHUNK_SIZE,
        chunkOverlap: opts.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    });
    const pieces = await splitter.splitText(text);
    return pieces.filter((p) => p.trim().length > 0);
}
