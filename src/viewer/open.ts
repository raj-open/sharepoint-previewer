// Opening files: viewer state, previews, properties line

// ===========================================================================
// IMPORTS
// ===========================================================================

import { currentFolder } from '../_core/list.ts';
import { inLibrary } from '../_core/list.ts';
import { refreshEyes } from '../_core/list.ts';
import { rowFilePath } from '../_core/list.ts';
import { rowName } from '../_core/list.ts';
import { csvFormat } from '../_core/prefs.ts';
import { rememberSheetMode } from '../_core/prefs.ts';
import { sheetMode } from '../_core/prefs.ts';
import { view } from '../_core/prefs.ts';
import { FOLLOW_LINKS } from '../_core/settings.ts';
import { MAX_3D_BYTES } from '../_core/settings.ts';
import { MAX_BYTES } from '../_core/settings.ts';
import { MAX_LINE_CHARS } from '../_core/settings.ts';
import { MAX_LINK_HOPS } from '../_core/settings.ts';
import { esc } from '../_core/util.ts';
import { formatBytes } from '../_core/util.ts';
import { nextFrame } from '../_core/util.ts';
import { formatName } from '../readers/formats.ts';
import { formatOf } from '../readers/formats.ts';
import { langOfFormat } from '../readers/formats.ts';
import { readerOf } from '../readers/formats.ts';
import { linkTarget } from '../readers/links.ts';
import { openParquetSource } from '../readers/parquet/source.ts';
import { encodePath } from '../readers/request.ts';
import { findFile } from '../readers/search.ts';
import { lookupNotes } from '../readers/search.ts';
import { sheetFormat } from '../readers/sheets/cells.ts';
import { openSheetSource } from '../readers/sheets/index.ts';
import { openSource } from '../readers/text.ts';
import { openZipSource } from '../readers/zip.ts';
import { csvSeparator } from '../text/highlight/csv.ts';
import { SEPARATOR_NAMES } from '../text/highlight/csv.ts';
import { HIGHLIGHTERS } from '../text/highlight/index.ts';
import { indentation } from '../text/lang.ts';
import { LANG_NAMES } from '../text/lang.ts';
import { LINTERS } from '../text/lint/index.ts';
import { lintFile } from '../text/lint/worker.ts';
import { LOAD_ALL_SVG } from '../ui/icons.ts';
import { mountLines } from '../view/lines.ts';
import { hasFields } from '../view/log.ts';
import { levelClass } from '../view/log.ts';
import { logExpand } from '../view/log.ts';
import { parseLog } from '../view/log.ts';
import { renderLines } from '../view/lines.ts';
import { mountMarkdown } from '../view/markdown.ts';
import { mountTable } from '../view/table.ts';
import { parseCsv } from '../view/table.ts';
import { QUOTE_MODES } from '../view/table.ts';
import { cancelLoad } from './cache.ts';
import { clearedUrls } from './cache.ts';
import { keepInMemory } from './cache.ts';
import { makeRoom } from './cache.ts';
import { memoryCache } from './cache.ts';
import { trimMemory } from './cache.ts';
import { canWrite } from './edit.ts';
import { confirmDiscard } from './edit.ts';
import { enterWrite } from './edit.ts';
import { exitWriteView } from './edit.ts';
import { markEdited } from './edit.ts';
import { layoutPage } from './layout.ts';
import { restorePage } from './layout.ts';
import { setMode } from './layout.ts';
import { renderLint } from './messages.ts';
import { askName } from './names.ts';
import { showLintWait } from './messages.ts';
import { showPlain } from './messages.ts';
import { createViewer } from './panel.ts';
import { setBusy } from './status.ts';
import { showCached } from './status.ts';
import { showProgress } from './status.ts';
import { close3d } from './view3d.ts';
import { ifcLibraryReady } from './view3d.ts';
import { toggle3d } from './view3d.ts';
import { colourOn } from './views.ts';
import { markdownView } from './views.ts';
import { previewOf } from './views.ts';
import { setPreview } from './views.ts';
import { showFormat } from './views.ts';
import { showSheets } from './views.ts';
import { tableView } from './views.ts';
import { updateViews } from './views.ts';

import type { Source } from '../_core/types.ts';
import type { Viewer } from '../_core/types.ts';
import type { Token } from '../_core/types.ts';
import type { Deferred } from '../_core/types.ts';
import type { TableState } from '../_core/types.ts';
import type { SheetMode } from '../_core/types.ts';
import type { LogTable } from '../_core/types.ts';
import type { SheetShown } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export let viewer: Viewer | null = null; // single open viewer, if any

export const pendingOpens = new Map(); // url -> first fetch still running { promise, relay, ctl }
export const forcedUrls = new Set(); // big Parquet / IFCZIP files the user chose to cache in full
export const formatChoices = new Map(); // url -> format chosen by the user (while the page is open)
const knownSizes = new Map(); // url -> file size seen before (shown right away next time)

// ===========================================================================
// METHODS
// ===========================================================================

export function closeViewer(): void {
    if (!viewer) return;
    setTimeout(refreshEyes); // row highlight off, once viewer is gone
    if (!confirmDiscard(viewer)) return; // pending: keep viewer open
    if (viewer.writeMode) exitWriteView(viewer);
    cancelLoad(viewer);
    viewer.lineView?.stop();
    close3d(viewer);
    if (viewer.mode !== 'popup') layoutPage(viewer, 'popup');
    restorePage(viewer);
    viewer.removeListeners?.();
    viewer.backdrop.remove();
    viewer.box.remove();
    viewer = null;
}

// Opens a file (following .url links): { src } or { message }, plus final name and hops
/**
 * @param format chosen by the user for the file as listed (its links are then not followed)
 */
async function openFile(
    fetchUrl: string,
    fileName: string,
    hops: string[],
    getSignal: () => AbortSignal,
    reload: boolean,
    onProgress: (loaded: number, total: number) => void,
    onLink: (message: string) => void,
    force: boolean,
    format: string | null,
): Promise<{ src: Source | null; deferred?: Deferred; message: string | null; fileName: string; hops: string[] }> {
    hops = [...hops];
    for (let hop = 0; ; hop++) {
        const chosen = hop === 0 ? format : null;
        const reader = readerOf(chosen || formatOf(fileName));
        const result =
            reader === 'parquet'
                ? await openParquetSource(fetchUrl, getSignal, reload, onProgress, force)
                : reader === 'sheet'
                  ? await openSheetSource(fetchUrl, getSignal, reload, onProgress, sheetMode(hops[0]))
                  : reader === 'ifczip'
                    ? await openZipSource(fetchUrl, getSignal, reload, onProgress, force)
                    : await openSource(fetchUrl, getSignal, reload, onProgress);
        if ('deferred' in result) return { src: null, deferred: result as Deferred, message: null, fileName, hops };
        if ('error' in result) {
            // file from search results, not found by name: say so first, details below
            const note = lookupNotes.get(hops[0]);
            const type = (fileName.match(/\.[^.]+$/)?.[0] ?? 'this type').toLowerCase();
            const hint = note
                ? `Files of type ${type} cannot be viewed from search results (SharePoint gives no path for them).\n` +
                  "Open the file's folder to view it."
                : '';
            const message = [hint, `${result.error}\n${hops.join('\n→ ')}`, note].filter(Boolean).join('\n\n');
            return { src: null, message, fileName, hops };
        }
        if ('binary' in result) {
            return {
                src: null,
                message: 'Not a plain text file: use the standard SharePoint preview, or download the file.',
                fileName,
                hops,
            };
        }
        if (hop > 0 && result.name) fileName = result.name;
        const follow = FOLLOW_LINKS && !chosen && hop < MAX_LINK_HOPS && result.done;
        const target = follow ? linkTarget(fileName, result.text) : null;
        if (!target) return { src: result, message: null, fileName, hops };
        hops.push(target.display);
        fileName = target.name;
        fetchUrl = target.fetchUrl;
        onLink(`Link → ${target.display}`);
    }
}

// Open file viewed as another format (a wrong one too: that format's reader tries);
// the recognised format drops the choice
export function chooseFormat(format: string): void {
    const v = viewer;
    if (!v?.file || !confirmDiscard(v)) return;
    const { name, url } = v.file;
    if (format === formatOf(name)) formatChoices.delete(url);
    else formatChoices.set(url, format);
    showFile(name, url, false);
}

// Same file, any encoding / case of path
export function sameFile(a: string, b: string): boolean {
    const norm = (x: string) => {
        try {
            x = decodeURIComponent(x);
        } catch {}
        return x.replace(/\/+$/, '').toLowerCase();
    };
    return norm(a) === norm(b);
}

// Header eye: viewer without file (look around, settings, ...). Same toggle as row eyes:
// again on the empty viewer = close; with a file open = switch to empty.
export function openEmptyViewer(): void {
    if (viewer && !viewer.file) return void closeViewer();
    if (!viewer) {
        viewer = createViewer();
        setMode(view.mode);
    }
    showEmpty(viewer);
}

// New file in the folder open in SharePoint: name asked (checked), then an empty text in write mode
// (empty may be uploaded too)
export async function newFile(): Promise<void> {
    const folder = currentFolder();
    if (!inLibrary() || !folder) {
        alert('New files go into the folder open in SharePoint: please open a folder of a library first.');
        return;
    }
    if (viewer && !confirmDiscard(viewer)) return; // pending in the open file: stay
    const name = await askName(folder);
    if (!name) return;
    if (!viewer) {
        viewer = createViewer();
        setMode(view.mode);
    }
    const v = viewer;
    if (!showEmpty(v)) return;
    const format = formatOf(name);
    v.file = { name, url: `${folder}/${name}` };
    v.fileName = name;
    v.linked = false;
    v.lang = langOfFormat(format);
    v.source = {
        total: 0,
        loaded: 0,
        done: true,
        text: '',
        more: async () => {},
        loadAll: async () => {},
        fresh: true,
    };
    v.newBtn.hidden = true;
    v.metaLine.innerHTML = `<strong>Properties:</strong> new file · format: ${esc(formatName(format))}`;
    showPlain(v, '');
    refreshEyes();
    await enterWrite(v); // shows the name (click: another name)
    markEdited(v); // ready to save as it is
}

// Viewer back to no file; false if user keeps pending changes
export function showEmpty(v: Viewer): boolean {
    if (!confirmDiscard(v)) return false;
    close3d(v);
    if (v.writeMode) exitWriteView(v);
    cancelLoad(v);
    setBusy(v, false);
    v.loadToken++; // ignore anything still on its way
    v.file = null;
    v.source = null;
    v.rerender = null;
    v.relint = null;
    v.text = '';
    for (const b of [v.copyBtn, v.loadAllBtn, v.writeBtn, v.clearBtn]) b.disabled = true;
    setPreview(v, null);
    showSheets(v, null);
    showFormat(v, null);
    updateViews(v);
    v.titleName.textContent = '–';
    v.titleName.title = '';
    v.titleName.className = 'tp-title-name';
    v.newBtn.hidden = false;
    v.metaLine.innerHTML = '';
    v.metaLine.title = '';
    showPlain(
        v,
        'No file opened.\nClick the eye next to a file to preview it, or create a new file (button above, or ⋯ menu).',
    );
    refreshEyes();
    return true;
}

export async function openPreview(row: HTMLElement | null): Promise<void> {
    const name = row && rowName(row);
    if (!name) {
        alert('Preview: could not find the file name in this row.');
        return;
    }
    const folder = currentFolder();
    // row without the file's path (search results): found by search, else guessed in the open folder
    let url = rowFilePath(row, name);
    if (!url && folder) {
        url = (await findFile(folder, name)) || `${folder}/${name}`;
        const eye = row.querySelector('.tp-preview');
        if (eye instanceof HTMLElement) eye.dataset.url = url; // cache state of the file found
    }
    if (url && viewer?.file && sameFile(viewer.file.url, url)) return void closeViewer(); // eye of open file: same as close
    if (url) showFile(name, url, false);
}

// Load file into viewer; `reload` skips browser's cache (refresh button)
export async function showFile(name: string, url: string, reload: boolean): Promise<void> {
    const encodedUrl = encodePath(url);

    // Reuse open viewer (e.g. in split mode, click through files one after another)
    if (!viewer) {
        viewer = createViewer();
        setMode(view.mode);
    }
    const v = viewer;
    if (!confirmDiscard(v)) return; // pending in open file: stay
    close3d(v);
    if (v.writeMode) exitWriteView(v);
    cancelLoad(v); // previous file may still be on its way
    const token = ++v.loadToken;
    const current = () => viewer === v && token === v.loadToken; // not closed / replaced
    v.file = { name, url };
    refreshEyes(); // highlight its row

    if (clearedUrls.delete(url)) reload = true; // cleared before: skip stored copy once
    v.userStopped = false;

    v.newBtn.hidden = true;
    v.titleName.className = 'tp-title-name';
    v.titleName.textContent = name;
    v.titleName.title = url;
    // what is known before the content: format (recognised or chosen), then size (from the first response)
    const chosen = formatChoices.get(url) || null;
    const early = chosen || formatOf(name);
    const reader = readerOf(early); // cached copies of another reader are read anew
    const earlyLang = langOfFormat(early);
    const earlyFormat = (!chosen && sheetFormat(name)) || formatName(early);
    const earlyMeta = (total: number) => {
        const parts = [
            total ? `size: ${formatBytes(total)} (${total.toLocaleString()} bytes)` : '',
            `format: ${earlyFormat}`,
        ];
        v.metaLine.innerHTML = `<strong>Properties:</strong> ${esc(parts.filter(Boolean).join(' · '))}`;
    };
    earlyMeta(knownSizes.get(url) || 0);
    v.metaLine.title = '';
    v.text = '';
    v.copyBtn.disabled = true;
    v.loadAllBtn.disabled = true;
    v.writeBtn.disabled = true;
    setPreview(v, previewOf(earlyLang), 'Preview: once the file is cached');
    showSheets(v, null);
    showFormat(v, early, formatOf(name));
    updateViews(v);
    v.clearBtn.disabled = false;
    setBusy(v, true);
    showPlain(v, '');
    showProgress(v, 0, 0);
    v.content.focus();

    // First chunk (close cancels); .url link files are followed
    let src = null;
    let message = null; // shown instead of file (errors, binary files)
    let deferred = null; // big Parquet / IFCZIP: waits for "cache all"
    const forced = forcedUrls.has(url); // "cache all" was asked for
    let fileName = name; // name of file actually shown (after links are followed)
    const fetchUrl = encodedUrl;
    const hops = [url];
    v.abort = new AbortController();
    // relay: progress and signal of this file's source, also once another file is shown
    const relay: { fn: ((loaded: number, total: number) => void) | null; controller: AbortController | null } = {
        fn: null,
        controller: null,
    };
    const getSignal = () => {
        if (relay.controller) return relay.controller.signal;
        v.abort ||= new AbortController();
        return v.abort.signal;
    };
    let rendered = false; // once text is shown, progress goes to "Cache next" bar

    let metaSize = 0;
    const progress = (loaded: number, total: number) => {
        if (!current()) return;
        if (total) loaded = Math.min(loaded, total); // overlapping reads may count twice
        showProgress(v, loaded, total);
        if (!rendered && total && total !== metaSize) {
            metaSize = total;
            earlyMeta(total);
        }
        // all bytes in, view still built (e.g. Parquet rows decoded)
        if (total && loaded >= total) v.progressText.textContent += ' · preparing view …';
    };
    relay.fn = progress; // the showFile that shows this source now
    const relayed = (loaded: number, total: number) => relay.fn?.(loaded, total);
    if (reload && memoryCache.delete(url)) refreshEyes(); // refresh: fetch anew
    if (memoryCache.get(url)?.reader !== reader && memoryCache.delete(url)) refreshEyes(); // other format chosen
    const kept = memoryCache.get(url);
    // New file and the cache at its limit: clear the others first (OK / Cancel)
    if (!kept && !pendingOpens.has(url) && !makeRoom(v, Math.min(MAX_BYTES, knownSizes.get(url) || MAX_BYTES))) {
        setBusy(v, false);
        showPlain(
            v,
            'Not opened: the cache is full. Clear cached files (⋯ menu) or raise the cache limit in the settings.',
        );
        return;
    }
    if (kept) {
        // Previewed before while this page is open: reuse it, nothing is fetched
        memoryCache.delete(url);
        memoryCache.set(url, kept); // most recently viewed last
        src = kept.src;
        if (src.relay) src.relay.fn = progress;
        fileName = kept.fileName;
        hops.push(...kept.hops.slice(1));
    } else
        try {
            // The first fetch (Parquet / IFCZIP: often the whole file) goes on when the user moves
            // to another file; coming back joins it instead of starting anew
            let pending = pendingOpens.get(url);
            if (pending?.reader !== reader) pending?.ctl.abort(); // other format chosen meanwhile
            if (pending?.reader === reader) pending.relay.fn = progress;
            else {
                const ctl = new AbortController();
                relay.controller = ctl;
                pending = {
                    reader,
                    relay,
                    ctl,
                    promise: openFile(
                        fetchUrl,
                        fileName,
                        hops,
                        getSignal,
                        reload,
                        relayed,
                        (m: string) => current() && showPlain(v, m),
                        forcedUrls.has(url),
                        chosen,
                    ),
                };
                const own = pending;
                pendingOpens.set(url, own);
                refreshEyes(); // half open while it caches
                pending.promise
                    .then(
                        (r: Awaited<ReturnType<typeof openFile>>) => {
                            if (r.src) {
                                r.src.relay = relay;
                                keepInMemory(url, { src: r.src, fileName: r.fileName, hops: [...r.hops], reader });
                            }
                        },
                        () => {},
                    )
                    .finally(() => {
                        relay.controller = null;
                        if (pendingOpens.get(url) === own) pendingOpens.delete(url);
                        refreshEyes();
                    });
            }
            v.abort = pending.ctl;
            v.opening = true;
            const r = await pending.promise;
            src = r.src;
            deferred = r.deferred;
            message = r.message;
            fileName = r.fileName;
            hops.splice(0, hops.length, ...r.hops);
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                if (current() && v.userStopped) showPlain(v, 'Caching stopped. Use refresh to cache this file again.');
                return;
            }
            message = `Caching failed: ${(err as Error).message}\n${hops.join('\n→ ')}`;
        }
    if (current()) v.opening = false;
    if (current()) setBusy(v, false);
    if (hops.length > 1) {
        v.titleName.textContent = `${name} → ${fileName}`;
        v.titleName.title = hops.join('\n→ ');
    }
    v.abort = null;

    if (!current()) return;

    if (deferred) {
        // Big Parquet / IFCZIP: only on request (whole file); "cache all" opens it in full
        v.source = {
            total: deferred.size,
            loaded: 0,
            done: false,
            dates: deferred.dates,
            deferred: true,
            text: '',
            more: async () => {},
            loadAll: async () => {}, // the viewer's loadAll opens the file in full
        };
        knownSizes.set(url, deferred.size);
        v.text = '';
        v.copyBtn.disabled = true;
        v.writeBtn.disabled = true;
        v.rerender = null;
        v.relint = null;
        v.loadAllBtn.disabled = false;
        setPreview(v, previewOf(earlyLang), 'Preview: once the whole file is cached');
        v.loadAll = async () => {
            forcedUrls.add(url);
            await showFile(name, url, false);
            return true;
        };
        showPlain(
            v,
            `To show this ${deferred.deferred} file (${formatBytes(deferred.size)}), the whole file has to be cached first.\nClick ⟦icon⟧ to do this.`,
        );
        const icon = LOAD_ALL_SVG.replace(/\s+/g, ' ').trim(); // no line breaks (the text is pre-formatted)
        const line2 = v.content.querySelectorAll('.tp-code')[1];
        line2.innerHTML = line2.innerHTML.replace('⟦icon⟧', `<span class="tp-inline-icon">${icon}</span>`);
        v.metaLine.innerHTML = `<strong>Properties:</strong> size: ${formatBytes(deferred.size)} · format: ${deferred.deferred}`;
        updateViews(v);
        return;
    }
    v.copyBtn.disabled = false;

    if (!src) {
        v.text = message;
        v.source = null;
        v.writeBtn.disabled = true;
        v.rerender = null;
        v.relint = null;
        v.loadAllBtn.disabled = true;
        setPreview(v, null);
        showPlain(v, message);
        showCached(v); // nothing cached (not the last file's state)
        return;
    }

    // Copy gets whole file: rest is cached first if needed
    v.source = src;
    v.fileName = fileName;
    const format = chosen || formatOf(fileName);
    v.lang = langOfFormat(format);
    v.linked = hops.length > 1;
    v.writeBtn.disabled = !canWrite(v);
    v.writeBtn.title = src.isSheet ? 'Edit: not available for spreadsheets (read only)' : 'Edit (text files only)';
    const kind = previewOf(v.lang);
    const ifcSize = src.ifcBytes ? src.ifcBytes.length : src.total;
    const tooBig = kind === '3d' && ifcSize > MAX_3D_BYTES;
    setPreview(v, kind, tooBig ? `3D view: only for IFC files up to ${formatBytes(MAX_3D_BYTES)}` : '');
    showFormat(v, format, formatOf(fileName));
    updateViews(v);
    v.text = src.text;

    const lang = ['parquet', 'sheet'].includes(v.lang ?? '') ? 'csv' : (v.lang ?? ''); // their rows come as CSV; '' plain text
    const plain = (t: string): Token[] => [['', t]];
    const highlight = HIGHLIGHTERS[lang] || plain;
    let problemsByLine = new Map();
    let lines: string[] = [];
    let logShown: LogTable | null = null; // log as a table (while shown)

    // Cached lines; unfinished last line waits (unless there is no break at all)
    const loadedLines = () => {
        let t = src.text;
        if (!src.done && !src.wholeLines && t.includes('\n')) t = t.slice(0, t.lastIndexOf('\n'));
        return t.split(/\r?\n/);
    };

    // Table view: sort and filters stay while this file is open (also across "Cache next"); per sheet or table
    const tableState: TableState = { sort: null, filters: new Map() };
    const sheetStates: Map<string, TableState> = new Map();
    /** @param i e.g. "sheets 0" */
    const sheetState = (i: string) => {
        if (!sheetStates.has(i)) sheetStates.set(i, { sort: null, filters: new Map() });
        return sheetStates.get(i) as TableState; // set just above
    };

    // Metadata line: dates, size, format and, for tables, their shape

    const updateMeta = () => {
        const d = src.dates || {};
        const encoding = src.encoding ? `, ${src.encoding}` : '';
        const info = [
            // from the file's own response only (no list columns, no API)
            ['created', d.created],
            ['modified', d.modified || 'n/a'],
            ['size', src.total ? `${formatBytes(src.total)} (${src.total.toLocaleString()} bytes)` : null],
            ['format', src.format || `${LANG_NAMES[lang] || 'Text'}${encoding}`],
        ];
        if (!src.format && lang !== 'csv') info.push(['indent', indentation(src.text)]);
        if (src.info)
            info.push(...src.info); // Parquet, archives, spreadsheets
        else if (lang === 'csv') {
            const sep = csvSeparator(src.text);
            const header = src.text.slice(0, (src.text.indexOf('\n') + 1 || src.text.length + 1) - 1);
            const cols = header ? header.split(sep).length : 0;
            const rows = Math.max(0, lines.filter((l) => l.trim()).length - 1);
            const to =
                v.tableEditing && csvFormat.sep && csvFormat.sep !== sep ? ` → ${SEPARATOR_NAMES[csvFormat.sep]}` : '';
            info.push(['delimiter', `${SEPARATOR_NAMES[sep]}${to}`]);
            if (v.tableEditing && csvFormat.quote)
                info.push(['quotes', QUOTE_MODES[csvFormat.quote].replace('Quotes: ', '')]);
            info.push(['shape', `${src.done ? '' : '≥ '}${rows.toLocaleString()} rows × ${cols} columns`]);
        }
        if (logShown) {
            const entries = `${src.done ? '' : '≥ '}${logShown.rows.length.toLocaleString()} entries`;
            info.push(['shape', `${entries} × ${logShown.header.length} columns`]);
            info.push(['fields', `${logShown.kinds.join(', ')} (guessed)`]);
        }
        const shown = info.filter(([, x]) => x !== null && x !== undefined && x !== '');
        const pairs = shown.map(([k, x]) => `${k}: ${x}`);
        v.metaLine.innerHTML = `<strong>Properties:</strong> ${esc(pairs.join(' · '))}`;
        v.metaLine.title = pairs.join('\n');
    };

    // Markdown: relative links and images point into the file's folder
    const folderUrl = new URL(fetchUrl.replace(/[^/]*$/, ''), location.origin).href;

    // Very long lines (e.g. minified files) are cut for display; copy still gets everything
    const render = () => {
        rendered = true;
        lines = loadedLines();
        // Line numbers: one width for the whole column, max(L, digits(last line) + 2), L = digits(rows of the file)
        const rowsDigits = String(src?.done ? lines.length : 0).length;
        const lastDigits = String(lines.length).length;
        v.content.style.setProperty('--tp-ln-w', `${Math.max(rowsDigits, lastDigits + 2)}ch`);
        const scrollTop = v.content.scrollTop;
        const truncated = new Map();
        const visible = lines.map((line, i) => {
            if (line.length <= MAX_LINE_CHARS) return line;
            truncated.set(i + 1, line.length - MAX_LINE_CHARS);
            return line.slice(0, MAX_LINE_CHARS);
        });
        v.lineView?.stop();
        // Logs: table only if fields were found (first lines), parsed in full while shown
        if (v.lang === 'log') {
            const found = hasFields(lines);
            setPreview(v, 'table', found ? '' : 'Table view: no recognisable fields in this log');
            updateViews(v);
        }
        logShown = v.lang === 'log' && tableView(v) ? parseLog(lines.join('\n')) : null;
        const shown: SheetShown | null = src.isSheet ? src.shown : null;
        if (shown && !shown.rows.length) {
            // chart sheet, empty or unreadable sheet, empty table: a note instead
            v.lineView = mountLines(v.content, renderLines([['', shown.note]], new Map()));
            v.content.firstElementChild?.classList.add('tp-notice');
        } else if (shown && view.table) {
            v.lineView = mountTable(v.content, shown.header, shown.rows, {
                state: sheetState(`${src.mode} ${src.current}`),
                colour: colourOn(v),
            });
        } else if (view.table && lang === 'csv') {
            const sep = csvSeparator(src.text);
            const rows = parseCsv(src.done ? src.text.replace(/\r?\n$/, '') : lines.join('\n'), sep);
            v.lineView = mountTable(v.content, rows[0] || [], rows.slice(1), {
                state: tableState,
                sep,
                editable: v.tableEditing,
                colour: colourOn(v),
                format: v.tableEditing ? csvFormat : null,
                onEdit: () => markEdited(v),
            });
        } else if (logShown) {
            const { header, rows } = logShown;
            const level = header.indexOf('level');
            const message = header.length - 1;
            v.lineView = mountTable(v.content, header, rows, {
                state: tableState,
                colour: colourOn(v),
                classOf: (c, value) =>
                    c === level ? levelClass(value) : c === message && value.includes('\n') ? 'multi' : '',
                expand: logExpand(rows, colourOn(v)),
            });
        } else if (markdownView(v)) {
            v.lineView = mountMarkdown(v.content, lines.join('\n'), { colour: colourOn(v), base: folderUrl });
        } else {
            const tokens = (colourOn(v) ? highlight : plain)(visible.join('\n'));
            v.lineView = mountLines(v.content, renderLines(tokens, problemsByLine, truncated));
        }
        v.content.scrollTop = scrollTop;

        updateMeta();
        showSheets(v, src);
        v.loadMoreBtn.style.display = src.done ? 'none' : 'block';
        v.loadMoreBtn.disabled = false;
        v.loadAllBtn.disabled = src.done;
        if (!v.busy) showCached(v); // the "fully cache" hint needs the button state
        const of = src.total ? ` of ${formatBytes(src.total)}` : '';
        v.loadMoreBtn.textContent = src.label
            ? `${src.label()} · ${src.nextLabel}`
            : `${lines.length.toLocaleString()} lines · ${formatBytes(src.loaded)}${of} cached · ` +
              `Cache next ${formatBytes(MAX_BYTES)}`;
    };

    const goToLine = (n: number) => {
        n = Math.max(1, Math.min(n, lines.length));
        v.lineView?.show(n);
        const el = v.content.querySelector(`[data-line="${n}"]`);
        if (!el) return;
        el.scrollIntoView({ block: 'center' });
        el.classList.add('tp-flash');
        setTimeout(() => el.classList.remove('tp-flash'), 1500);
    };

    // Problem check: needs whole file, so it runs once everything is cached
    let linted = false;

    const runLint = async () => {
        if (linted || !src.done || !LINTERS[lang]) return;
        linted = true;
        showLintWait(v, lang);
        await nextFrame();
        if (!current()) return;
        const result = src.lintResult || (await lintFile(v, lang, src.text));
        src.lintResult = result;
        v.lintWorker = null;
        if (!current()) return;
        problemsByLine = new Map();
        for (const p of result.problems) {
            if (!problemsByLine.has(p.line)) problemsByLine.set(p.line, []);
            problemsByLine.get(p.line).push(p);
        }
        renderLint(v, lang, result, goToLine);
        if (result.problems.length) render();
    };

    // Load more (one chunk, or everything; or `job`, e.g. one sheet), then shows it
    const load = async (all: boolean, job: () => Promise<void> = src.more, need: number = MAX_BYTES) => {
        if (src.done) return true;
        if (!all && !src.fullJob && !makeRoom(v, need)) return false;
        if (src.fullJob) all = true; // join the "cache all" still running
        v.loadMoreBtn.disabled = true;
        v.loadAllBtn.disabled = true;
        v.userStopped = false;
        setBusy(v, true);
        showProgress(v, src.loaded, src.total);
        try {
            if (all) {
                // runs on when the user moves to another file; joined on return
                if (!src.fullJob) {
                    src.controller = v.abort ||= new AbortController();
                    if (src.relay) src.relay.controller = src.controller; // its requests: this signal
                    src.fullJob = src.loadAll().finally(() => {
                        src.fullJob = null;
                        src.controller = null;
                        if (src.relay) src.relay.controller = null;
                    });
                } else v.abort = src.controller;
                await src.fullJob;
            } else await job();
        } catch (err) {
            if (!current()) return false;
            setBusy(v, false);
            v.abort = null;
            if ((err as Error).name === 'AbortError') {
                v.text = src.text;
                render(); // stopped: show what is cached so far, "Cache next" works again
                return false;
            }
            v.loadMoreBtn.disabled = false;
            v.loadAllBtn.disabled = false;
            v.loadMoreBtn.textContent = `Caching failed: ${(err as Error).message} · Refresh to try again`;
            return false;
        }
        trimMemory();
        if (!current()) return false;
        v.abort = null;
        setBusy(v, false);
        v.text = src.text;
        render();
        runLint();
        return true;
    };
    v.loadAll = () => load(true);
    v.rerender = render; // colours switched on / off
    v.applyColour?.(); // colour button for this file's view
    v.updateMeta = updateMeta;
    v.relint = () => {
        // forget last result and check again (in write mode: saved or cached text)
        src.lintResult = null;
        src.needsLint = false;
        linted = false;
        problemsByLine = new Map();
        runLint();
    };
    v.loadMoreBtn.onclick = () => load(false);

    // Other sheet or table: its sheet cached on first choice (stop keeps what was shown before);
    // sheets or tables: remembered for this file
    v.selectSheet = async (i: number, mode: SheetMode = src.mode) => {
        if (!src.isSheet || !(mode === 'tables' ? src.tables : src.sheets)[i]) return;
        if (mode === src.mode && i === src.current && !src.waiting) return;
        if (mode !== src.mode) rememberSheetMode(url, mode);
        const s = src.sheetOf(i, mode);
        if (src.sheets[s].data === undefined) {
            const job = async () => {
                await src.loadSheet(s);
                src.select(i, mode);
            };
            const ok = await load(false, job, src.sheets[s].size);
            if (!current()) return;
            if (!ok) return void showSheets(v, src); // drop-downs back to what is shown
        }
        if (src.mode !== mode || src.current !== i || src.waiting) {
            src.select(i, mode);
            v.text = src.text;
            render();
        }
        v.content.scrollTop = 0;
        v.content.scrollLeft = 0;
    };

    if (LINTERS[lang] && !src.done) {
        v.lint.style.display = 'block';
        v.lint.className = 'tp-lint tp-lint-wait';
        v.lint.innerHTML = `<div class="tp-lint-summary">${lang.toUpperCase()}: checked once the whole file is cached</div>`;
    } else if (!LINTERS[lang]) {
        v.lint.style.display = 'none'; // TOML / plain text: colours only
    }

    // Text first, so it is readable while (possibly slow) check runs
    v.content.scrollTop = 0;
    render();
    runLint();

    // "Cache all" still running from an earlier visit (or asked for a big Parquet / IFCZIP)
    if (src.fullJob || (forced && !src.done)) load(true);

    // 3D view chosen before: show it again, but only if its library is already loaded
    if (view.show3d && ifcLibraryReady && kind === '3d' && !v.previewBtn.disabled) toggle3d(v);
}
