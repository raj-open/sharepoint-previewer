// Excel binary workbook (.xlsb): same parts as OOXML, as BIFF12 records

// ===========================================================================
// IMPORTS
// ===========================================================================

import { dataView } from '../bytes.ts';
import { utf16le } from '../bytes.ts';
import { BUILTIN_FORMATS } from './cells.ts';
import { numberText } from './cells.ts';
import { SHEET_ERRORS } from './cells.ts';
import { sheetGrid } from './cells.ts';

import type { SheetParts } from '../../_core/types.ts';
import type { TablePart } from '../../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// RK: 30-bit integer or high bits of a double, optionally divided by 100
const rkView = new DataView(new ArrayBuffer(8));

// ===========================================================================
// METHODS
// ===========================================================================

// Records: type and size as 7-bit varints, then data
function biff12Records(b: Uint8Array, on: (type: number, data: Uint8Array) => void): void {
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
function wideString(d: Uint8Array, at: number): { text: string; end: number } {
    if (at + 4 > d.length) return { text: '', end: d.length };
    const n = dataView(d).getUint32(at, true);
    if (n === 0xffffffff) return { text: '', end: at + 4 };
    const end = Math.min(d.length, at + 4 + 2 * n);
    return { text: utf16le.decode(d.subarray(at + 4, end)), end };
}

export function rkNumber(rk: number): number {
    let n: number;
    if (rk & 2) n = rk >> 2;
    else {
        rkView.setUint32(0, 0, true);
        rkView.setUint32(4, rk & 0xfffffffc, true);
        n = rkView.getFloat64(0, true);
    }
    return rk & 1 ? n / 100 : n;
}

export const XLSB_PARTS: SheetParts = {
    workbook(bytes) {
        const sheets: { name: string; id: string; hidden: boolean }[] = [];
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
        const out: string[] = [];
        biff12Records(bytes, (type, d) => {
            if (type === 19) out.push(wideString(d, 1).text); // BrtSSTItem: flags, text
        });
        return out;
    },

    styles(bytes) {
        const codes = new Map();
        const xfs: number[] = [];
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
            const num = (n: number) => numberText(n, kinds[dv.getUint32(4, true) & 0xffffff] || '', date1904);
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

    // Table: BrtBeginList (range, header and totals rows, names), BrtBeginListCol (column names)
    table(bytes) {
        let out: TablePart | null = null;
        const columns: string[] = [];
        biff12Records(bytes, (type, d) => {
            const dv = dataView(d);
            if (type === 343 && d.length >= 68 && !out) {
                // range: first and last row, first and last column; names after 13 fixed fields
                const name = wideString(d, 64);
                const shown = wideString(d, name.end).text;
                out = {
                    name: shown || name.text,
                    range: {
                        r0: dv.getUint32(0, true),
                        r1: dv.getUint32(4, true),
                        c0: dv.getUint32(8, true),
                        c1: dv.getUint32(12, true),
                    },
                    header: dv.getUint32(24, true),
                    totals: dv.getUint32(28, true),
                    columns,
                };
            } else if (type === 347 && d.length >= 28) {
                // name (often none), then caption shown in the header row
                const name = wideString(d, 24);
                columns.push(wideString(d, name.end).text || name.text);
            }
        });
        return out;
    },
};
