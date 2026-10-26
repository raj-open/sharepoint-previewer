// OOXML workbooks (.xlsx, .xlsm, .xlsb): parts read from the ZIP by range; tables of the sheets

// ===========================================================================
// IMPORTS
// ===========================================================================

import { formatKind } from './cells.ts';
import { partRels } from './package.ts';
import { XLSB_PARTS } from './xlsb.ts';
import { XLSX_PARTS } from './xlsx.ts';

import type { Book } from '../../_core/types.ts';
import type { Package } from '../../_core/types.ts';
import type { SheetParts } from '../../_core/types.ts';
import type { Table } from '../../_core/types.ts';

// ===========================================================================
// TYPES
// ===========================================================================

export type SheetPath = { path: string; kind: string };

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Table parts (Excel keeps them in xl/tables)
const TABLE_PART_RE = /(^|\/)tables\/[^/]+\.(xml|bin)$/i;

// ===========================================================================
// METHODS
// ===========================================================================

// Excel 2007+ package: workbook part from package relationships (.xlsx: XML, .xlsb: binary)
export async function readOoxml(pkg: Package): Promise<Book> {
    const main = [...(await partRels(pkg, '')).values()].find((r) => r.type.endsWith('/officeDocument'))?.path;
    const wbPath = [main, 'xl/workbook.xml', 'xl/workbook.bin'].find((p) => pkg.entry(p));
    if (!wbPath) throw new Error('no workbook inside (not a spreadsheet?)');
    const binary = /\.bin$/i.test(wbPath);
    const parts = binary ? XLSB_PARTS : XLSX_PARTS;
    const rels = await partRels(pkg, wbPath);
    const relOf = (type: string) => [...rels.values()].find((r) => r.type.endsWith(`/${type}`))?.path;
    const wb = parts.workbook((await pkg.bytes(wbPath)) as Uint8Array); // found above

    const stringsPath = relOf('sharedStrings');
    const stylesPath = relOf('styles');
    const strings = pkg.entry(stringsPath) ? parts.strings((await pkg.bytes(stringsPath)) as Uint8Array) : [];
    const kinds = pkg.entry(stylesPath)
        ? parts.styles((await pkg.bytes(stylesPath)) as Uint8Array).map(formatKind)
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
            return parts.sheet((await pkg.bytes(s.path)) as Uint8Array, strings, kinds, wb.date1904); // entry checked above
        },
    };
}

// Tables of all sheets, from the sheets' relationships (only looked for if the package has table parts)
async function readTables(pkg: Package, sheets: SheetPath[], parts: SheetParts): Promise<Table[]> {
    const tables: Table[] = [];
    if (!pkg.paths().some((p) => TABLE_PART_RE.test(p))) return tables;
    for (const [i, s] of sheets.entries()) {
        if (s.kind !== 'sheet') continue;
        for (const rel of (await partRels(pkg, s.path)).values()) {
            if (!rel.type.endsWith('/table') || !pkg.entry(rel.path)) continue;
            const t = parts.table((await pkg.bytes(rel.path)) as Uint8Array); // entry checked above
            if (t && t.range.r0 <= t.range.r1 && t.range.c0 <= t.range.c1) tables.push({ ...t, sheet: i });
        }
    }
    return tables;
}
