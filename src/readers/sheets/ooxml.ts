// OOXML workbooks (.xlsx, .xlsm, .xlsb): parts read from the ZIP by range; tables of the sheets

// ===========================================================================
// IMPORTS
// ===========================================================================

import { formatKind } from './cells.ts';
import { partRels } from './package.ts';
import { XLSB_PARTS } from './xlsb.ts';
import { XLSX_PARTS } from './xlsx.ts';

/** @typedef {import('../../_core/types.ts').Book} Book */
/** @typedef {import('../../_core/types.ts').Package} Package */
/** @typedef {import('../../_core/types.ts').SheetParts} SheetParts */
/** @typedef {import('../../_core/types.ts').Table} Table */
/** @typedef {{ path: string, kind: string }} SheetPath */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Table parts (Excel keeps them in xl/tables)
const TABLE_PART_RE = /(^|\/)tables\/[^/]+\.(xml|bin)$/i;

// ===========================================================================
// METHODS
// ===========================================================================

// Excel 2007+ package: workbook part from package relationships (.xlsx: XML, .xlsb: binary)
/** @param {Package} pkg @returns {Promise<Book>} */
export async function readOoxml(pkg) {
    const main = [...(await partRels(pkg, '')).values()].find((r) => r.type.endsWith('/officeDocument'))?.path;
    const wbPath = [main, 'xl/workbook.xml', 'xl/workbook.bin'].find((p) => pkg.entry(p));
    if (!wbPath) throw new Error('no workbook inside (not a spreadsheet?)');
    const binary = /\.bin$/i.test(wbPath);
    const parts = binary ? XLSB_PARTS : XLSX_PARTS;
    const rels = await partRels(pkg, wbPath);
    /** @param {string} type */
    const relOf = (type) => [...rels.values()].find((r) => r.type.endsWith(`/${type}`))?.path;
    const wb = parts.workbook(/** @type {Uint8Array} */ (await pkg.bytes(wbPath))); // found above

    const stringsPath = relOf('sharedStrings');
    const stylesPath = relOf('styles');
    const strings = pkg.entry(stringsPath)
        ? parts.strings(/** @type {Uint8Array} */ (await pkg.bytes(stringsPath)))
        : [];
    const kinds = pkg.entry(stylesPath)
        ? parts.styles(/** @type {Uint8Array} */ (await pkg.bytes(stylesPath))).map(formatKind)
        : [];

    const sheets = wb.sheets.map((s, i) => {
        const rel = rels.get(s.id);
        const path = rel?.path || `xl/worksheets/sheet${i + 1}.${binary ? 'bin' : 'xml'}`;
        return {
            name: s.name,
            hidden: s.hidden,
            kind: /chartsheet$/i.test(rel?.type || '') ? 'chart' : 'sheet',
            size: pkg.entry(path)?.packed || 0,
            path,
        };
    });
    return {
        format: `Excel (${binary ? 'XLSB' : 'XLSX'})`,
        sheets,
        tables: await readTables(pkg, sheets, parts),
        active: wb.active,
        date1904: wb.date1904,
        load: async (i) => {
            const s = sheets[i];
            if (s.kind !== 'sheet' || !pkg.entry(s.path)) return null;
            return parts.sheet(/** @type {Uint8Array} */ (await pkg.bytes(s.path)), strings, kinds, wb.date1904); // entry checked above
        },
    };
}

// Tables of all sheets, from the sheets' relationships (only looked for if the package has table parts)
/** @param {Package} pkg @param {SheetPath[]} sheets @param {SheetParts} parts @returns {Promise<Table[]>} */
async function readTables(pkg, sheets, parts) {
    /** @type {Table[]} */
    const tables = [];
    if (!pkg.paths().some((p) => TABLE_PART_RE.test(p))) return tables;
    for (const [i, s] of sheets.entries()) {
        if (s.kind !== 'sheet') continue;
        for (const rel of (await partRels(pkg, s.path)).values()) {
            if (!rel.type.endsWith('/table') || !pkg.entry(rel.path)) continue;
            const t = parts.table(/** @type {Uint8Array} */ (await pkg.bytes(rel.path))); // entry checked above
            if (t && t.range.r0 <= t.range.r1 && t.range.c0 <= t.range.c1) tables.push({ ...t, sheet: i });
        }
    }
    return tables;
}
