import { dataView, latin1, utf16le } from '../bytes.js';
import { BUILTIN_FORMATS, formatKind, numberText, SHEET_ERRORS, sheetGrid } from './cells.js';
import { compoundFile } from './cfb.js';
import { rkNumber } from './xlsb.js';

/** @typedef {import('../../_core/types.js').ByteReader} ByteReader */
/** @typedef {import('../../_core/types.js').Book} Book */
/** @typedef {import('../../_core/types.js').Sheet} Sheet */

// Code pages of BIFF5 texts (BIFF8 texts are Unicode)
/** @type {Object<number, string>} */
const CODEPAGES = {
  367: 'windows-1252',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  10000: 'macintosh',
  32768: 'macintosh',
  32769: 'windows-1252',
};

/** @param {number} cp @returns {TextDecoder} */
function codepageDecoder(cp) {
  try {
    return new TextDecoder(CODEPAGES[cp] || `windows-${cp}`);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

// BIFF8 XLUnicodeString: count (2 bytes, or 1 for short ones), flags, [runs, extension sizes], characters
/** @param {Uint8Array} d @param {number} at @param {boolean} [short] @returns {string} */
function biffString(d, at, short = false) {
  const n = short ? d[at] : d[at] | (d[at + 1] << 8);
  let p = at + (short ? 1 : 2);
  const flags = d[p++];
  if (flags & 8) p += 2;
  if (flags & 4) p += 4;
  return flags & 1 ? utf16le.decode(d.subarray(p, p + 2 * n)) : latin1(d.subarray(p, p + n));
}

// Shared strings: SST record and its CONTINUE records; text crossing them gets a new flag byte
/** @param {Uint8Array[]} parts @returns {string[]} */
function biffStrings(parts) {
  const out = [];
  let k = 0;
  let d = parts[0];
  let p = 8; // after total and unique counts
  const next = () => {
    while (p >= d.length && k < parts.length - 1) {
      d = parts[++k];
      p = 0;
    }
    return p < d.length;
  };
  const u8 = () => (next() ? d[p++] : 0);
  const u16 = () => u8() | (u8() << 8);
  /** @param {number} n */
  const skip = (n) => {
    while (n > 0 && next()) {
      const step = Math.min(n, d.length - p);
      p += step;
      n -= step;
    }
  };
  while (next()) {
    let n = u16();
    let flags = u8();
    const runs = flags & 8 ? u16() : 0;
    const ext = flags & 4 ? u16() + u16() * 65536 : 0;
    let s = '';
    while (n > 0) {
      if (p >= d.length) {
        if (k >= parts.length - 1) break;
        d = parts[++k];
        p = 0;
        flags = d[p++]; // text goes on in next record: 1 or 2 bytes per character from here
      }
      const wide = flags & 1 ? 2 : 1;
      const take = Math.min(n, Math.floor((d.length - p) / wide));
      if (take <= 0) {
        p = d.length;
        continue;
      }
      const bytes = d.subarray(p, p + take * wide);
      s += wide === 2 ? utf16le.decode(bytes) : latin1(bytes);
      p += bytes.length;
      n -= take;
    }
    skip(runs * 4 + ext);
    out.push(s);
  }
  return out;
}

const BIFF_BOF = new Set([0x0009, 0x0209, 0x0409, 0x0809]);
/** @type {Object<number, string>} */
const XLS_KINDS = { 0: 'sheet', 1: 'sheet', 2: 'chart', 6: 'module' }; // macro sheets have cells too

/** @param {ByteReader} read @param {number} size @returns {Promise<Book>} */
export async function readXls(read, size) {
  const cfb = await compoundFile(read, size);
  if (cfb.find('EncryptedPackage')) throw new Error('the file is password-protected');
  const entry = cfb.find('Workbook') || cfb.find('Book');
  if (!entry) throw new Error('no workbook inside (not an Excel file?)');
  const stream = await cfb.stream(entry);

  // Records from `from` to the end of their substream (BOF … EOF); nested ones (charts) skipped
  /** @param {number} from @param {number} to @param {(type: number, data: Uint8Array) => void} on */
  const records = async (from, to, on) => {
    let buf = await stream.bytes(from, Math.min(to, from + 65536));
    /** @param {number} need */
    const grow = async (need) => {
      if (need > buf.length && from + buf.length < to) {
        buf = await stream.bytes(from, Math.min(to, from + Math.max(need, 2 * buf.length)));
      }
    };
    let depth = 0;
    for (let p = 0; ; ) {
      await grow(p + 4);
      if (p + 4 > buf.length) return;
      const type = buf[p] | (buf[p + 1] << 8);
      const len = buf[p + 2] | (buf[p + 3] << 8);
      if (p + 4 + len > buf.length) await grow(p + 4 + len);
      const data = buf.subarray(p + 4, p + 4 + len);
      p += 4 + len;
      if (BIFF_BOF.has(type)) depth++;
      if (depth <= 1) on(type, data);
      if (type === 0x000a && --depth <= 0) return; // EOF
    }
  };

  // Workbook globals: sheets, formats, cell styles, shared strings, date system
  let biff8 = true;
  let text8 = new TextDecoder('windows-1252');
  /** @type {(Sheet & { pos: number })[]} */
  const sheets = [];
  const codes = new Map();
  /** @type {number[]} */
  const xfs = [];
  /** @type {Uint8Array[]|null} */
  let sst = null;
  let last = 0;
  let date1904 = false;
  let active = -1;
  await records(0, stream.size, (type, d) => {
    if (type === 0x003c && sst && last === 0x00fc) return void sst.push(d); // CONTINUE of SST
    last = type;
    if (d.length < 2) return;
    const dv = dataView(d);
    if (type === 0x0809) biff8 = dv.getUint16(0, true) >= 0x0600;
    else if (type === 0x002f)
      throw new Error('the file is password-protected'); // FILEPASS
    else if (type === 0x0042) text8 = codepageDecoder(dv.getUint16(0, true));
    else if (type === 0x0022) date1904 = dv.getUint16(0, true) === 1;
    else if (type === 0x003d && active < 0 && d.length >= 12)
      active = dv.getUint16(10, true); // WINDOW1
    else if (type === 0x0085 && d.length >= 7) {
      // BOUNDSHEET: position of its BOF in stream, visibility, type, name
      sheets.push({
        pos: dv.getUint32(0, true),
        size: 0, // set below, from the next sheet's position
        hidden: (d[4] & 3) !== 0,
        kind: XLS_KINDS[d[5]] || 'module',
        name: biff8 ? biffString(d, 6, true) : text8.decode(d.subarray(7, 7 + d[6])),
      });
    } else if (type === 0x041e && d.length >= 3) {
      codes.set(dv.getUint16(0, true), biff8 ? biffString(d, 2) : text8.decode(d.subarray(3, 3 + d[2])));
    } else if (type === 0x00e0 && d.length >= 4) xfs.push(dv.getUint16(2, true));
    else if (type === 0x00fc) sst = [d];
  });
  const strings = sst ? biffStrings(sst) : [];
  const kinds = xfs.map((id) => formatKind(codes.get(id) ?? BUILTIN_FORMATS[id] ?? ''));

  // Each sheet: from its BOF up to the next sheet's (or end of stream)
  const starts = [...sheets.map((s) => s.pos), stream.size].sort((a, b) => a - b);
  for (const s of sheets) s.size = Math.max(0, (starts.find((x) => x > s.pos) ?? s.pos) - s.pos);

  /** @param {number} i */
  const load = async (i) => {
    const s = sheets[i];
    if (s.kind !== 'sheet' || s.pos >= stream.size) return null;
    const grid = sheetGrid();
    /** @param {number} xf @param {number} n */
    const num = (xf, n) => numberText(n, kinds[xf] || '', date1904);
    /** @param {Uint8Array} d @param {number} at */
    const label = (d, at) =>
      biff8 ? biffString(d, at) : text8.decode(d.subarray(at + 2, at + 2 + (d[at] | (d[at + 1] << 8))));
    /** @type {[number, number]|null} */
    let pending = null; // formula with text result: text follows in STRING record
    await records(s.pos, s.pos + s.size, (type, d) => {
      if (type === 0x0207 && pending) {
        grid.set(pending[0], pending[1], label(d, 0));
        pending = null;
        return;
      }
      if (d.length < 6) return;
      const dv = dataView(d);
      const r = dv.getUint16(0, true);
      const c = dv.getUint16(2, true);
      const xf = dv.getUint16(4, true);
      if (type === 0x0203 && d.length >= 14)
        grid.set(r, c, num(xf, dv.getFloat64(6, true))); // NUMBER
      else if (type === 0x027e && d.length >= 10)
        grid.set(r, c, num(xf, rkNumber(dv.getUint32(6, true)))); // RK
      else if (type === 0x00bd) {
        // MULRK: (style, RK) per column from c on
        for (let k = 0, at = 4; at + 6 <= d.length - 2; k++, at += 6) {
          grid.set(r, c + k, num(dv.getUint16(at, true), rkNumber(dv.getUint32(at + 2, true))));
        }
      } else if (type === 0x00fd && d.length >= 10)
        grid.set(r, c, strings[dv.getUint32(6, true)] ?? ''); // LABELSST
      else if (type === 0x0204 || type === 0x00d6)
        grid.set(r, c, label(d, 6)); // LABEL, RSTRING
      else if (type === 0x0205 && d.length >= 8) {
        grid.set(r, c, d[7] ? (SHEET_ERRORS[d[6]] ?? '#ERROR') : d[6] ? 'TRUE' : 'FALSE'); // BOOLERR
      } else if (type === 0x0006 && d.length >= 14) {
        // FORMULA: last result; 0xFFFF at end marks text, boolean, error or empty text
        if (dv.getUint16(12, true) !== 0xffff) grid.set(r, c, num(xf, dv.getFloat64(6, true)));
        else if (d[6] === 0) pending = [r, c];
        else if (d[6] === 1) grid.set(r, c, d[8] ? 'TRUE' : 'FALSE');
        else if (d[6] === 2) grid.set(r, c, SHEET_ERRORS[d[8]] ?? '#ERROR');
      }
    });
    return grid.done();
  };

  return {
    format: biff8 ? 'Excel 97–2003 (XLS)' : 'Excel 5.0/95 (XLS)',
    sheets: sheets.map(({ pos, ...s }) => s),
    active: Math.max(0, active),
    date1904,
    load,
  };
}
