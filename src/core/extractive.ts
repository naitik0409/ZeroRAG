import type { EmbeddingProvider } from '../interfaces.js';
import type { ScoredChunk } from '../types.js';
import { cosineSimilarity, lexicalOverlap } from '../util/text.js';

/** Split text into sentences, robust to abbreviations, URLs and newlines. */
export function splitSentences(text: string): string[] {
    const matches = text.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g);
    if (!matches) return text.trim() ? [text.trim()] : [];
    return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

export interface ExtractiveOptions {
    maxSentences?: number;
    /** Weights for semantic vs lexical scoring */
    semanticWeight?: number;
    lexicalWeight?: number;
    /**
     * Keep only sentences scoring at least this fraction of the best
     * sentence's score (0..1). Defaults to 0.6 — tuned for BGE-family
     * embeddings where unrelated sentences still score ~0.4 cosine.
     */
    relativeThreshold?: number;
    /**
     * Max sentences sent to the embedder. When there are more candidates,
     * a cheap lexical prefilter narrows them first (top lexical hits plus
     * the opening sentences) so huge live pages stay fast on any hardware.
     * Defaults to 48.
     */
    maxEmbedCandidates?: number;
}

export interface ExtractiveResult {
    answer: string;
    /** Indices (0-based) of chunks that contributed sentences */
    usedChunks: number[];
}

/**
 * Zero-LLM answer mode: picks the sentences most relevant to the query using
 * embedding similarity + lexical overlap, returned in original order.
 */
export async function extractiveAnswer(
    query: string,
    chunks: ScoredChunk[],
    embedder: EmbeddingProvider,
    opts: ExtractiveOptions = {},
): Promise<ExtractiveResult> {
    const maxSentences = opts.maxSentences ?? 5;
    const semanticWeight = opts.semanticWeight ?? 0.65;
    const lexicalWeight = opts.lexicalWeight ?? 0.35;
    const relativeThreshold = opts.relativeThreshold ?? 0.6;

    if (chunks.length === 0 || !query.trim()) {
        return { answer: '', usedChunks: [] };
    }

    const candidates: { text: string; chunkIdx: number; order: number }[] = [];
    let order = 0;
    chunks.forEach((chunk, chunkIdx) => {
        for (const sentence of splitSentences(chunk.pageContent)) {
            candidates.push({ text: sentence, chunkIdx, order: order++ });
        }
    });
    if (candidates.length === 0) return { answer: '', usedChunks: [] };

    // Prefilter: embedding is the expensive step — only rank a bounded set
    const embedLimit = opts.maxEmbedCandidates ?? 48;
    let toScore = candidates;
    if (candidates.length > embedLimit) {
        const leadCount = Math.min(8, embedLimit);
        const lexicalTop = candidates
            .map((c, idx) => ({ idx, lex: lexicalOverlap(query, c.text) }))
            .sort((a, b) => b.lex - a.lex)
            .slice(0, embedLimit - leadCount)
            .map((x) => x.idx);
        const keep = new Set<number>([
            ...Array.from({ length: leadCount }, (_, i) => i),
            ...lexicalTop,
        ]);
        toScore = [...keep]
            .sort((a, b) => a - b)
            .map((idx) => candidates[idx])
            .filter((c): c is (typeof candidates)[number] => c !== undefined);
    }

    const vectors = await embedder.embedDocuments(toScore.map((c) => c.text));
    const queryVector = await embedder.embedQuery(query);

    const ranked = toScore
        .map((c, i) => {
            const semantic = cosineSimilarity(queryVector, vectors[i] ?? []);
            const lexical = lexicalOverlap(query, c.text);
            return { ...c, score: semantic * semanticWeight + lexical * lexicalWeight };
        })
        .sort((a, b) => b.score - a.score);

    const topScore = ranked[0]?.score ?? 0;
    const cutoff = topScore * relativeThreshold;
    const relevant = ranked
        .filter((r) => r.score >= cutoff && r.score > 0.05)
        .slice(0, maxSentences);

    // Degenerate case: everything scores ~0 (no signal) — fall back to first sentences
    const picked =
        relevant.length > 0
            ? relevant.sort((a, b) => a.order - b.order)
            : candidates.slice(0, Math.min(maxSentences, candidates.length));

    const answer = picked
        .map((p) => p.text)
        .join(' ')
        .trim();
    const usedChunks = [...new Set(picked.map((p) => p.chunkIdx))].sort((a, b) => a - b);
    return { answer, usedChunks };
}
