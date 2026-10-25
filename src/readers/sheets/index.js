// Workbook of any of these formats, by its signature

// ===========================================================================
// IMPORTS
// ===========================================================================

import { SHEET_AUTOLOAD_BYTES } from '../../_core/settings.js';
import { csvCell } from '../../_core/util.js';
import { formatBytes } from '../../_core/util.js';
import { openRanges } from '../ranges.js';
import { colName } from './cells.js';
import { MAX_SHEET_CELLS } from './cells.js';
import { rangeText } from './cells.js';
import { readOds } from './ods.js';
import { readOoxml } from './ooxml.js';
import { zipPackage } from './package.js';
import { readXls } from './xls.js';

/** @typedef {import('../../_core/types.js').Source} Source */
/** @typedef {import('../../_core/types.js').ByteReader} ByteReader */
/** @typedef {import('../../_core/types.js').Book} Book */
/** @typedef {import('../../_core/types.js').Sheet} Sheet */
/** @typedef {import('../../_core/types.js').SheetMode} SheetMode */
/** @typedef {import('../../_core/types.js').SheetShown} SheetShown */
/** @typedef {import('../../_core/types.js').Table} Table */

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {ByteReader} read @param {number} size @param {Uint8Array} head @returns {Promise<Book>} */
export async function readBook(read, size, head) {
    if (head[0] === 0xd0 && head[1] === 0xcf) return readXls(read, size);
    if (head[0] !== 0x50 || head[1] !== 0x4b) {
        throw new Error(head[0] === 0x09 ? 'Excel 2.x–4.x files are not supported' : 'not a spreadsheet file');
    }
    const pkg = await zipPackage(read, size);
    return pkg.entry('content.xml') && !pkg.entry('[Content_Types].xml') ? readOds(pkg) : readOoxml(pkg);
}

// Spreadsheet source like openSource(): text = sheet or table shown, as CSV; more() = next sheet not cached.
// Sheets are the unit cached; a table is shown once its sheet is.
// Large files (over SHEET_AUTOLOAD_BYTES) cache no sheet until one (or a table) is chosen.
/**
 * @param {string} url @param {() => AbortSignal} getSignal @param {boolean} reload
 * @param {(loaded: number, total: number) => void} onProgress @param {SheetMode} [mode] start view (sheets if there are no tables)
 * @param {number} [autoload] largest file whose first sheet or table is shown at once
 * @returns {Promise<Source|{ error: string }>}
 */
export async function openSheetSource(
    url,
    getSignal,
    reload,
    onProgress,
    mode = 'sheets',
    autoload = SHEET_AUTOLOAD_BYTES,
) {
    const file = await openRanges(url, getSignal, reload, onProgress);
    if ('error' in file) return file;
    /** @type {Book} */
    let book;
    try {
        book = await readBook(file.read, file.size, file.head);
    } catch (err) {
        if (/** @type {Error} */ (err).name === 'AbortError') throw err;
        return { error: `Not shown: ${/** @type {Error} */ (err).message}` };
    }
    const { sheets } = book;
    // tables in reading order: by sheet, then top to bottom, left to right
    /** @type {Table[]} */
    const tables = [...(book.tables || [])].sort(
        (a, b) => a.sheet - b.sheet || a.range.r0 - b.range.r0 || a.range.c0 - b.range.c0,
    );
    if (!sheets.length) return { error: 'Not shown: no sheets in this workbook' };
    const cached = () => sheets.filter((s) => s.data !== undefined).length;

    // Sheet read once: data = { rows, cols } or null (no cells: chart, module, unreadable)
    /** @param {number} i @returns {Promise<void>} */
    const loadSheet = async (i) => {
        const s = sheets[i];
        if (s.data === undefined) {
            try {
                s.data = await book.load(i);
                if (!s.data) s.note = s.kind === 'chart' ? 'Chart sheet: no cells to show.' : 'No cells to show.';
            } catch (err) {
                if (/** @type {Error} */ (err).name === 'AbortError') throw err;
                s.data = null;
                s.note = `This sheet could not be read: ${/** @type {Error} */ (err).message}`;
            }
        }
        // all content shown is here once every sheet is: then the whole file counts as cached
        src.done = cached() === sheets.length;
        src.loaded = src.done ? file.size : Math.min(file.fetched(), file.size - 1);
    };

    // First sheet: active when saved (else first visible worksheet)
    /** @param {number} i */
    const usable = (i) => sheets[i] && sheets[i].kind === 'sheet' && !sheets[i].hidden;
    const firstSheet = usable(book.active)
        ? book.active
        : Math.max(
              0,
              sheets.findIndex((_, i) => usable(i)),
          );
    // Entry a view starts with: the sheet shown, or the first table on it (else the first table)
    /** @param {SheetMode} m @returns {number} */
    const startOf = (m) => {
        const at = src.sheetOf(src.current);
        return m === 'sheets'
            ? at
            : Math.max(
                  0,
                  tables.findIndex((t) => t.sheet === at),
              );
    };

    /** @type {Source} */
    const src = {
        total: file.size,
        loaded: 0,
        done: false,
        isSheet: true,
        wholeLines: true,
        dates: file.dates,
        format: book.format,
        sheets,
        tables,
        tablesRead: !!book.tables, // false: format without tables read (.xls)
        mode: /** @type {SheetMode} */ ('sheets'),
        current: firstSheet,
        waiting: false, // nothing shown yet: a sheet or table is to be chosen first
        /** @type {SheetShown} */
        shown: { rows: [], header: [], note: '', text: '' },
        text: '',
        label: () => `${cached().toLocaleString()} of ${sheets.length.toLocaleString()} sheets cached`,
        nextLabel: 'Cache next sheet',
        get info() {
            const { rows, header } = src.shown;
            const hidden = sheets.filter((x) => x.hidden).length;
            const shape = rows.length ? `: ${rows.length.toLocaleString()} rows × ${header.length} columns` : '';
            const hiddenNote = hidden ? ` (${hidden} hidden)` : '';
            const info = [['sheets', `${sheets.length}${hiddenNote}`]];
            if (book.tables) info.push(['tables', tables.length.toLocaleString()]);
            if (src.waiting) info.push(['shown', 'none yet (select a sheet or table)']);
            else if (src.mode === 'tables') {
                const t = tables[src.current];
                info.push(['table', `${t.name} (${sheets[t.sheet].name}!${rangeText(t.range)})${shape}`]);
            } else {
                const s = sheets[src.current];
                const cutNote = s.data?.cut ? ` (first ${MAX_SHEET_CELLS.toLocaleString()} cells)` : '';
                info.push(['sheet', `${s.name}${shape}${cutNote}`]);
            }
            if (book.date1904) info.push(['dates', '1904 system']);
            return info;
        },
        loadSheet,
        startOf,
        // Sheet behind entry i of a view (its table's sheet for tables)
        /** @param {number} i @param {SheetMode} [m] @returns {number} */
        sheetOf: (i, m = src.mode) => (m === 'tables' ? tables[i].sheet : i),
        // Shows entry i of a view (its sheet cached before)
        /** @param {number} i @param {SheetMode} [m] @returns {void} */
        select: (i, m = src.mode) => {
            src.waiting = false;
            src.mode = m === 'tables' && tables[i] ? 'tables' : 'sheets';
            src.current = i;
            src.shown = src.mode === 'tables' ? tableShown(tables[i], sheets[tables[i].sheet]) : sheetShown(sheets[i]);
            src.text = src.shown.text;
        },
        more: async () => {
            const at = src.sheetOf(src.current);
            if (src.waiting) {
                await loadSheet(at); // the entry proposed first
                return src.select(src.current);
            }
            for (let k = 1; k <= sheets.length; k++) {
                const i = (at + k) % sheets.length;
                if (sheets[i].data === undefined) return loadSheet(i);
            }
        },
        loadAll: async () => {
            for (let i = 0; i < sheets.length; i++) await loadSheet(i);
            if (src.waiting) src.select(src.current);
        },
    };

    const start = mode === 'tables' && tables.length ? 'tables' : 'sheets';
    const first = startOf(start);
    if (file.size > autoload) {
        src.mode = start;
        src.current = first;
        src.waiting = true;
        src.loaded = Math.min(file.fetched(), file.size - 1);
        const size = formatBytes(file.size);
        const note = `Large spreadsheet (${size}): select a sheet or table first (picker bottom right).`;
        src.shown = { rows: [], header: [], note, text: '' };
        return src;
    }
    await loadSheet(src.sheetOf(first, start));
    src.select(first, start);
    return src;
}

// Sheet shown: rows as they are, columns A, B, …; its text with column letters and row numbers (as in Excel)
/** @param {Sheet} s @returns {SheetShown} */
function sheetShown(s) {
    const d = s.data;
    if (!d?.rows.length) return { rows: [], header: [], note: s.note || 'Empty sheet: no cells.', text: '' };
    const header = Array.from({ length: d.cols }, (_, c) => colName(c));
    return { rows: d.rows, header, note: '', text: csvRows([header].concat(d.rows), d.cols, true) };
}

// Table shown: its rows below the header row, without totals rows; column names as header
/** @param {Table} t @param {Sheet} s @returns {SheetShown} */
function tableShown(t, s) {
    const d = s.data;
    if (!d) return { rows: [], header: [], note: s.note || 'No cells to show.', text: '' };
    const { r0, c0 } = t.range;
    // not beyond the sheet's cells (against damaged or hostile ranges)
    const c1 = Math.min(t.range.c1, Math.max(d.cols, c0 + t.columns.length) - 1);
    const r1 = Math.min(t.range.r1 - t.totals, d.rows.length - 1);
    const width = Math.max(0, c1 - c0 + 1);
    /** @param {number} r @returns {string[]} */
    const cells = (r) => Array.from({ length: width }, (_, k) => d.rows[r]?.[c0 + k] ?? '');
    const names = t.header ? cells(r0) : [];
    const header = Array.from({ length: width }, (_, k) => t.columns[k] || names[k] || colName(c0 + k));
    const rows = [];
    for (let r = r0 + t.header; r <= r1; r++) rows.push(cells(r));
    const note = rows.length ? '' : 'Empty table: no rows below its header.';
    return { rows, header, note, text: rows.length ? csvRows([header].concat(rows), width) : '' };
}

// Rows as CSV, padded to all columns; numbered: row numbers first (none for the header row)
/** @param {string[][]} rows @param {number} cols @param {boolean} [numbered] @returns {string} */
function csvRows(rows, cols, numbered = false) {
    const out = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        let line = numbered && i ? String(i) : '';
        for (let c = 0; c < cols; c++) line += (c || numbered ? ',' : '') + csvCell(r[c] ?? '');
        out[i] = line;
    }
    return out.join('\n');
}
