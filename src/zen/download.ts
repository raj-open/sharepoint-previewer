// Zen list download: the items selected; one file as it is, else a ZIP (folders with all below them);
// files fetched by the page (as the previewer does), handed to the browser to save

// ===========================================================================
// IMPORTS
// ===========================================================================

import { formatBytes } from '../_core/util.ts';
import { encodePath } from '../readers/request.ts';
import { sameOrigin } from '../readers/request.ts';
import { loadEntries } from './data.ts';
import { packZip } from './pack.ts';
import { ZIP_MAX_ENTRIES } from './pack.ts';

import type { ZenEntry } from '../_core/types.ts';
import type { ZenItem } from '../_core/types.ts';
import type { PackEntry } from './pack.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// The archive is made in the browser's memory: at most this much (Sharepoint's own: 250 GB, 10,000 files)
export const MAX_DOWNLOAD = 2 * 1024 ** 3; // bytes
const MAX_FILES = 10000;
const PARALLEL = 4; // files fetched at a time

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Collecting: the items selected, folders with all below them (paths inside the folder shown)
// ---------------------------------------------------------------------------

/** @returns path of `path` inside `folder` (server-relative both) */
export function relativePath(folder: string, path: string): string {
    const base = `${folder.replace(/\/+$/, '')}/`;
    return path.toLowerCase().startsWith(base.toLowerCase()) ? path.slice(base.length) : (path.split('/').pop() ?? '');
}

/**
 * @param folder folder shown (paths in the archive start there)
 * @returns files and folders to pack (folders before what is in them), or why not
 */
export async function collect(
    library: string,
    folder: string,
    items: ZenItem[],
    signal: AbortSignal,
    progress: (text: string) => void,
): Promise<ZenEntry[] | string> {
    const out: ZenEntry[] = [];
    const queue: ZenEntry[] = [...items.map((x) => ({ name: x.name, path: x.path, folder: x.folder }))];
    let files = 0;
    while (queue.length) {
        if (signal.aborted) return 'stopped';
        const e = queue.shift() as ZenEntry;
        out.push(e);
        if (!e.folder) {
            if (++files > MAX_FILES) return `more than ${MAX_FILES.toLocaleString()} files`;
            continue;
        }
        if (out.length > ZIP_MAX_ENTRIES) return `more than ${ZIP_MAX_ENTRIES.toLocaleString()} files and folders`;
        progress(`Listing ${relativePath(folder, e.path)} …`);
        const below = await loadEntries(library, e.path);
        if (typeof below === 'string') return `${relativePath(folder, e.path)}: ${below}`;
        queue.unshift(...below.filter((x) => x.folder), ...below.filter((x) => !x.folder)); // depth first
    }
    return out;
}

// ---------------------------------------------------------------------------
// Fetching and saving
// ---------------------------------------------------------------------------

/** @returns bytes and date of a file (its Last-Modified), or why not */
async function fetchFile(path: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; date: Date } | string> {
    const url = encodePath(path);
    if (!sameOrigin(url)) return 'refused (other origin)';
    try {
        const res = await fetch(url, { credentials: 'same-origin', signal });
        if (!res.ok) return `HTTP ${res.status}`;
        const modified = new Date(res.headers.get('last-modified') ?? '');
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { bytes, date: Number.isNaN(modified.getTime()) ? new Date() : modified };
    } catch (e) {
        return signal.aborted ? 'stopped' : `failed (${e instanceof Error ? e.message : e})`;
    }
}

/** Hands a file (blob URL) to the browser to save (link not in the page: the page's own handlers never see it) */
export function saveAs(href: string, name: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
}

/**
 * Downloads the items: one file as it is (from Sharepoint), else a ZIP named `name`.zip
 * @param folder folder shown (paths in the archive start there)
 * @returns '' when saved, else why not
 */
export async function download(
    library: string,
    folder: string,
    items: ZenItem[],
    name: string,
    signal: AbortSignal,
    progress: (text: string) => void,
): Promise<string> {
    if (!items.length) return 'nothing selected';
    if (items.length === 1 && !items[0].folder) {
        progress(`Downloading ${items[0].name} …`);
        const got = await fetchFile(items[0].path, signal);
        if (typeof got === 'string') return `${items[0].name}: ${got}`;
        saveAs(URL.createObjectURL(new Blob([got.bytes as BlobPart])), items[0].name);
        return '';
    }
    const entries = await collect(library, folder, items, signal, progress);
    if (typeof entries === 'string') return entries;
    const files = entries.filter((e) => !e.folder);
    const packed: PackEntry[] = entries.map((e) => ({
        path: relativePath(folder, e.path),
        bytes: null,
        date: new Date(),
    }));
    let done = 0;
    let bytes = 0;
    let why = '';
    const say = () => progress(`Downloading ${done} / ${files.length} files · ${formatBytes(bytes)} …`);
    say();
    let next = 0;
    const worker = async () => {
        while (!why && next < entries.length) {
            const i = next++;
            if (entries[i].folder) continue;
            const got = await fetchFile(entries[i].path, signal);
            if (typeof got === 'string') {
                why ||= `${packed[i].path}: ${got}`;
                return;
            }
            bytes += got.bytes.length;
            if (bytes > MAX_DOWNLOAD) {
                why ||= `more than ${formatBytes(MAX_DOWNLOAD)} (please use Sharepoint's own download)`;
                return;
            }
            packed[i].bytes = got.bytes;
            packed[i].date = got.date;
            done++;
            say();
        }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (signal.aborted) return 'stopped';
    if (why) return why;
    progress('Packing …');
    const zip = await packZip(packed);
    if (typeof zip === 'string') return zip;
    saveAs(URL.createObjectURL(zip), `${name}.zip`);
    return '';
}
