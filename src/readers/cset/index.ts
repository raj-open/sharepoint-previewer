// Solibri rulesets (.cset), in any of their forms: XML, or Java-serialised objects (newer versions),
// either plain, zipped or gzipped; overview (Markdown), rules with a diagram each (Markdown with a navigator),
// parts as XML / JSON to choose from (read only)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { formatBytes } from '../../_core/util.ts';
import { LANG_NAMES } from '../../text/lang.ts';
import { isJava } from '../java.ts';
import { javaPlain } from '../java.ts';
import { readJava } from '../java.ts';
import { decodePart } from '../pbix/index.ts';
import { treeLines } from '../pbix/index.ts';
import { openRanges } from '../ranges.ts';
import { zipEntries } from '../zip.ts';
import { zipEntryBytes } from '../zip.ts';
import { rulesMarkdown } from './diagram.ts';
import { csetRules } from './rules.ts';

import type { ArchivePart } from '../../_core/types.ts';
import type { Source } from '../../_core/types.ts';
import type { JavaStream } from '../java.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** part with its size, and the objects read if Java-serialised */
type CsetPart = ArchivePart & { size: number; java: JavaStream | null };

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const CSET_RE = /\.cset$/i;
const MAX_CSET_BYTES = 64 * 1024 * 1024; // larger files: not opened
const MAX_NESTING = 3; // archives inside archives (zip, gzip)
const MAX_TEXTS = 500; // texts listed in the overview per part
const MAX_TEXT_CHARS = 200; // longer texts cut there
// rulesets as XML: shown as they are; their rules not read (no real example seen yet)
const XML_NOTE = 'not read from XML rulesets yet (shown as XML): no rules list, no diagrams';
const CLASS_NAME_RE = /^[\w$]+(?:\.[\w$]+)+;?$|^\[+[A-Z]/; // class and type names among the texts

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

// Whole file read once; its form recognised by its bytes (not its name)
export async function openCsetSource(
    url: string,
    getSignal: () => AbortSignal,
    reload: boolean,
    onProgress: (loaded: number, total: number) => void,
): Promise<Source | { error: string }> {
    const file = await openRanges(url, getSignal, reload, onProgress);
    if ('error' in file) return file;
    if (file.size > MAX_CSET_BYTES) return { error: `Ruleset larger than ${formatBytes(MAX_CSET_BYTES)}: not opened` };
    const name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'ruleset.cset');
    let parts: CsetPart[];
    let form: string;
    try {
        const bytes = await file.read(0, file.size);
        parts = await csetParts(name, bytes);
        form = csetForm(bytes, parts);
    } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        return { error: `Not a readable Solibri ruleset (${(err as Error).message})` };
    }
    const xml = parts.some((p) => p.lang === 'xml');
    const overview = csetMarkdown(form, parts);
    const items: ArchivePart[] = parts.map(({ name, note, lang, text }) => ({ name, note, lang, text }));
    const rules = parts.flatMap((p) => (p.java ? csetRules(p.java.roots) : []));
    if (rules.length) {
        const note = `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}, diagrams`;
        items.unshift({ name: 'Rules', note, lang: 'md', text: rulesMarkdown(rules), nav: true });
    }
    const content = parts.filter((p) => p.text && p.size);
    // rules found: those at once; else XML alone: at once
    const item = rules.length ? 1 : content.length === 1 && !content[0].java ? parts.indexOf(content[0]) + 1 : 0;
    return {
        total: file.size,
        loaded: file.size,
        done: true,
        isZip: true, // read only
        dates: file.dates,
        info: [
            ['ruleset', `Solibri, ${form}`],
            ...(rules.length || !xml ? [] : [['rules', XML_NOTE] as [string, string]]),
        ],
        text: overview,
        parts: [{ label: 'Parts', items: [{ name: 'Overview', note: '', lang: 'md', text: overview }, ...items] }],
        part: { list: 0, item },
        more: async () => {},
        loadAll: async () => {},
    };
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

// Parts of a file or archive entry: archives unpacked (entries by their path), Java objects as JSON, text as it is
/** @param via unpacked from (e.g. `gzip, `), noted with the part */
export async function csetParts(name: string, raw: Uint8Array, depth = 0, via = ''): Promise<CsetPart[]> {
    const size = raw.length;
    const part = (what: string, lang: string | null, text: string | null, java: JavaStream | null = null) => ({
        name,
        note: `${formatBytes(size)}, ${via}${what}`,
        lang,
        text,
        size,
        java,
    });
    if (depth < MAX_NESTING && isZipBytes(raw)) {
        const read = async (from: number, to: number) => raw.subarray(from, to);
        const out = [];
        for (const e of await zipEntries(read, size)) {
            if (e.name.endsWith('/')) continue;
            const path = depth ? `${name}/${e.name}` : e.name; // the file's own entries: their names alone
            out.push(...(await csetParts(path, await zipEntryBytes(read, e), depth + 1)));
        }
        return out;
    }
    if (depth < MAX_NESTING && isGzip(raw)) return csetParts(name, await gunzip(raw), depth + 1, `${via}gzip, `);
    if (isJava(raw)) {
        try {
            const java = readJava(raw);
            return [part('Java objects', 'json', `${JSON.stringify(javaPlain(java.roots), null, 2)}\n`, java)];
        } catch (err) {
            return [part(`Java objects, not readable: ${(err as Error).message}`, null, null)];
        }
    }
    const text = decodePart(raw);
    if (text === null) return [part('not text', null, null)];
    const lang = /^\s*</.test(text) ? 'xml' : /^\s*[{[]/.test(text) ? 'json' : null;
    return [part(lang ? LANG_NAMES[lang] : 'text', lang, text)];
}

// Form of the file as a whole (e.g. `ZIP, 2 entries`, `gzip, XML`)
function csetForm(bytes: Uint8Array, parts: CsetPart[]): string {
    if (isZipBytes(bytes)) return `ZIP, ${parts.length} ${parts.length === 1 ? 'entry' : 'entries'}`;
    return parts[0].note.replace(/^[^,]*, /, ''); // without the size
}

const isZipBytes = (b: Uint8Array): boolean => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);
const isGzip = (b: Uint8Array): boolean => b[0] === 0x1f && b[1] === 0x8b;

async function gunzip(b: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

// Form and parts (tree), then per Java part: its classes (with numbers of objects) and its texts
export function csetMarkdown(form: string, parts: CsetPart[]): string {
    const hint = 'Parts: picker bottom right (rules with diagrams, XML with colours and checks, Java objects as JSON).';
    const out = [hint, '', `Solibri ruleset: ${form}.`];
    if (parts.some((p) => p.lang === 'xml') && !parts.some((p) => p.java))
        out.push('', '> [!WARNING]', `> Rules: ${XML_NOTE}.`);
    out.push('', '## Parts', '', '```', ...treeLines(parts), '```');
    for (const p of parts) {
        if (!p.java) continue;
        const classes = [...p.java.classes].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
        const objects = classes.reduce((n, [, k]) => n + k, 0);
        out.push('', `## ${p.name}`, '', `Java objects: ${objects} of ${classes.length} classes.`);
        out.push('', '| Class | Objects |', '| --- | ---: |', ...classes.map(([c, k]) => `| \`${c}\` | ${k} |`));
        const texts = [...new Set(p.java.strings)].filter((s) => /\p{L}/u.test(s) && !CLASS_NAME_RE.test(s));
        if (!texts.length) continue;
        const shown = texts
            .slice(0, MAX_TEXTS)
            .map((s) => s.replace(/\s+/g, ' ').trim())
            .map((s) => (s.length > MAX_TEXT_CHARS ? `${s.slice(0, MAX_TEXT_CHARS)}…` : s));
        const more = texts.length > MAX_TEXTS ? ` (first ${MAX_TEXTS})` : '';
        const fence = '`'.repeat(Math.max(3, ...shown.flatMap((s) => s.match(/`+/g) || []).map((b) => b.length + 1)));
        out.push('', `### Texts: ${texts.length}${more}`, '', `${fence}text`, ...shown, fence);
    }
    return `${out.join('\n')}\n`;
}
