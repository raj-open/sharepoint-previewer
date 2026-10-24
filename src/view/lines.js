// Render: tokens -> one <div> per line, with line numbers and problem marks

// ===========================================================================
// IMPORTS
// ===========================================================================

import { SHOW_WHITESPACE } from '../_core/settings.js';
import { esc } from '../_core/util.js';

/** @typedef {import('../_core/types.js').Token} Token */
/** @typedef {import('../_core/types.js').Problem} Problem */
/** @typedef {import('../_core/types.js').LineView} LineView */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Big views in blocks of CHUNK_LINES: only blocks near visible area are filled
export const CHUNK_LINES = 200;

// ===========================================================================
// METHODS
// ===========================================================================

// Whitespace markers (CSS only, copied text unchanged): · per space, → per tab
/** @param {string} html @returns {string} */
function markWhitespace(html) {
    if (!SHOW_WHITESPACE) return html;
    return html.replace(/ +|\t/g, (ws) =>
        ws === '\t' ? '<span class="tp-tab">\t</span>' : `<span class="tp-sp">${ws}</span>`,
    );
}

// Fill blocks when they come near visible part of `root`, empties them when far away
/** @param {HTMLElement} root @param {HTMLElement[]} blocks @param {(b: HTMLElement) => void} fill @param {(b: HTMLElement) => void} empty @returns {IntersectionObserver} */
export function watchBlocks(root, blocks, fill, empty) {
    const io = new IntersectionObserver(
        (entries) => {
            for (const e of entries) (e.isIntersecting ? fill : empty)(/** @type {HTMLElement} */ (e.target));
        },
        { root, rootMargin: '1500px 0px' },
    );
    for (const b of blocks) io.observe(b);
    return io;
}

/** @param {HTMLElement} content @param {string[]} lineHtml @returns {LineView} */
export function mountLines(content, lineHtml) {
    const holder = document.createElement('div');
    holder.className = 'tp-lines';
    content.replaceChildren(holder);
    const lineHeight = parseFloat(getComputedStyle(content).lineHeight) || 19;

    /** @type {HTMLElement[]} */
    const chunks = [];
    for (let from = 0; from < lineHtml.length; from += CHUNK_LINES) {
        const box = document.createElement('div');
        const count = Math.min(CHUNK_LINES, lineHtml.length - from);
        box.style.height = `${count * lineHeight}px`;
        box.dataset.from = String(from);
        box.dataset.count = String(count);
        holder.append(box);
        chunks.push(box);
    }

    /** @param {HTMLElement} box */
    const fill = (box) => {
        if (box.dataset.on) return;
        const from = Number(box.dataset.from);
        box.innerHTML = lineHtml.slice(from, from + Number(box.dataset.count)).join('');
        box.style.height = '';
        box.dataset.on = '1';
    };

    /** @param {HTMLElement} box */
    const empty = (box) => {
        if (!box.dataset.on) return;
        box.style.height = `${box.getBoundingClientRect().height}px`; // keep its place
        box.replaceChildren();
        delete box.dataset.on;
    };

    const io = watchBlocks(content, chunks, fill, empty);

    return {
        stop: () => io.disconnect(),
        show: (line) => {
            const box = chunks[Math.floor((line - 1) / CHUNK_LINES)];
            if (box) fill(box);
        },
    };
}

/** @param {Token[]} tokens @param {Map<number, Problem[]>} problemsByLine @param {Map<number, number>} [truncated] @returns {string[]} one HTML string per line */
export function renderLines(tokens, problemsByLine, truncated = new Map()) {
    /** @type {string[]} */
    const out = [];
    let n = 1;
    let cur = '';

    const flush = () => {
        const p = problemsByLine.get(n);
        const cls = p ? (p.some((x) => x.severity === 'error') ? ' tp-err' : ' tp-warn') : '';
        const title = p ? ` title="${esc(p.map((x) => x.msg).join('\n'))}"` : '';
        const cut = truncated.get(n);
        const tail = cut ? `<span class="tp-trunc"> … ${cut.toLocaleString()} more characters</span>` : '';
        out.push(
            `<div class="tp-line${cls}" data-line="${n}"${title}>` +
                `<span class="tp-ln">${n}</span><span class="tp-code">${cur || ' '}${tail}</span></div>`,
        );
        n++;
        cur = '';
    };
    for (const [cls, val] of tokens) {
        const parts = val.split('\n');
        for (let i = 0; i < parts.length; i++) {
            if (i) flush();
            if (parts[i]) {
                const html = markWhitespace(esc(parts[i]));
                cur += cls ? `<span class="tp-${cls}">${html}</span>` : html;
            }
        }
    }
    flush();
    return out; // one HTML string per line
}
