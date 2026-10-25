// Log table (experimental): entries and fields guessed from the log's lines; rows expand into text, JSON and lists

// ===========================================================================
// IMPORTS
// ===========================================================================

import { esc } from '../_core/util.js';
import { highlightJson } from '../text/highlight/json.js';
import { LOG_LEVELS } from '../text/highlight/log.js';
import { indentJson } from '../text/segments.js';
import { segments } from '../text/segments.js';

/** @typedef {import('../_core/types.js').LogTable} LogTable */
/** @typedef {import('../text/segments.js').Segment} Segment */

// ===========================================================================
// CONSTANTS
// ===========================================================================

const SAMPLE_LINES = 20000; // lines looked at to find the fields
const MAX_FIELDS = 6;
const MIN_STARTS = 0.2; // share of lines that must start an entry (unless it starts with a time or level)
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
const WORD_RE = /[^\s[\]()]+(?=[ \t])/y; // source (e.g. host, worker): a word, counted only if a field follows
const EXPAND_TITLE = 'Expand: message split into text, JSON and lists';
/** @type {Object<string, string>} */
const SEGMENT_LABELS = { json: 'JSON', python: 'Python' };

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
            // fields in the order of the columns (missing ones left empty); the rest of the line is the message
            const row = [String(i + 1), ...kinds.map(() => '')];
            let end = 0;
            for (let f = 0, k = 0; f < head.kinds.length; f++) {
                const at = kinds.indexOf(head.kinds[f], k);
                if (at < 0) break;
                row[at + 1] = head.values[f];
                end = head.ends[f];
                k = at + 1;
            }
            row.push(line.slice(end));
            rows.push(row);
        } else if (last) last[last.length - 1] += `\n${line}`;
        else if (line.trim()) rows.push([String(i + 1), ...kinds.map(() => ''), line]); // lines before the first entry
    });
    for (const row of rows) row[row.length - 1] = row[row.length - 1].replace(/\s+$/, '');
    return { header, rows, kinds };
}

// Fields found in the first lines (whether the table view is offered)
/** @param {string[]} lines @returns {boolean} */
export const hasFields = (lines) => !!template(lines.slice(0, SAMPLE_LINES));

// Level class of a value ('lv-err', ...), as in the highlighter; '' if none
/** @param {string} value @returns {string} */
export function levelClass(value) {
    const word = value.toUpperCase();
    const entry = Object.entries(LOG_LEVELS).find(([, words]) => words.includes(word));
    return entry ? entry[0] : '';
}

// Expand of a log table's rows: messages with objects, lists or several lines; segments worked out once per row
/** @param {string[][]} rows @param {boolean} colour @returns {{ can: (i: number) => boolean, html: (i: number) => string, title: string }} */
export function logExpand(rows, colour) {
    /** @type {Map<number, Segment[]>} */
    const cache = new Map();
    /** @param {number} i */
    const message = (i) => rows[i][rows[i].length - 1];
    /** @param {number} i @returns {Segment[]} */
    const parts = (i) => {
        if (!cache.has(i))
            cache.set(i, /[{[]/.test(message(i)) ? segments(message(i)) : [{ kind: 'text', text: message(i) }]);
        return /** @type {Segment[]} */ (cache.get(i)); // set just above
    };
    return {
        title: EXPAND_TITLE,
        can: (i) => message(i).includes('\n') || parts(i).some((s) => s.kind !== 'text'),
        html: (i) =>
            parts(i)
                .map((s) => segmentHtml(s, colour))
                .join(''),
    };
}

// ===========================================================================
// AUXILIARY METHODS
// ===========================================================================

// One segment: text as is (blank lines at its ends dropped), objects and lists labelled and indented
/** @param {Segment} s @param {boolean} colour @returns {string} */
function segmentHtml(s, colour) {
    if (s.kind === 'text') return `<div class="tp-seg"><pre>${esc(s.text.replace(/^\s*\n|\s+$/g, ''))}</pre></div>`;
    const json = indentJson(s.text);
    const body = colour
        ? highlightJson(json)
              .map(([cls, x]) => (cls ? `<span class="tp-${cls}">${esc(x)}</span>` : esc(x)))
              .join('')
        : esc(json);
    const what = s.text.startsWith('{') ? (s.kind === 'json' ? 'object' : 'dict') : 'list';
    return `<div class="tp-seg"><div class="tp-seg-label">${SEGMENT_LABELS[s.kind]} ${what}</div><pre>${body}</pre></div>`;
}

// Fields at the start of a line: kinds, values, end of the head
/** @param {string} line @returns {{ kinds: string[], values: string[], ends: number[] }|null} */
function readHead(line) {
    /** @type {string[]} */
    const kinds = [];
    /** @type {string[]} */
    const values = [];
    /** @type {number[]} */
    const ends = []; // after each field and its separator
    let at = 0;
    while (kinds.length < MAX_FIELDS) {
        let m = field(line, at, kinds);
        if (m) {
            kinds.push(m.kind);
            values.push(m.value);
        } else if (kinds.length && !kinds.includes('source')) {
            WORD_RE.lastIndex = at;
            const word = WORD_RE.exec(line)?.[0];
            const next = word ? line.slice(at + word.length).match(/^[ \t]+/)?.[0] : '';
            if (!word || !next || !field(line, at + word.length + next.length, [...kinds, 'time'])) break;
            m = { kind: 'source', value: word, end: at + word.length };
            kinds.push('source');
            values.push(word);
        } else break;
        SEP_RE.lastIndex = m.end;
        SEP_RE.test(line);
        at = SEP_RE.lastIndex;
        ends.push(at);
    }
    return kinds.length ? { kinds, values, ends } : null;
}

// Field at a position (kinds already found are not looked for again, brackets may repeat)
/** @param {string} line @param {number} at @param {string[]} found @returns {{ kind: string, value: string, end: number }|null} */
function field(line, at, found) {
    for (const [kind, re] of FIELDS) {
        if (kind !== 'context' && found.includes(kind)) continue;
        re.lastIndex = at;
        const m = re.exec(line);
        if (m) return { kind, value: m[1], end: at + m[0].length };
    }
    return null;
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
    const strong = first === 'time' || first === 'level'; // printed output in between may outweigh the entries
    if (count < 2 || (!strong && count < filled.length * MIN_STARTS)) return null;
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
    return kinds.length > 1 || strong ? kinds : null;
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
