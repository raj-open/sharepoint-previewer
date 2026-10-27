// Power BI (.pbix, .pbit, .pbiviz): overview (Markdown), parts and Power Query scripts to choose from (read only)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { formatBytes } from '../_core/util.ts';
import { langOf } from '../text/lang.ts';
import { indentJson } from '../text/segments.ts';
import { dataView } from './bytes.ts';
import { utf8 } from './bytes.ts';
import { openRanges } from './ranges.ts';
import { zipEntries } from './zip.ts';
import { sniffText } from './text.ts';
import { zipEntryBytes } from './zip.ts';

import type { ArchivePart } from '../_core/types.ts';
import type { Source } from '../_core/types.ts';
import type { ByteReader } from '../_core/types.ts';
import type { ZipEntry } from '../_core/types.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** query: name and M expression (`let … in …`, or a value with `meta […]`) */
type Query = { name: string; body: string };
type Node = { size: number | null; kids: Map<string, Node> };

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const PBIX_RE = /\.(pbix|pbit|pbiviz)$/i;
const MAX_PART_BYTES = 16 * 1024 * 1024; // larger parts are listed, not read
const STRING_RE = /"(?:\\.|[^"\\])*"/g;

// Parts with notes in the tree
const NOTES: Record<string, string> = {
    datamodel: 'data, not readable',
    datamashup: 'Power Query',
    datamodelschema: 'model as JSON',
};

const SHARED_RE = /^\s*(?:\[[\s\S]*?\]\s*)?shared\s+(#"(?:[^"]|"")*"|[\w.]+)\s*=\s*([\s\S]*)$/;
const META_RE = /\bmeta\s*\[([^\]]*)\]\s*$/;

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

// Directory and parts are fetched by range, each part read once (never the data model)
export async function openPbixSource(
    url: string,
    getSignal: () => AbortSignal,
    reload: boolean,
    onProgress: (loaded: number, total: number) => void,
    ask: (bytes: number) => boolean = () => true,
): Promise<Source | { error: string }> {
    const file = await openRanges(url, getSignal, reload, onProgress);
    if ('error' in file) return file;
    let parts: ArchivePart[];
    let queries: Query[];
    let overview: string;
    let empty = ''; // why the queries list is empty
    try {
        const entries = (await zipEntries(file.read, file.size)).filter((e) => !e.name.endsWith('/'));
        const bytes = entries.filter(readable).reduce((n, e) => n + e.packed, 0);
        if (!ask(bytes)) return { error: `Not opened: ${formatBytes(bytes)} of parts to read.` };
        queries = await pbixQueries(file.read, entries);
        overview = pbixMarkdown(entries, queries);
        if (noQueries(entries, queries)) empty = 'No queries read: see the overview';
        parts = [];
        for (const e of entries) parts.push(await entryPart(file.read, e));
    } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        return { error: `Not a valid Power BI file (${(err as Error).message})` };
    }
    const scripts = queries.map((q) => ({
        name: q.name,
        note: parameterOf(q) ? 'parameter' : '',
        lang: 'm',
        text: q.body,
    }));
    return {
        total: file.size,
        loaded: file.size,
        done: true,
        isZip: true, // read only
        dates: file.dates,
        info: [['archive', `Power BI, ${parts.length} parts (${formatBytes(file.fetched())} read)`]],
        text: overview,
        parts: [
            { label: 'Parts', items: [{ name: 'Overview', note: '', lang: 'md', text: overview }, ...parts] },
            { label: 'Queries', items: scripts, empty },
        ],
        part: { list: 0, item: 0 },
        more: async () => {},
        loadAll: async () => {},
    };
}

// Parts read: all but the data model and very large ones
const readable = (e: ZipEntry): boolean => e.name.toLowerCase() !== 'datamodel' && e.size <= MAX_PART_BYTES;

// Part as text (language from its name, else from its start); null: not plain text, data model, too large
async function entryPart(read: ByteReader, e: ZipEntry): Promise<ArchivePart> {
    const key = e.name.toLowerCase();
    const size = formatBytes(e.size);
    if (!readable(e)) {
        const why = key === 'datamodel' ? 'data, not readable' : 'too large';
        return { name: e.name, note: `${size}, ${why}`, lang: null, text: null };
    }
    const raw = await zipEntryBytes(read, e);
    if (key === 'datamashup') {
        const text = (await mashupFormulas(raw)).join('\n\n');
        return { name: e.name, note: `${size}, Power Query`, lang: 'm', text };
    }
    const text = decodePart(raw);
    if (text === null) return { name: e.name, note: `${size}, not text`, lang: null, text: null };
    const lang = langOf(e.name) || (/^\s*[{[]/.test(text) ? 'json' : /^\s*</.test(text) ? 'xml' : null);
    return { name: e.name, note: size, lang, text: lang === 'json' ? prettyJson(text) : text };
}

// Text of a part: UTF-16LE (Power BI writes most parts so, often without BOM), else as sniffed
export function decodePart(raw: Uint8Array): string | null {
    const wide = raw.length > 3 && raw[0] !== 0 && raw[1] === 0 && raw[3] === 0;
    const encoding = wide ? 'utf-16le' : sniffText(raw);
    return encoding ? new TextDecoder(encoding).decode(raw) : null;
}

// JSON indented (values as written); strings holding JSON (layout: config, filters, query) unpacked in place
export function prettyJson(text: string): string {
    try {
        JSON.parse(text);
    } catch {
        return text; // not JSON after all: as it is
    }
    return indentJson(unpackJson(text));
}

function unpackJson(text: string): string {
    return text.replace(STRING_RE, (s) => {
        try {
            const inner = JSON.parse(s);
            if (typeof inner !== 'string' || !/^\s*[{[]/.test(inner)) return s;
            JSON.parse(inner);
            return unpackJson(inner);
        } catch {
            return s;
        }
    });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// Queries of the mashup (.pbix), else of the model schema (.pbit)
export async function pbixQueries(read: ByteReader, entries: ZipEntry[]): Promise<Query[]> {
    const entry = (name: string) => entries.find((e) => e.name.toLowerCase() === name);
    const mashup = entry('datamashup');
    if (mashup) {
        const queries = await mashupQueries(await zipEntryBytes(read, mashup));
        if (queries.length) return queries;
    }
    const schema = entry('datamodelschema');
    return schema ? schemaQueries(decodePart(await zipEntryBytes(read, schema)) || '{}') : [];
}

// DataMashup (MS-QDEFF): version, length, package (ZIP) with Formulas/*.m, then metadata (not read)
export async function mashupFormulas(bytes: Uint8Array): Promise<string[]> {
    if (bytes.length < 8) return [];
    const parts = bytes.subarray(8, 8 + dataView(bytes).getUint32(4, true));
    const read: ByteReader = async (from, to) => parts.subarray(from, to);
    const out = [];
    for (const e of await zipEntries(read, parts.length)) {
        if (/^\/?Formulas\/.*\.m$/i.test(e.name)) out.push(utf8.decode(await zipEntryBytes(read, e)));
    }
    return out;
}

export async function mashupQueries(bytes: Uint8Array): Promise<Query[]> {
    return (await mashupFormulas(bytes)).flatMap(sectionQueries);
}

// Model schema (TMSL, JSON): shared expressions and M partitions of tables
export function schemaQueries(json: string): Query[] {
    const model = JSON.parse(json).model || {};
    const lines = (x: string | string[]) => (Array.isArray(x) ? x.join('\n') : x || '');
    const queries = (model.expressions || [])
        .filter((x: { kind?: string }) => !x.kind || x.kind === 'm')
        .map((x: { name: string; expression: string | string[] }) => ({ name: x.name, body: lines(x.expression) }));
    for (const t of model.tables || []) {
        for (const p of t.partitions || []) {
            if (p.source?.type === 'm') queries.push({ name: t.name, body: lines(p.source.expression) });
        }
    }
    return queries;
}

// Section document: `shared` members, split at `;` outside strings, comments and brackets
export function sectionQueries(text: string): Query[] {
    const statements = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            i++;
            while (i < text.length && (text[i] !== '"' || text[i + 1] === '"')) i += text[i] === '"' ? 2 : 1;
        } else if (c === '/' && text[i + 1] === '/') {
            i = text.indexOf('\n', i);
            if (i < 0) break;
        } else if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2) + 1;
            if (i <= 0) break;
        } else if ('([{'.includes(c)) {
            depth++;
        } else if (')]}'.includes(c)) {
            depth--;
        } else if (c === ';' && depth <= 0) {
            statements.push(text.slice(start, i));
            start = i + 1;
        }
    }
    const queries = [];
    for (const s of statements) {
        const m = SHARED_RE.exec(s);
        if (!m) continue;
        const name = m[1].startsWith('#"') ? m[1].slice(2, -1).replace(/""/g, '"') : m[1];
        queries.push({ name, body: m[2].trim() });
    }
    return queries;
}

/** @returns parameter fields (`… meta [IsParameterQuery=true, …]`), null: not a parameter */
export function parameterOf(q: Query): { type: string; value: string; required: boolean } | null {
    const m = META_RE.exec(q.body);
    if (!m || !/IsParameterQuery\s*=\s*true/i.test(m[1])) return null;
    return {
        type: /\bType\s*=\s*"([^"]*)"/.exec(m[1])?.[1] || '',
        value: q.body.slice(0, m.index).trim(),
        required: /IsParameterQueryRequired\s*=\s*true/i.test(m[1]),
    };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

// Parts as a tree, then parameters (table) and queries (M)
export function pbixMarkdown(entries: ZipEntry[], queries: Query[]): string {
    const hint = 'Parts and queries: picker bottom right (text parts with colours and checks).';
    const out = [hint, '', '## Parts', '', '```', ...treeLines(entries), '```'];
    const params = queries.filter((q) => parameterOf(q));
    const others = queries.filter((q) => !parameterOf(q));
    if (params.length) {
        out.push(
            '',
            `## Parameters (${params.length})`,
            '',
            '| Name | Type | Value | Required |',
            '| --- | --- | --- | --- |',
        );
        for (const q of params) {
            const p = parameterOf(q) as NonNullable<ReturnType<typeof parameterOf>>;
            out.push(`| ${cell(q.name)} | ${p.type} | ${cell(p.value)} | ${p.required ? 'yes' : 'no'} |`);
        }
    }
    const why = noQueries(entries, queries);
    if (why || queries.length) out.push('', `## Queries (${others.length})`);
    if (why) out.push('', why);
    for (const q of others) {
        const fence = '`'.repeat(Math.max(3, ...(q.body.match(/`+/g) || []).map((b) => b.length + 1)));
        out.push('', `### ${q.name}`, '', `${fence}m`, q.body, fence);
    }
    return `${out.join('\n')}\n`;
}

// Why there are no queries (null: there are some, or the file has no queries at all)
export function noQueries(entries: ZipEntry[], queries: Query[]): string | null {
    if (queries.length) return null;
    const has = (name: string) => entries.some((e) => e.name.toLowerCase() === name);
    if (has('datamodel'))
        return (
            'Power Query scripts and parameters are kept in the data model (Power BI\'s "enhanced metadata"), ' +
            'which is not read. To see them here, save the report as a template ' +
            '(File > Export > Power BI template, `.pbit`).'
        );
    return has('datamashup') || has('datamodelschema') ? 'No Power Query scripts found.' : null;
}

// Table cell as code (pipes escaped, one line)
const cell = (s: string): string => `\`${s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')}\``;

// Paths as a tree: folders first, sizes and notes behind the parts
export function treeLines(entries: ZipEntry[]): string[] {
    const root: Node = { size: null, kids: new Map() };
    for (const e of entries) {
        let node = root;
        for (const part of e.name.replace(/\\/g, '/').split('/').filter(Boolean)) {
            if (!node.kids.has(part)) node.kids.set(part, { size: null, kids: new Map() });
            node = node.kids.get(part) as Node;
        }
        if (!e.name.endsWith('/')) node.size = e.size;
    }
    const lines: string[] = [];
    const walk = (node: Node, indent: string) => {
        const kids = [...node.kids].sort(([a, x], [b, y]) => +!x.kids.size - +!y.kids.size || a.localeCompare(b));
        kids.forEach(([name, kid], k) => {
            const last = k === kids.length - 1;
            const folder = kid.kids.size > 0;
            const note = NOTES[name.toLowerCase()];
            const size = kid.size === null ? '' : formatBytes(kid.size);
            const tail = [size, note].filter(Boolean).join(', ');
            const suffix = tail ? `  (${tail})` : '';
            lines.push(`${indent}${last ? '└── ' : '├── '}${name}${folder ? '/' : ''}${suffix}`);
            if (folder) walk(kid, indent + (last ? '    ' : '│   '));
        });
    };
    walk(root, '');
    return lines;
}
