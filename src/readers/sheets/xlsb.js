import { dataView, utf16le } from '../bytes.js';
import { BUILTIN_FORMATS, numberText, SHEET_ERRORS, sheetGrid } from './cells.js';

/** @typedef {import('../../_core/types.js').SheetParts} SheetParts */

// --- Excel binary workbook (.xlsb): same parts as OOXML, as BIFF12 records ---

// Records: type and size as 7-bit varints, then data
/** @param {Uint8Array} b @param {(type: number, data: Uint8Array) => void} on @returns {void} */
function biff12Records(b, on) {
  let p = 0;
  while (p < b.length) {
    let type = b[p++];
    if (type & 0x80) type = (type & 0x7f) | ((b[p++] & 0x7f) << 7);
    let size = 0;
    for (let i = 0; i < 4; i++) {
      const x = b[p++];
      size |= (x & 0x7f) << (7 * i);
      if (!(x & 0x80)) break;
    }
    on(type, b.subarray(p, p + size));
    p += size;
  }
}

// XLWideString: character count (4 bytes), then UTF-16; count 0xFFFFFFFF = none
/** @param {Uint8Array} d @param {number} at @returns {{ text: string, end: number }} */
function wideString(d, at) {
  if (at + 4 > d.length) return { text: '', end: d.length };
  const n = dataView(d).getUint32(at, true);
  if (n === 0xffffffff) return { text: '', end: at + 4 };
  const end = Math.min(d.length, at + 4 + 2 * n);
  return { text: utf16le.decode(d.subarray(at + 4, end)), end };
}

// RK: 30-bit integer or high bits of a double, optionally divided by 100
const rkView = new DataView(new ArrayBuffer(8));
/** @param {number} rk @returns {number} */
export function rkNumber(rk) {
  let n;
  if (rk & 2) n = rk >> 2;
  else {
    rkView.setUint32(0, 0, true);
    rkView.setUint32(4, rk & 0xfffffffc, true);
    n = rkView.getFloat64(0, true);
  }
  return rk & 1 ? n / 100 : n;
}

/** @type {SheetParts} */
export const XLSB_PARTS = {
  workbook(bytes) {
    /** @type {{ name: string, id: string, hidden: boolean }[]} */
    const sheets = [];
    let active = 0;
    let date1904 = false;
    let views = 0;
    biff12Records(bytes, (type, d) => {
      const dv = dataView(d);
      if (type === 156 && d.length >= 12) {
        // BrtBundleSh: state, tab id, relationship id, name
        const id = wideString(d, 8);
        sheets.push({ name: wideString(d, id.end).text, id: id.text, hidden: dv.getUint32(0, true) !== 0 });
      } else if (type === 153 && d.length >= 4)
        date1904 = (dv.getUint32(0, true) & 1) === 1; // BrtWbProp
      else if (type === 158 && d.length >= 28 && !views++) active = dv.getUint32(24, true); // BrtBookView
    });
    return { sheets, active, date1904 };
  },

  strings(bytes) {
    /** @type {string[]} */
    const out = [];
    biff12Records(bytes, (type, d) => {
      if (type === 19) out.push(wideString(d, 1).text); // BrtSSTItem: flags, text
    });
    return out;
  },

  styles(bytes) {
    const codes = new Map();
    /** @type {number[]} */
    const xfs = [];
    let inXfs = false;
    biff12Records(bytes, (type, d) => {
      if (type === 44 && d.length >= 2)
        codes.set(d[0] | (d[1] << 8), wideString(d, 2).text); // BrtFmt
      else if (type === 617)
        inXfs = true; // BrtBeginCellXFs
      else if (type === 618) inXfs = false;
      else if (type === 47 && inXfs && d.length >= 4) xfs.push(d[2] | (d[3] << 8)); // BrtXF
    });
    return xfs.map((id) => codes.get(id) ?? BUILTIN_FORMATS[id] ?? '');
  },

  sheet(bytes, strings, kinds, date1904) {
    const grid = sheetGrid();
    let r = 0;
    biff12Records(bytes, (type, d) => {
      if (type === 0) {
        if (d.length >= 4) r = dataView(d).getUint32(0, true); // BrtRowHdr
        return;
      }
      if (!((type >= 2 && type <= 11) || type === 62) || d.length < 9) return; // cells only
      const dv = dataView(d);
      const c = dv.getUint32(0, true);
      /** @param {number} n */
      const num = (n) => numberText(n, kinds[dv.getUint32(4, true) & 0xffffff] || '', date1904);
      let text = '';
      if (type === 2) text = num(rkNumber(dv.getUint32(8, true)));
      else if (type === 5 || type === 9) text = d.length >= 16 ? num(dv.getFloat64(8, true)) : '';
      else if (type === 4 || type === 10) text = d[8] ? 'TRUE' : 'FALSE';
      else if (type === 3 || type === 11) text = SHEET_ERRORS[d[8]] ?? '#ERROR';
      else if (type === 7) text = strings[dv.getUint32(8, true)] ?? '';
      else if (type === 6 || type === 8) text = wideString(d, 8).text;
      else if (type === 62) text = wideString(d, 9).text; // rich text: flags first
      grid.set(r, c, text);
    });
    return grid.done();
  },
};
