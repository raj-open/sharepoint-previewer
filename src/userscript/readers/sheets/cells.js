/** @typedef {import('../../types.js').SheetData} SheetData */

// ---------------------------------------------------------------------------
// Spreadsheets (read only, no library): Excel (.xlsx .xlsm .xltx .xltm, .xlsb, .xls .xlt)
// and OpenDocument (.ods .ots). Cached sheet by sheet: workbook, shared strings and styles
// first, then only the sheets shown, by range (ODS keeps all sheets in one part).
// Formats: ECMA-376 (OOXML), [MS-XLSB], [MS-XLS] in [MS-CFB], OASIS OpenDocument 1.2.
// ---------------------------------------------------------------------------

export const SHEET_RE = /\.(xlsx|xlsm|xltx|xltm|xlsb|xls|xlt|ods|ots)$/i;

// Excel's own limits; cells in total kept per sheet (against damaged or hostile files)
export const MAX_SHEET_ROWS = 1048576;
export const MAX_SHEET_COLS = 16384;
export const MAX_SHEET_CELLS = 10000000;

// Format by file extension (shown before the file is read)
/** @param {string} name @returns {string|null} */
export function sheetFormat(name) {
  const ext = (name.match(SHEET_RE) || [])[1];
  if (!ext) return null;
  const upper = ext.toUpperCase();
  return /^o/i.test(ext) ? `OpenDocument spreadsheet (${upper})` : `Excel (${upper})`;
}

// --- Cells: numbers as Excel's "General" (15 digits), dates and times as ISO 8601 ---

export const SHEET_ERRORS = {
  0: '#NULL!',
  7: '#DIV/0!',
  15: '#VALUE!',
  23: '#REF!',
  29: '#NAME?',
  36: '#NUM!',
  42: '#N/A',
  43: '#GETTING_DATA',
};

// Built-in number formats other than plain numbers (ECMA-376 part 1, 18.8.30); only their kind counts
export const BUILTIN_FORMATS = {
  9: '0%',
  10: '0.00%',
  14: 'yyyy-mm-dd',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'yyyy-mm-dd h:mm',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
};
for (const id of [27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 57, 58]) BUILTIN_FORMATS[id] = 'yyyy-mm-dd'; // East Asian
for (const id of [32, 33, 34, 35, 55, 56]) BUILTIN_FORMATS[id] = 'h:mm:ss';

// Number format code -> 'date' | 'time' | 'datetime' | 'elapsed' ([h]:mm) | 'percent' | '' (plain number)
/** @param {string} code @returns {string} */
export function formatKind(code) {
  if (!code) return '';
  const plain = code
    .split(';')[0] // positive part decides
    .replace(/"[^"]*"|\\.|_.|\*./g, '') // literal text, padding
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, '') // colours, conditions, locales (not elapsed [h] [m] [s])
    .replace(/AM\/PM|A\/P/gi, '');
  if (/\[[hms]+\]/i.test(plain)) return 'elapsed';
  const time = /[hs]/i.test(plain);
  const date = /[yd]/i.test(plain) || (/m/i.test(plain) && !time);
  if (date || time) return date && time ? 'datetime' : date ? 'date' : 'time';
  return plain.includes('%') ? 'percent' : '';
}

/** @param {number} n @returns {string} */
export const generalText = (n) => String(Number(n.toPrecision(15)));

// Serial number -> text; 1900 system counts the non-existent 1900-02-29 (as Lotus 1-2-3 did)
/** @param {number} n @param {string} kind @param {boolean} date1904 @returns {string} */
export function numberText(n, kind, date1904) {
  if (!Number.isFinite(n)) return String(n);
  if (kind === 'percent') return `${generalText(n * 100)}%`;
  if (kind === 'elapsed') {
    const secs = Math.round(Math.abs(n) * 86400);
    const pad = (x) => String(x).padStart(2, '0');
    return `${n < 0 ? '-' : ''}${Math.floor(secs / 3600)}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
  }
  if (!kind || n < 0 || n >= 2958466) return generalText(n); // dates up to 9999-12-31
  const days = date1904 ? n + 1462 : n < 60 ? n + 1 : n;
  const iso = new Date(Math.round((days - 25569) * 86400) * 1000).toISOString(); // 25569 = 1970-01-01
  if (kind === 'date') return iso.slice(0, 10);
  if (kind === 'time') return iso.slice(11, 19);
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

// Column letters <-> index (0-based): A, …, Z, AA, …
/** @param {string} ref e.g. "AB12" @returns {number} */
export function refCol(ref) {
  let c = 0;
  for (let i = 0; i < ref.length; i++) {
    const k = ref.charCodeAt(i) & ~32;
    if (k < 65 || k > 90) break;
    c = c * 26 + k - 64;
  }
  return c - 1;
}

/** @param {number} c @returns {string} */
export function colName(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Cells of one sheet -> rows (no gaps between rows; missing cells are empty)
/** @returns {{ set: (r: number, c: number, text: string) => boolean, done: () => SheetData }} */
export function sheetGrid() {
  const rows = [];
  let cols = 0;
  let cells = 0;
  let cut = false;
  return {
    set(r, c, text) {
      if (text === '' || !(r >= 0 && r < MAX_SHEET_ROWS && c >= 0 && c < MAX_SHEET_COLS)) return true;
      if (cells >= MAX_SHEET_CELLS) {
        cut = true;
        return false;
      }
      cells++;
      if (!rows[r]) rows[r] = [];
      rows[r][c] = text;
      if (c >= cols) cols = c + 1;
      return true;
    },
    done() {
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      return { rows, cols, cut };
    },
  };
}
