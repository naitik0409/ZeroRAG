import { describe, expect, it } from 'vitest';

import { decodeEntities, htmlToText } from '../src/index.js';

describe('htmlToText', () => {
    it('strips scripts, styles, and comments', () => {
        const html = `
            <html><head><style>body { color: red }</style>
            <script>alert('x')</script></head>
            <body><!-- invisible --><p>Hello world</p></body></html>`;
        const text = htmlToText(html);
        expect(text).toBe('Hello world');
        expect(text).not.toContain('color');
        expect(text).not.toContain('alert');
        expect(text).not.toContain('invisible');
    });

    it('converts block elements to newlines and decodes entities', () => {
        const html = '<h1>Title</h1><p>Line &amp; one</p><p>Line &lt;two&gt;</p><li>item</li>';
        const text = htmlToText(html);
        expect(text).toContain('Title');
        expect(text).toContain('Line & one');
        expect(text).toContain('Line <two>');
        expect(text).toContain('- item');
        expect(text.split('\n').length).toBeGreaterThanOrEqual(4);
    });

    it('collapses runs of whitespace but keeps structure', () => {
        const text = htmlToText('<p>  a \t b  </p><p>c</p>');
        expect(text).toBe('a b\nc');
    });

    it('handles numeric and named entities', () => {
        expect(decodeEntities('&#8212;&#x2014;&nbsp;&hellip;')).toBe('—— …');
        expect(decodeEntities('&copy; &quot;quoted&quot;')).toBe('© "quoted"');
    });

    it('leaves unknown entities untouched', () => {
        expect(decodeEntities('&unknownentity;')).toBe('&unknownentity;');
    });
});
