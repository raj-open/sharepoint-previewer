// Markdown view: blocks, inline marks, links (safe, into the file's folder), escaping
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { ORIGIN } from '../helpers.ts';

const { markdownHtml, inlineHtml, slug } = await load('view/markdown.ts');

const BASE = `${ORIGIN}/sites/Test/Shared%20Documents/docs/`;
const html = (md: string) => markdownHtml(md, { base: BASE });

describe('view/markdown', () => {
    it('headings (ATX, setext) with anchors, paragraphs, rules', () => {
        assert.equal(html('# Hello World!'), '<h1 data-anchor="hello-world">Hello World!</h1>');
        assert.equal(html('Title\n==='), '<h1 data-anchor="title">Title</h1>');
        assert.equal(html('Sub\n---'), '<h2 data-anchor="sub">Sub</h2>');
        assert.equal(html('one\ntwo\n\nthree'), '<p>one\ntwo</p>\n<p>three</p>');
        assert.equal(html('***'), '<hr>');
    });
    it('inline: code, strong, emphasis, strikethrough, breaks, escapes', () => {
        assert.equal(
            inlineHtml('`a*b*` **b** *i* _j_ ~~x~~'),
            '<code>a*b*</code> <strong>b</strong> <em>i</em> <em>j</em> <del>x</del>',
        );
        assert.equal(inlineHtml('snake_case_name \\*no\\*'), 'snake_case_name *no*');
        assert.equal(inlineHtml('a  \nb'), 'a<br>\nb');
    });
    it('raw HTML is shown as text', () => {
        assert.equal(html('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
    });
    it('links: into the file folder, new tab; scripts dropped; anchors stay', () => {
        assert.equal(
            inlineHtml('[a `b`](x.md)', { base: BASE }),
            `<a href="${BASE}x.md" target="_blank" rel="noopener noreferrer">a <code>b</code></a>`,
        );
        assert.equal(inlineHtml('[a](javascript:alert(1))'), 'a');
        assert.equal(inlineHtml('[up](#intro)'), '<a href="#intro">up</a>');
        assert.match(inlineHtml('<https://example.com/a_b_c>'), /^<a href="https:\/\/example.com\/a_b_c"/);
    });
    it('images: from the site shown, from elsewhere only linked', () => {
        assert.match(
            inlineHtml('![logo](img/l.png)', { base: BASE }),
            /^<img src="[^"]*\/docs\/img\/l\.png" alt="logo"/,
        );
        assert.match(
            inlineHtml('![x](https://example.com/x.png)'),
            /^<a href="https:\/\/example.com\/x.png"[^>]*>🖼 x<\/a>$/,
        );
    });
    it('lists: tight, loose, nested, ordered with start, tasks', () => {
        assert.equal(html('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
        assert.equal(html('- a\n\n- b'), '<ul><li><p>a</p></li><li><p>b</p></li></ul>');
        assert.equal(html('- a\n  - b\n- c'), '<ul><li>a\n<ul><li>b</li></ul></li><li>c</li></ul>');
        assert.equal(html('3. a\n4. b'), '<ol start="3"><li>a</li><li>b</li></ol>');
        assert.match(
            html('- [x] done\n- [ ] open'),
            /<li class="tp-md-task"><input type="checkbox" disabled checked> done/,
        );
    });
    it('quotes, code (fenced with colours, indented), tables with alignment', () => {
        assert.equal(html('> a\n> b'), '<blockquote><p>a\nb</p></blockquote>');
        assert.equal(html('```\n<a>\n```'), '<pre><code>&lt;a&gt;</code></pre>');
        assert.match(markdownHtml('```json\n{"a": 1}\n```', { colour: true }), /<span class="tp-key">/);
        assert.equal(html('    x = 1'), '<pre><code>x = 1</code></pre>');
        assert.equal(
            html('| a | b |\n|:--|--:|\n| 1 | 2 |'),
            '<table><thead><tr><th style="text-align:left">a</th><th style="text-align:right">b</th></tr></thead>' +
                '<tbody><tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr></tbody></table>',
        );
    });
    it('slugs: lower case, words joined by -', () => assert.equal(slug('A <em>b</em> &amp; c!'), 'a-b-c'));
});
