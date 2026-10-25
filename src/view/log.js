// Log table (experimental): entries and fields guessed from the log's lines

// ===========================================================================
// IMPORTS
// ===========================================================================

import { LOG_LEVELS } from '../text/highlight/log.js';

/** @typedef {import('../_core/types.js').LogTable} LogTable */

// ===========================================================================
// CONSTANTS
// ===========================================================================

const SAMPLE_LINES = 1000; // lines looked at to find the fields
const MAX_FIELDS = 6;
const MIN_STARTS = 0.2; // share of lines that must start an entry
const MIN_SHARED = 0.8; // share of entries a field must be in

// Level words, any case (as in the highlighter)
const LEVEL_WORDS = Object.values(LOG_LEVELS).flat().join('|');

// Fields at the start of an entry (sticky); groups: the value
/** @type {[string, RegExp][]} */
const FIELDS = [
    [
        'time',
        new RegExp(
            [
                /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/.source, // ISO 8601
                /\d{1,2}[./]\d{1,2}[./]\d{2,4}(?:[ ,]+\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)?/.source, // 24.10.2026
                /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2} \d{2}:\d{2}:\d{2}/.source, // syslog
                /\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/.source, // time
            ]
                .join('|')
                .replace(/^(.*)$/, '\\[?($1)\\]?(?![\\w:])'),
            'y',
        ),
    ],
    ['level', new RegExp(`\\[?(${LEVEL_WORDS})\\]?(?![\\w-])`, 'iy')],
    ['context', /[[(]([^\])\n]*)[\])]/y], // [thread], (module)
    ['name', /([A-Za-z_$][\w.$/-]*(?:\[\d+\])?)(?=[ \t]*(?:[-|][ \t]|:|\t))/y], // logger, process[pid]: before a separator
];
const SEP_RE = /[ \t]*(?:[-|][ \t]+|:[ \t]*)?[ \t]*/y; // between fields: spaces, " - ", " | ", ":"

// ===========================================================================
// METHODS
// ===========================================================================

// Log text -> table: line of the entry, fields, message (continuation lines joined); null: no fields found
/** @param {string} text @returns {LogTable|null} */
export function parseLog(text) {
    const lines = text.split(/\r?\n/);
    const kinds = template(lines.slice(0, SAMPLE_LINES));
    if (!kinds) return null;
    const header = ['line', ...names(kinds), 'message'];
    /** @type {string[][]} */
    const rows = [];
    lines.forEach((line, i) => {
        const head = /^\s/.test(line) ? null : readHead(line);
        const last = rows[rows.length - 1];
        if (head && head.kinds[0] === kinds[0]) {
            const row = [String(i + 1), ...kinds.map(() => '')];
            let k = 0;
            for (let f = 0; f < head.kinds.length && k < kinds.length; f++) {
                while (k < kinds.length && kinds[k] !== head.kinds[f]) k++;
                if (k < kinds.length) row[++k] = head.values[f];
            }
            row.push(line.slice(head.end));
            rows.push(row);
        } else if (last) last[last.length - 1] += `\n${line}`;
        else if (line.trim()) rows.push([String(i + 1), ...kinds.map(() => ''), line]); // lines before the first entry
    });
    for (const row of rows) row[row.length - 1] = row[row.length - 1].replace(/\s+$/, '');
    return { header, rows, kinds };
}

// Level class of a value ('lv-err', ...), as in the highlighter; '' if none
/** @param {string} value @returns {string} */
export function levelClass(value) {
    const word = value.toUpperCase();
    const entry = Object.entries(LOG_LEVELS).find(([, words]) => words.includes(word));
    return entry ? entry[0] : '';
}

// ===========================================================================
// AUXILIARY METHODS
// ===========================================================================

// Fields at the start of a line: kinds, values, end of the head
/** @param {string} line @returns {{ kinds: string[], values: string[], end: number }|null} */
function readHead(line) {
    /** @type {string[]} */
    const kinds = [];
    /** @type {string[]} */
    const values = [];
    let at = 0;
    while (kinds.length < MAX_FIELDS) {
        const found = FIELDS.find(([kind, re]) => {
            if (kind !== 'context' && kinds.includes(kind)) return false; // brackets may repeat
            re.lastIndex = at;
            return re.test(line);
        });
        if (!found) break;
        const [kind, re] = found;
        re.lastIndex = at;
        const m = /** @type {RegExpExecArray} */ (re.exec(line)); // matched just above
        kinds.push(kind);
        values.push(m[1]);
        SEP_RE.lastIndex = at + m[0].length;
        SEP_RE.test(line);
        at = SEP_RE.lastIndex;
    }
    return kinds.length ? { kinds, values, end: at } : null;
}

// Fields shared by the entries: first field starts enough lines, then the longest run most entries share
/** @param {string[]} lines @returns {string[]|null} */
function template(lines) {
    const filled = lines.filter((l) => l.trim());
    const heads = filled.filter((l) => !/^\s/.test(l)).map(readHead);
    /** @type {Map<string, number>} */
    const firsts = new Map();
    for (const h of heads) if (h) firsts.set(h.kinds[0], (firsts.get(h.kinds[0]) || 0) + 1);
    const [first, count] = [...firsts].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    if (count < 2 || count < filled.length * MIN_STARTS) return null;
    const entries = /** @type {{ kinds: string[] }[]} */ (heads.filter((h) => h?.kinds[0] === first));
    const kinds = [first];
    while (kinds.length < MAX_FIELDS) {
        /** @type {Map<string, number>} */
        const next = new Map();
        for (const e of entries) {
            const same = kinds.every((k, i) => e.kinds[i] === k);
            const k = same ? e.kinds[kinds.length] : undefined;
            if (k) next.set(k, (next.get(k) || 0) + 1);
        }
        const [kind, n] = [...next].sort((a, b) => b[1] - a[1])[0] || ['', 0];
        if (n < entries.length * MIN_SHARED) break;
        kinds.push(kind);
    }
    return kinds.length > 1 || first === 'time' || first === 'level' ? kinds : null;
}

// Column names of the fields: context, context 2, ...
/** @param {string[]} kinds @returns {string[]} */
function names(kinds) {
    /** @type {Map<string, number>} */
    const seen = new Map();
    return kinds.map((k) => {
        const n = (seen.get(k) || 0) + 1;
        seen.set(k, n);
        return n > 1 ? `${k} ${n}` : k;
    });
}
