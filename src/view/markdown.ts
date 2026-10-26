// Render: Markdown -> HTML (CommonMark core + GFM tables, task lists, strikethrough); raw HTML shown as text

// ===========================================================================
// IMPORTS
// ===========================================================================

import { esc } from '../_core/util.ts';
import { HIGHLIGHTERS } from '../text/highlight/index.ts';

/** @typedef {import('../_core/types.ts').LineView} LineView */
/** @typedef {{ colour?: boolean, base?: string }} MarkdownOptions */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Info strings of fenced code -> highlighter
/** @type {Object<string, string>} */
const CODE_LANGS = {
    python: 'py',
    javascript: 'js',
    yml: 'yaml',
    html: 'xml',
    svg: 'xml',
    markdown: 'md',
    powerquery: 'm',
    tsv: 'csv',
};

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const SETEXT_RE = /^ {0,3}(=+|-+)\s*$/;
const QUOTE_RE = /^ {0,3}> ?/;
const ITEM_RE = /^( {0,3})([-*+]|\d{1,9}[.)])(\s+|$)/;
const TABLE_RULE_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const UNSAFE_URL_RE = /^\s*(javascript|vbscript|data|file):/i;

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Inline: code, links, images, emphasis, line breaks
// ---------------------------------------------------------------------------

// Link target against the file's folder; null: not followed (scripts, data)
/** @param {string} url @param {string} base @returns {string|null} */
function resolveUrl(url, base) {
    if (UNSAFE_URL_RE.test(url)) return null;
    if (url.startsWith('#')) return url;
    try {
        return new URL(url, base || location.href).href;
    } catch {
        return null;
    }
}

// Same site: images from the library are shown, others only linked (nothing fetched from elsewhere)
/** @param {string} href @returns {boolean} */
const sameSite = (href) => href.startsWith(`${location.origin}/`);

/** @param {string} text @returns {string} */
export const slug = (text) =>
    text
        .toLowerCase()
        .replace(/<[^>]*>|&\w+;/g, '')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '-');

/** @param {string} text @param {MarkdownOptions} [opts] @param {string[]} [kept] finished HTML, out of reach of later rules @returns {string} */
export function inlineHtml(text, opts = {}, kept = []) {
    /** @param {string} html */
    const keep = (html) => `\uE000${kept.push(html) - 1}\uE000`;
    const base = opts.base || '';

    let s = text
        .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _q, code) =>
            keep(`<code>${esc(code.replace(/^ (.+) $/, '$1'))}</code>`),
        )
        .replace(/\\([!-/:-@[-`{-~])/g, (_, c) => keep(esc(c)))
        .replace(/!\[([^\]]*)\]\(\s*<?((?:[^\s()<>]|\([^\s()]*\))*)>?(?:\s+"([^"]*)")?\s*\)/g, (_, alt, url, title) => {
            const href = resolveUrl(url, base);
            if (!href) return keep(esc(alt));
            const t = title ? ` title="${esc(title)}"` : '';
            if (sameSite(href)) return keep(`<img src="${esc(href)}" alt="${esc(alt)}"${t} loading="lazy">`);
            return keep(
                `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"${t}>🖼 ${esc(alt || href)}</a>`,
            );
        })
        .replace(
            /\[([^\]]+)\]\(\s*<?((?:[^\s()<>]|\([^\s()]*\))*)>?(?:\s+"([^"]*)")?\s*\)/g,
            (_, label, url, title) => {
                const href = resolveUrl(url, base);
                const inner = inlineHtml(label, opts, kept);
                if (!href) return keep(inner);
                const t = title ? ` title="${esc(title)}"` : '';
                const target = href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"';
                return keep(`<a href="${esc(href)}"${target}${t}>${inner}</a>`);
            },
        )
        .replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, (_, url) =>
            keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`),
        );

    s = esc(s)
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
        .replace(/\*(?=\S)([\s\S]*?\S)\*|(^|[^\p{L}\p{N}_])_(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}_])/gu, (_, a, pre, b) =>
            a !== undefined ? `<em>${a}</em>` : `${pre}<em>${b}</em>`,
        )
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
        .replace(/(?: {2,}|\\)\n/g, '<br>\n');
    return s.replace(/\uE000(\d+)\uE000/g, (_, i) => kept[Number(i)]);
}

// ---------------------------------------------------------------------------
// Blocks: headings, paragraphs, lists, quotes, code, tables, rules
// ---------------------------------------------------------------------------

/** @param {string} line @returns {string[]} */
const tableCells = (line) =>
    line
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.trim());

/** @param {string} code @param {string} info @param {MarkdownOptions} opts @returns {string} */
function codeHtml(code, info, opts) {
    const lang = CODE_LANGS[info.toLowerCase()] || info.toLowerCase();
    const highlight = opts.colour ? HIGHLIGHTERS[lang] : null;
    if (!highlight) return esc(code);
    return highlight(code)
        .map(([cls, t]) => (cls ? `<span class="tp-${cls}">${esc(t)}</span>` : esc(t)))
        .join('');
}

// Starts a block other than a paragraph (ends a paragraph before it)
/** @param {string} line @returns {boolean} */
const opensBlock = (line) =>
    FENCE_RE.test(line) || HEADING_RE.test(line) || RULE_RE.test(line) || QUOTE_RE.test(line) || ITEM_RE.test(line);

/** @param {string[]} lines @param {MarkdownOptions} opts @returns {string} */
function blocksHtml(lines, opts) {
    /** @type {string[]} */
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const fence = FENCE_RE.exec(line);
        const heading = HEADING_RE.exec(line);
        if (!line.trim()) {
            i++;
        } else if (fence) {
            const end = lines.findIndex((l, j) => j > i && l.trimStart().startsWith(fence[1]));
            const stop = end < 0 ? lines.length : end;
            const code = lines.slice(i + 1, stop).join('\n');
            out.push(`<pre><code>${codeHtml(code, fence[2], opts)}</code></pre>`);
            i = stop + 1;
        } else if (heading) {
            const n = heading[1].length;
            const html = inlineHtml(heading[2] || '', opts);
            out.push(`<h${n} data-anchor="${esc(slug(html))}">${html}</h${n}>`);
            i++;
        } else if (RULE_RE.test(line)) {
            out.push('<hr>');
            i++;
        } else if (QUOTE_RE.test(line)) {
            const inner = [];
            while (i < lines.length && lines[i].trim() && (QUOTE_RE.test(lines[i]) || !opensBlock(lines[i])))
                inner.push(lines[i++].replace(QUOTE_RE, ''));
            out.push(`<blockquote>${blocksHtml(inner, opts)}</blockquote>`);
        } else if (ITEM_RE.test(line)) {
            i = listHtml(lines, i, opts, out);
        } else if (line.includes('|') && TABLE_RULE_RE.test(lines[i + 1] || '') && lines[i + 1].includes('-')) {
            const head = tableCells(line);
            const align = tableCells(lines[i + 1]).map((c) =>
                c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : c.startsWith(':') ? 'left' : '',
            );
            /** @param {string[]} cells @param {string} tag */
            const row = (cells, tag) =>
                cells
                    .map((c, j) => {
                        const a = align[j] ? ` style="text-align:${align[j]}"` : '';
                        return `<${tag}${a}>${inlineHtml(c, opts)}</${tag}>`;
                    })
                    .join('');
            const body = [];
            i += 2;
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(tableCells(lines[i++]));
            const rows = body.map((r) => `<tr>${row(r.slice(0, head.length), 'td')}</tr>`).join('');
            out.push(`<table><thead><tr>${row(head, 'th')}</tr></thead><tbody>${rows}</tbody></table>`);
        } else if (/^ {4}/.test(line)) {
            const code = [];
            while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) code.push(lines[i++].slice(4));
            while (code.length && !code[code.length - 1].trim()) code.pop();
            out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
        } else {
            const para = [line];
            i++;
            while (i < lines.length && lines[i].trim() && !opensBlock(lines[i]) && !SETEXT_RE.test(lines[i]))
                para.push(lines[i++]);
            const setext = i < lines.length && SETEXT_RE.exec(lines[i]);
            const html = inlineHtml(para.map((l) => l.replace(/^\s+/, '')).join('\n'), opts);
            if (setext) {
                const n = setext[1][0] === '=' ? 1 : 2;
                out.push(`<h${n} data-anchor="${esc(slug(html))}">${html}</h${n}>`);
                i++;
            } else out.push(`<p>${html}</p>`);
        }
    }
    return out.join('\n');
}

// List from line `start`: items of one kind, their lines dedented to the item's text; returns next line
/** @param {string[]} lines @param {number} start @param {MarkdownOptions} opts @param {string[]} out @returns {number} */
function listHtml(lines, start, opts, out) {
    const first = /** @type {RegExpExecArray} */ (ITEM_RE.exec(lines[start]));
    const ordered = /\d/.test(first[2]);
    const marker = ordered ? first[2].slice(-1) : first[2];
    /** @type {string[][]} */
    const items = [];
    let loose = false;
    let i = start;
    while (i < lines.length) {
        const m = ITEM_RE.exec(lines[i]);
        if (!m || (ordered ? m[2].slice(-1) !== marker : m[2] !== marker)) break;
        const pad = ' '.repeat(Math.max(m[0].length, m[1].length + m[2].length + 1)); // text column of the item
        const item = [lines[i].slice(m[0].length)];
        for (i++; i < lines.length; i++) {
            const l = lines[i];
            const next = lines[i + 1];
            if (l.startsWith(pad)) item.push(l.slice(pad.length));
            else if (l.trim() && !opensBlock(l) && item[item.length - 1].trim())
                item.push(l); // lazy line
            else if (l.trim() || next === undefined || !(next.startsWith(pad) || ITEM_RE.test(next))) break;
            else {
                loose = true; // blank line inside the list
                item.push('');
            }
        }
        items.push(item);
    }
    const startAt = ordered && Number.parseInt(first[2], 10) !== 1 ? ` start="${Number.parseInt(first[2], 10)}"` : '';
    const html = items.map((item) => {
        const task = /^\[([ xX])\]\s+/.exec(item[0]);
        if (task) item[0] = item[0].slice(task[0].length);
        let body = blocksHtml(item, opts);
        if (!loose) body = body.replace(/<p>([\s\S]*?)<\/p>/g, '$1');
        const box = task ? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ` : '';
        const cls = task ? ' class="tp-md-task"' : '';
        return `<li${cls}>${box}${body}</li>`;
    });
    const tag = ordered ? 'ol' : 'ul';
    out.push(`<${tag}${startAt}>${html.join('')}</${tag}>`);
    return i;
}

/** @param {string} text @param {MarkdownOptions} [opts] @returns {string} */
export function markdownHtml(text, opts = {}) {
    return blocksHtml(text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'), opts);
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

// Whole document at once (Markdown files are small); links to headings scroll within the view
/** @param {HTMLElement} content @param {string} text @param {MarkdownOptions} [opts] @returns {LineView} */
export function mountMarkdown(content, text, opts = {}) {
    const doc = document.createElement('div');
    doc.className = 'tp-md';
    doc.innerHTML = markdownHtml(text, opts);
    doc.addEventListener('click', (e) => {
        const a = /** @type {HTMLElement} */ (e.target).closest('a[href^="#"]');
        if (!a) return;
        e.preventDefault();
        const name = decodeURIComponent((a.getAttribute('href') || '').slice(1)).toLowerCase();
        doc.querySelector(`[data-anchor="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'start' });
    });
    content.replaceChildren(doc);
    return { stop: () => {}, show: () => {} };
}
