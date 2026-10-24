import { csvCell } from '../../_core/util.js';
import { openRanges } from '../ranges.js';
import { colName, MAX_SHEET_CELLS } from './cells.js';
import { readOds } from './ods.js';
import { readOoxml } from './ooxml.js';
import { zipPackage } from './package.js';
import { readXls } from './xls.js';
/** @typedef {import('../../_core/types.js').Source} Source */
/** @typedef {import('../../_core/types.js').ByteReader} ByteReader */
/** @typedef {import('../../_core/types.js').Book} Book */

// --- Workbook of any of these formats, by its signature ---

/** @param {ByteReader} read @param {number} size @param {Uint8Array} head @returns {Promise<Book>} */
export async function readBook(read, size, head) {
  if (head[0] === 0xd0 && head[1] === 0xcf) return readXls(read, size);
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    throw new Error(head[0] === 0x09 ? 'Excel 2.x–4.x files are not supported' : 'not a spreadsheet file');
  }
  const pkg = await zipPackage(read, size);
  return pkg.entry('content.xml') && !pkg.entry('[Content_Types].xml') ? readOds(pkg) : readOoxml(pkg);
}

// Spreadsheet source like openSource(): text = sheet shown, as CSV; more() = next sheet not cached
/** @param {string} url @param {() => AbortSignal} getSignal @param {boolean} reload @param {(loaded: number, total: number) => void} onProgress @returns {Promise<Source|{ error: string }>} */
export async function openSheetSource(url, getSignal, reload, onProgress) {
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
    current: 0,
    text: '',
    label: () => `${cached().toLocaleString()} of ${sheets.length.toLocaleString()} sheets cached`,
    nextLabel: 'Cache next sheet',
    get info() {
      const s = sheets[src.current];
      const d = s.data;
      const hidden = sheets.filter((x) => x.hidden).length;
      const shape = d?.rows.length ? `: ${d.rows.length.toLocaleString()} rows × ${d.cols} columns` : '';
      const hiddenNote = hidden ? ` (${hidden} hidden)` : '';
      const cutNote = d?.cut ? ` (first ${MAX_SHEET_CELLS.toLocaleString()} cells)` : '';
      const info = [
        ['sheets', `${sheets.length}${hiddenNote}`],
        ['sheet', `${s.name}${shape}${cutNote}`],
      ];
      if (book.date1904) info.push(['dates', '1904 system']);
      return info;
    },
    loadSheet,
    /** @param {number} i @returns {void} */
    select: (i) => {
      src.current = i;
      const d = sheets[i].data;
      src.text = d ? csvRows(d.rows, d.cols) : '';
    },
    header: () => Array.from({ length: sheets[src.current].data?.cols || 0 }, (_, c) => colName(c)),
    more: async () => {
      for (let k = 1; k <= sheets.length; k++) {
        const i = (src.current + k) % sheets.length;
        if (sheets[i].data === undefined) return loadSheet(i);
      }
    },
    loadAll: async () => {
      for (let i = 0; i < sheets.length; i++) await loadSheet(i);
    },
  };

  // First: sheet active when saved (else first visible worksheet)
  /** @param {number} i */
  const usable = (i) => sheets[i] && sheets[i].kind === 'sheet' && !sheets[i].hidden;
  const first = usable(book.active)
    ? book.active
    : Math.max(
        0,
        sheets.findIndex((_, i) => usable(i)),
      );
  await loadSheet(first);
  src.select(first);
  return src;
}

// Rows as CSV, padded to all columns
/** @param {string[][]} rows @param {number} cols @returns {string} */
function csvRows(rows, cols) {
  const out = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let line = '';
    for (let c = 0; c < cols; c++) line += (c ? ',' : '') + csvCell(r[c] ?? '');
    out[i] = line;
  }
  return out.join('\n');
}
