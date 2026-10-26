// Workbook of any of these formats, by its signature

// ===========================================================================
// IMPORTS
// ===========================================================================

import { SHEET_AUTOLOAD_BYTES } from '../../_core/settings.ts';
import { csvCell } from '../../_core/util.ts';
import { formatBytes } from '../../_core/util.ts';
import { openRanges } from '../ranges.ts';
import { colName } from './cells.ts';
import { MAX_SHEET_CELLS } from './cells.ts';
import { rangeText } from './cells.ts';
import { readOds } from './ods.ts';
import { readOoxml } from './ooxml.ts';
import { zipPackage } from './package.ts';
import { readXls } from './xls.ts';

import type { Source } from '../../_core/types.ts';
import type { ByteReader } from '../../_core/types.ts';
import type { Book } from '../../_core/types.ts';
import type { Sheet } from '../../_core/types.ts';
import type { SheetMode } from '../../_core/types.ts';
import type { SheetSource } from '../../_core/types.ts';
import type { SheetShown } from '../../_core/types.ts';
import type { Table } from '../../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

export async function readBook(read: ByteReader, size: number, head: Uint8Array): Promise<Book> {
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
 * @param mode start view (sheets if there are no tables)
 * @param autoload largest file whose first sheet or table is shown at once
 */
export async function openSheetSource(
    url: string,
    getSignal: () => AbortSignal,
    reload: boolean,
    onProgress: (loaded: number, total: number) => void,
    mode: SheetMode = 'sheets',
    autoload: number = SHEET_AUTOLOAD_BYTES,
): Promise<Source | { error: string }> {
    const file = await openRanges(url, getSignal, reload, onProgress);
    if ('error' in file) return file;
    let book: Book;
    try {
        book = await readBook(file.read, file.size, file.head);
    } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        return { error: `Not shown: ${(err as Error).message}` };
    }
    const { sheets } = book;
    // tables in reading order: by sheet, then top to bottom, left to right
    const tables: Table[] = [...(book.tables || [])].sort(
        (a, b) => a.sheet - b.sheet || a.range.r0 - b.range.r0 || a.range.c0 - b.range.c0,
    );
    if (!sheets.length) return { error: 'Not shown: no sheets in this workbook' };
    const cached = () => sheets.filter((s) => s.data !== undefined).length;

    // Sheet read once: data = { rows, cols } or null (no cells: chart, module, unreadable)
    const loadSheet = async (i: number): Promise<void> => {
        const s = sheets[i];
        if (s.data === undefined) {
            try {
                s.data = await book.load(i);
                if (!s.data) s.note = s.kind === 'chart' ? 'Chart sheet: no cells to show.' : 'No cells to show.';
            } catch (err) {
                if ((err as Error).name === 'AbortError') throw err;
                s.data = null;
                s.note = `This sheet could not be read: ${(err as Error).message}`;
            }
        }
        // all content shown is here once every sheet is: then the whole file counts as cached
        src.done = cached() === sheets.length;
        src.loaded = src.done ? file.size : Math.min(file.fetched(), file.size - 1);
    };

    // First sheet: active when saved (else first visible worksheet)
    const usable = (i: number) => sheets[i] && sheets[i].kind === 'sheet' && !sheets[i].hidden;
    const firstSheet = usable(book.active)
        ? book.active
        : Math.max(
              0,
              sheets.findIndex((_, i) => usable(i)),
          );
    // Entry a view starts with: the sheet shown, or the first table on it (else the first table)
    const startOf = (m: SheetMode): number => {
        const at = src.sheetOf(src.current);
        return m === 'sheets'
            ? at
            : Math.max(
                  0,
                  tables.findIndex((t) => t.sheet === at),
              );
    };

    const src: SheetSource = {
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
        mode: 'sheets',
        current: firstSheet,
        waiting: false, // nothing shown yet: a sheet or table is to be chosen first
        shown: { rows: [], header: [], note: '', text: '' },
        text: '',
        label: () => `${cached().toLocaleString()} of ${sheets.length.toLocaleString()} sheets cached`,
        nextLabel: 'Cache next sheet',
        get info() {
            const { rows, header } = src.shown;
            const hidden = sheets.filter((x) => x.hidden).length;
            const shape = rows.length ? `: ${rows.length.toLocaleString()} rows × ${header.length} columns` : '';
            const hiddenNote = hidden ? ` (${hidden} hidden)` : '';
            const info: [string, string][] = [['sheets', `${sheets.length}${hiddenNote}`]];
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
        sheetOf: (i: number, m: SheetMode = src.mode): number => (m === 'tables' ? tables[i].sheet : i),
        // Shows entry i of a view (its sheet cached before)
        select: (i: number, m: SheetMode = src.mode): void => {
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
function sheetShown(s: Sheet): SheetShown {
    const d = s.data;
    if (!d?.rows.length) return { rows: [], header: [], note: s.note || 'Empty sheet: no cells.', text: '' };
    const header = Array.from({ length: d.cols }, (_, c) => colName(c));
    return { rows: d.rows, header, note: '', text: csvRows([header].concat(d.rows), d.cols, true) };
}

// Table shown: its rows below the header row, without totals rows; column names as header
function tableShown(t: Table, s: Sheet): SheetShown {
    const d = s.data;
    if (!d) return { rows: [], header: [], note: s.note || 'No cells to show.', text: '' };
    const { r0, c0 } = t.range;
    // not beyond the sheet's cells (against damaged or hostile ranges)
    const c1 = Math.min(t.range.c1, Math.max(d.cols, c0 + t.columns.length) - 1);
    const r1 = Math.min(t.range.r1 - t.totals, d.rows.length - 1);
    const width = Math.max(0, c1 - c0 + 1);
    const cells = (r: number): string[] => Array.from({ length: width }, (_, k) => d.rows[r]?.[c0 + k] ?? '');
    const names = t.header ? cells(r0) : [];
    const header = Array.from({ length: width }, (_, k) => t.columns[k] || names[k] || colName(c0 + k));
    const rows = [];
    for (let r = r0 + t.header; r <= r1; r++) rows.push(cells(r));
    const note = rows.length ? '' : 'Empty table: no rows below its header.';
    return { rows, header, note, text: rows.length ? csvRows([header].concat(rows), width) : '' };
}

// Rows as CSV, padded to all columns; numbered: row numbers first (none for the header row)
function csvRows(rows: string[][], cols: number, numbered = false): string {
    const out = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        let line = numbered && i ? String(i) : '';
        for (let c = 0; c < cols; c++) line += (c || numbered ? ',' : '') + csvCell(r[c] ?? '');
        out[i] = line;
    }
    return out.join('\n');
}
