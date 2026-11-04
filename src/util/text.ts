/** Cosine similarity between two vectors. Returns 0 if either is empty. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        dot += x * y;
        normA += x * x;
        normB += y * y;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Convert a distance returned by LanceDB into a 0..1-ish similarity score. */
export function distanceToScore(distance: number, distanceType: 'cosine' | 'l2' = 'cosine'): number {
    if (!Number.isFinite(distance)) return 0;
    if (distanceType === 'cosine') {
        // cosine distance = 1 - cosine similarity
        return 1 - distance;
    }
    // L2 / squared L2: monotonic decay into (0, 1]
    return 1 / (1 + distance);
}

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 0);
}

/** Fraction of query tokens present in text (0..1). */
export function lexicalOverlap(query: string, text: string): number {
    const q = tokenize(query);
    if (q.length === 0) return 0;
    const set = new Set(tokenize(text));
    let hit = 0;
    for (const t of q) if (set.has(t)) hit++;
    return hit / q.length;
}
