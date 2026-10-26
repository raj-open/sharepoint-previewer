// Log table (experimental): entries and fields guessed from the log's lines; rows expand into text, JSON and lists

// ===========================================================================
// IMPORTS
// ===========================================================================

import { esc } from '../_core/util.ts';
import { highlightJson } from '../text/highlight/json.ts';
import { LOG_LEVELS } from '../text/highlight/log.ts';
import { indentJson } from '../text/segments.ts';
import { segments } from '../text/segments.ts';

import type { LogTable } from '../_core/types.ts';
import type { Segment } from '../text/segments.ts';

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
const FIELDS: [string, RegExp][] = [
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
const SEGMENT_LABELS: Record<string, string> = { json: 'JSON', python: 'Python' };

// ===========================================================================
// METHODS
// ===========================================================================

// Log text -> table: line of the entry, fields, message (continuation lines joined); null: no fields found
export function parseLog(text: string): LogTable | null {
    const lines = text.split(/\r?\n/);
    const kinds = template(lines.slice(0, SAMPLE_LINES));
    if (!kinds) return null;
    const header = ['line', ...names(kinds), 'message'];
    const rows: string[][] = [];
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
export const hasFields = (lines: string[]): boolean => !!template(lines.slice(0, SAMPLE_LINES));

// Level class of a value ('lv-err', ...), as in the highlighter; '' if none
export function levelClass(value: string): string {
    const word = value.toUpperCase();
    const entry = Object.entries(LOG_LEVELS).find(([, words]) => words.includes(word));
    return entry ? entry[0] : '';
}

// Expand of a log table's rows: messages with objects, lists or several lines; segments worked out once per row
export function logExpand(
    rows: string[][],
    colour: boolean,
): { can: (i: number) => boolean; html: (i: number) => string; title: string } {
    const cache: Map<number, Segment[]> = new Map();
    const message = (i: number) => rows[i][rows[i].length - 1];
    const parts = (i: number): Segment[] => {
        if (!cache.has(i))
            cache.set(i, /[{[]/.test(message(i)) ? segments(message(i)) : [{ kind: 'text', text: message(i) }]);
        return cache.get(i) as Segment[]; // set just above
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
function segmentHtml(s: Segment, colour: boolean): string {
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
function readHead(line: string): { kinds: string[]; values: string[]; ends: number[] } | null {
    const kinds: string[] = [];
    const values: string[] = [];
    const ends: number[] = []; // after each field and its separator
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
function field(line: string, at: number, found: string[]): { kind: string; value: string; end: number } | null {
    for (const [kind, re] of FIELDS) {
        if (kind !== 'context' && found.includes(kind)) continue;
        re.lastIndex = at;
        const m = re.exec(line);
        if (m) return { kind, value: m[1], end: at + m[0].length };
    }
    return null;
}

// Fields shared by the entries: first field starts enough lines, then the longest run most entries share
function template(lines: string[]): string[] | null {
    const filled = lines.filter((l) => l.trim());
    const heads = filled.filter((l) => !/^\s/.test(l)).map(readHead);
    const firsts: Map<string, number> = new Map();
    for (const h of heads) if (h) firsts.set(h.kinds[0], (firsts.get(h.kinds[0]) || 0) + 1);
    const [first, count] = [...firsts].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const strong = first === 'time' || first === 'level'; // printed output in between may outweigh the entries
    if (count < 2 || (!strong && count < filled.length * MIN_STARTS)) return null;
    const entries = heads.filter((h) => h?.kinds[0] === first) as { kinds: string[] }[];
    const kinds = [first];
    while (kinds.length < MAX_FIELDS) {
        const next: Map<string, number> = new Map();
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
function names(kinds: string[]): string[] {
    const seen: Map<string, number> = new Map();
    return kinds.map((k) => {
        const n = (seen.get(k) || 0) + 1;
        seen.set(k, n);
        return n > 1 ? `${k} ${n}` : k;
    });
}
