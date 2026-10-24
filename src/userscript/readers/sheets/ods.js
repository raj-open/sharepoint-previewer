import { generalText, MAX_SHEET_COLS, MAX_SHEET_ROWS, sheetGrid } from './cells.js';
import { scanXml, xmlAttrs, xmlString, xmlText } from './xml.js';

/** @typedef {import('../../types.js').SheetData} SheetData */
/** @typedef {import('../../types.js').Book} Book */

// --- OpenDocument spreadsheet: all sheets in content.xml, cells with their display text ---

/** @param {string} xml @returns {{ name: string, data: SheetData }[]} */
function odsSheets(xml) {
  const sheets = [];
  let grid = null;
  let name = '';
  let depth = 0; // tables inside cells (rare) are part of their cell
  let r = 0;
  let c = 0;
  let row = null; // texts of current row
  let rowRepeat = 1;
  let cell = null; // { repeat, text, value } (value: typed, else text shown)
  let para = 0;
  let note = 0; // annotations (comments): not part of cell text
  const add = (s) => {
    if (cell && para && !note) cell.text += s;
  };
  scanXml(
    xml,
    (n, a) => {
      if (n === 'table') {
        if (depth++) return;
        grid = sheetGrid();
        name = xmlAttrs(a).name || `Sheet${sheets.length + 1}`;
        r = 0;
      }
      if (depth !== 1) return;
      if (n === 'table-row') {
        rowRepeat = Math.max(1, Number(xmlAttrs(a)['number-rows-repeated']) || 1);
        row = [];
        c = 0;
      } else if (n === 'table-cell' || n === 'covered-table-cell') {
        const at = xmlAttrs(a);
        cell = { repeat: Math.max(1, Number(at['number-columns-repeated']) || 1), text: null, value: odsValue(at) };
      } else if (n === 'annotation') note++;
      else if (n === 'p' && cell && !note) {
        cell.text = cell.text === null ? '' : `${cell.text}\n`;
        para++;
      } else if (n === 's') add(' '.repeat(Math.min(1000, Number(xmlAttrs(a).c) || 1)));
      else if (n === 'tab') add('\t');
      else if (n === 'line-break') add('\n');
    },
    (n) => {
      if (n === 'table') {
        if (--depth) return;
        sheets.push({ name, data: grid.done() });
        grid = null;
      }
      if (depth !== 1) return;
      if (n === 'p' && para) para--;
      else if (n === 'annotation') note--;
      else if ((n === 'table-cell' || n === 'covered-table-cell') && cell && row) {
        const text = cell.value ?? cell.text ?? '';
        if (text !== '') for (let k = 0; k < cell.repeat && c + k < MAX_SHEET_COLS; k++) row[c + k] = text;
        c += cell.repeat;
        cell = null;
      } else if (n === 'table-row' && row) {
        // repeated rows: often a million empty ones at the end, kept only while they hold text
        if (row.length) {
          for (let k = 0; k < rowRepeat && r + k < MAX_SHEET_ROWS; k++) {
            if (!row.every((t, col) => grid.set(r + k, col, t))) break;
          }
        }
        r += rowRepeat;
        row = null;
      }
    },
    (raw) => add(xmlText(raw)),
  );
  return sheets;
}

// Typed value as the Excel formats show it (ISO dates, plain numbers); null = use cell text
/** @param {Object<string, string>} at @returns {string|null} */
function odsValue(at) {
  const type = at['value-type'];
  const n = Number(at.value);
  if ((type === 'float' || type === 'currency') && at.value) return generalText(n);
  if (type === 'percentage' && at.value) return `${generalText(n * 100)}%`;
  if (type === 'boolean') return /^true$/i.test(at['boolean-value'] || '') ? 'TRUE' : 'FALSE';
  if (type === 'date' && at['date-value']) return at['date-value'].replace('T', ' ').replace(/(\.\d+)?Z?$/, '');
  const t = type === 'time' && /^-?PT(\d+)H(\d+)M(\d+)/.exec(at['time-value'] || '');
  if (t) return [t[1], t[2], t[3]].map((x) => x.padStart(2, '0')).join(':');
  return null;
}

/** @param {Object} pkg @returns {Promise<Book>} */
export async function readOds(pkg) {
  if ((await pkg.text('META-INF/manifest.xml'))?.includes('encryption-data')) {
    throw new Error('the file is password-protected');
  }
  const found = odsSheets(xmlString(await pkg.bytes('content.xml')));
  // all sheets come with content.xml: cached at once
  const sheets = found.map((s) => ({ name: s.name, hidden: false, kind: 'sheet', size: 0, data: s.data }));
  return {
    format: 'OpenDocument spreadsheet',
    sheets,
    active: 0,
    date1904: false,
    load: async (i) => sheets[i].data,
  };
}
