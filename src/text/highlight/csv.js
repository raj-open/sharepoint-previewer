// CSV highlighting: delimiter detection, column colours

// ===========================================================================
// IMPORTS
// ===========================================================================

import { parseCsv } from '../../view/table.js';

/** @typedef {import('../../_core/types.js').Token} Token */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// CSV: one colour per column (cycles); "quoted" fields may hold separators, "" and breaks
/** @type {Object<string, string>} */
export const SEPARATOR_NAMES = {
    ',': 'comma',
    ';': 'semicolon',
    '\t': 'tab',
    '  ': '2 spaces',
    '    ': '4 spaces',
    '        ': '8 spaces',
};
export const CSV_COLOURS = ['key', 'str', 'num', 'type', 'enum', 'meta', 'anchor', 'attr'];

// ===========================================================================
// METHODS
// ===========================================================================

// Delimiter: , ; or tab, one in every first line most often (ties: that order);
// else widest run of spaces that splits all lines alike
/** @param {string} text @returns {string} ',' ';' tab, or a run of spaces */
export function csvSeparator(text) {
    const lines = text
        .split('\n', 6)
        .filter((l) => l.trim())
        .slice(0, 5);
    let best = ',';
    let bestScore = -1;
    for (const sep of [',', ';', '\t']) {
        const counts = lines.map((line) => {
            let n = 0;
            let quoted = false;
            for (const c of line) {
                if (c === '"') quoted = !quoted;
                else if (c === sep && !quoted) n++;
            }
            return n;
        });
        const score = counts.length ? Math.min(...counts) : 0;
        if (score > bestScore) {
            bestScore = score;
            best = sep;
        }
    }
    if (bestScore > 0) return best;
    // Spaces: widest gap that splits every line into same number (> 1) of columns
    for (const sep of ['        ', '    ', '  ']) {
        const counts = new Set(parseCsv(lines.join('\n'), sep).map((r) => r.length));
        if (lines.length && counts.size === 1 && !counts.has(1)) return sep;
    }
    return best;
}

/** @param {string} text @returns {Token[]} */
export function highlightCsv(text) {
    const sep = csvSeparator(text);
    /** @type {Token[]} */
    const out = [];
    let col = 0;
    let field = '';
    let quoted = false;

    const flush = () => {
        if (field) out.push([CSV_COLOURS[col % CSV_COLOURS.length], field]);
        field = '';
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            field += c;
            if (c === '"') {
                if (text[i + 1] === '"')
                    field += text[++i]; // "" inside quotes
                else quoted = false;
            }
        } else if (c === '"') {
            field += c;
            quoted = true;
        } else if (c === sep) {
            flush();
            out.push(['punct', c]);
            col++;
        } else if (c === '\n') {
            flush();
            out.push(['', c]);
            col = 0;
        } else {
            field += c;
        }
    }
    flush();
    return out;
}
