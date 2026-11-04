const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    copy: '©',
    reg: '®',
    trade: '™',
    euro: '€',
    pound: '£',
    deg: '°',
    middot: '·',
    bull: '•',
};

export function decodeEntities(text: string): string {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
        .replace(
            /&([a-z]+);/gi,
            (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
        );
}

function safeCodePoint(code: number): string {
    try {
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : '';
    } catch {
        return '';
    }
}

/**
 * Lightweight HTML → readable text. Removes scripts/styles/chrome,
 * converts block elements to newlines, decodes entities.
 */
export function htmlToText(html: string): string {
    let out = html;

    // Drop non-content blocks entirely
    out = out.replace(
        /<(script|style|noscript|svg|iframe|template|form|button)[^>]*>[\s\S]*?<\/\1>/gi,
        ' ',
    );
    // Comments
    out = out.replace(/<!--[\s\S]*?-->/g, ' ');
    // <li> as list items
    out = out.replace(/<li[^>]*>/gi, '\n- ');
    // Block-level boundaries → newlines
    out = out.replace(
        /<\/?(p|div|br|ul|ol|tr|td|th|h[1-6]|section|article|header|footer|nav|main|aside|blockquote|figcaption|pre|hr)[^>]*\/?>/gi,
        '\n',
    );
    // Strip everything else
    out = out.replace(/<[^>]+>/g, ' ');
    out = decodeEntities(out);

    return out
        .split('\n')
        .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n')
        .trim();
}
