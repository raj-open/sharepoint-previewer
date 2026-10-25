// Excel 2007+ (OOXML): workbook, shared strings, styles and sheets as XML

// ===========================================================================
// IMPORTS
// ===========================================================================

import { BUILTIN_FORMATS } from './cells.js';
import { cellRange } from './cells.js';
import { numberText } from './cells.js';
import { refCol } from './cells.js';
import { sheetGrid } from './cells.js';
import { ooxmlText } from './xml.js';
import { scanXml } from './xml.js';
import { xmlAttrs } from './xml.js';
import { xmlString } from './xml.js';
import { xmlText } from './xml.js';

/** @typedef {import('../../_core/types.js').SheetData} SheetData */
/** @typedef {import('../../_core/types.js').SheetParts} SheetParts */
/** @typedef {import('../../_core/types.js').TablePart} TablePart */

// ===========================================================================
// METHODS
// ===========================================================================

/** @type {SheetParts} */
export const XLSX_PARTS = {
    /** @param {Uint8Array} bytes */
    workbook(bytes) {
        /** @type {{ name: string, id: string, hidden: boolean }[]} */
        const sheets = [];
        let active = 0;
        let date1904 = false;
        let views = 0;
        scanXml(
            xmlString(bytes),
            (n, a) => {
                if (n === 'sheet') {
                    const at = xmlAttrs(a);
                    sheets.push({
                        name: at.name || `Sheet${sheets.length + 1}`,
                        id: at.id,
                        hidden: !!at.state && at.state !== 'visible',
                    });
                } else if (n === 'workbookPr') {
                    if (/^(1|true)$/.test(xmlAttrs(a).date1904 || '')) date1904 = true; // extensions may repeat it without
                } else if (n === 'workbookView' && !views++) {
                    active = Number(xmlAttrs(a).activeTab) || 0;
                }
            },
            () => {},
        );
        return { sheets, active, date1904 };
    },

    /** @param {Uint8Array} bytes @returns {string[]} */
    strings(bytes) {
        /** @type {string[]} */
        const out = [];
        /** @type {string|null} */
        let cur = null;
        let inText = false;
        let phonetic = 0; // <rPh>: reading aid, not part of the text
        scanXml(
            xmlString(bytes),
            (n) => {
                if (n === 'si') cur = '';
                else if (n === 'rPh') phonetic++;
                else if (n === 't') inText = true;
            },
            (n) => {
                if (n === 'si') {
                    out.push(ooxmlText(cur ?? ''));
                    cur = null;
                } else if (n === 'rPh') phonetic--;
                else if (n === 't') inText = false;
            },
            (raw) => {
                if (inText && !phonetic && cur !== null) cur += xmlText(raw);
            },
        );
        return out;
    },

    // Number format code per cell style (index = style "s" of cells)
    /** @param {Uint8Array} bytes @returns {string[]} */
    styles(bytes) {
        const codes = new Map();
        /** @type {number[]} */
        const xfs = [];
        let where = ''; // 'numFmts' | 'cellXfs'
        scanXml(
            xmlString(bytes),
            (n, a) => {
                if (n === 'numFmts' || n === 'cellXfs') where = n;
                else if (n === 'numFmt' && where === 'numFmts') {
                    const at = xmlAttrs(a);
                    codes.set(Number(at.numFmtId), at.formatCode || '');
                } else if (n === 'xf' && where === 'cellXfs') xfs.push(Number(xmlAttrs(a).numFmtId) || 0);
            },
            (n) => {
                if (n === where) where = '';
            },
        );
        return xfs.map((id) => codes.get(id) ?? BUILTIN_FORMATS[id] ?? '');
    },

    /** @param {Uint8Array} bytes @param {string[]} strings @param {string[]} kinds @param {boolean} date1904 @returns {SheetData} */
    sheet(bytes, strings, kinds, date1904) {
        const grid = sheetGrid();
        let r = -1;
        let c = -1;
        /** @type {{ t: string, s: number, v: string, is: string }|null} */
        let cell = null; // { t, s, v, is }
        let field = ''; // 'v' value, 't' inline text
        let phonetic = 0;
        scanXml(
            xmlString(bytes),
            (n, a) => {
                if (n === 'c') {
                    const at = xmlAttrs(a);
                    if (at.r) {
                        c = refCol(at.r);
                        r = Number(at.r.replace(/^[A-Za-z]+/, '')) - 1;
                    } else c++;
                    cell = { t: at.t || 'n', s: Number(at.s) || 0, v: '', is: '' };
                } else if (n === 'row') {
                    const at = xmlAttrs(a);
                    r = at.r ? Number(at.r) - 1 : r + 1;
                    c = -1;
                } else if (cell && (n === 'v' || n === 't')) field = n;
                else if (n === 'rPh') phonetic++;
            },
            (n) => {
                if (n === 'c' && cell) {
                    grid.set(r, c, cellText(cell));
                    cell = null;
                } else if (n === 'v' || n === 't') field = '';
                else if (n === 'rPh') phonetic--;
            },
            (raw) => {
                if (!cell || !field || phonetic) return;
                if (field === 'v') cell.v += xmlText(raw);
                else cell.is += xmlText(raw);
            },
        );
        return grid.done();

        /** @param {{ t: string, s: number, v: string, is: string }} cell @returns {string} */
        function cellText({ t, s, v, is }) {
            if (t === 's') return strings[Number(v)] ?? '';
            if (t === 'inlineStr') return ooxmlText(is);
            if (t === 'str') return ooxmlText(v);
            if (t === 'b') return v.trim() === '1' ? 'TRUE' : 'FALSE';
            if (t === 'e') return v;
            if (t === 'd') return v.replace('T', ' ').replace(/Z$/, '');
            return v.trim() === '' ? '' : numberText(Number(v), kinds[s] || '', date1904);
        }
    },

    // Table (ECMA-376 part 1, 18.5): name shown in Excel, range, header and totals rows, column names
    /** @param {Uint8Array} bytes @returns {TablePart|null} */
    table(bytes) {
        /** @type {TablePart|null} */
        let out = null;
        /** @type {string[]} */
        const columns = [];
        scanXml(
            xmlString(bytes),
            (n, a) => {
                const at = xmlAttrs(a);
                if (n === 'table' && !out) {
                    const range = cellRange(at.ref || '');
                    if (!range) return;
                    out = {
                        name: at.displayName || at.name || '',
                        range,
                        header: at.headerRowCount === undefined ? 1 : Number(at.headerRowCount) || 0,
                        totals: Number(at.totalsRowCount) || 0,
                        columns,
                    };
                } else if (n === 'tableColumn') columns.push(ooxmlText(at.name || ''));
            },
            () => {},
        );
        return out;
    },
};
