// OpenDocument spreadsheet: all sheets in content.xml, cells with their display text;
// named database ranges as tables

// ===========================================================================
// IMPORTS
// ===========================================================================

import { cellRange } from './cells.ts';
import { generalText } from './cells.ts';
import { MAX_SHEET_COLS } from './cells.ts';
import { MAX_SHEET_ROWS } from './cells.ts';
import { sheetGrid } from './cells.ts';
import { scanXml } from './xml.ts';
import { xmlAttrs } from './xml.ts';
import { xmlString } from './xml.ts';
import { xmlText } from './xml.ts';

import type { SheetData } from '../../_core/types.ts';
import type { Book } from '../../_core/types.ts';
import type { Package } from '../../_core/types.ts';
import type { Table } from '../../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Range address "Sheet1.A1:Sheet1.D9", "'My sheet'.$A$1:.$D$9": sheet, first cell, last cell
const ODS_RANGE_RE =
    /^\$?('(?:[^']|'')*'|[^.']*)\.([$A-Za-z]+[$\d]+)(?::\$?(?:'(?:[^']|'')*'|[^.']*)\.([$A-Za-z]+[$\d]+))?$/;

// Ranges LibreOffice makes itself (e.g. for a filter): not named by the user
const ODS_ANONYMOUS_RE = /^__Anonymous_Sheet_DB__/;

// ===========================================================================
// METHODS
// ===========================================================================

function odsSheets(xml: string): { sheets: { name: string; data: SheetData }[]; ranges: Record<string, string>[] } {
    const sheets: { name: string; data: SheetData }[] = [];
    const ranges: Record<string, string>[] = []; // attributes of database ranges
    let grid: ReturnType<typeof sheetGrid> | null = null;
    let name = '';
    let depth = 0; // tables inside cells (rare) are part of their cell
    let r = 0;
    let c = 0;
    let row: string[] | null = null; // texts of current row
    let rowRepeat = 1;
    let cell: { repeat: number; text: string | null; value: string | null } | null = null; // { repeat, text, value } (value: typed, else text shown)
    let para = 0;
    let note = 0; // annotations (comments): not part of cell text
    const add = (s: string) => {
        if (cell && para && !note) cell.text += s;
    };
    scanXml(
        xml,
        (n, a) => {
            if (n === 'database-range' && !depth) return void ranges.push(xmlAttrs(a));
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
                cell = {
                    repeat: Math.max(1, Number(at['number-columns-repeated']) || 1),
                    text: null,
                    value: odsValue(at),
                };
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
                sheets.push({ name, data: (grid as ReturnType<typeof sheetGrid>).done() }); // opened with the table
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
                        if (!row.every((t, col) => (grid as ReturnType<typeof sheetGrid>).set(r + k, col, t))) break;
                    }
                }
                r += rowRepeat;
                row = null;
            }
        },
        (raw) => add(xmlText(raw)),
    );
    return { sheets, ranges };
}

// Named database ranges -> tables (header row unless contains-header="false", totals row if
// contains-footer="true" (LibreOffice extension); no column names)
/** @param names sheet names */
function odsTables(ranges: Record<string, string>[], names: string[]): Table[] {
    const tables: Table[] = [];
    for (const at of ranges) {
        const m = ODS_RANGE_RE.exec(at['target-range-address'] || '');
        if (!m || !at.name || ODS_ANONYMOUS_RE.test(at.name)) continue;
        const sheet = names.indexOf(m[1].replace(/^'|'$/g, '').replace(/''/g, "'"));
        const range = cellRange(m[3] ? `${m[2]}:${m[3]}` : m[2]);
        if (sheet < 0 || !range) continue;
        const header = at['contains-header'] === 'false' ? 0 : 1;
        const totals = at['contains-footer'] === 'true' ? 1 : 0;
        tables.push({ name: at.name, range, header, totals, columns: [], sheet });
    }
    return tables;
}

// Typed value as the Excel formats show it (ISO dates, plain numbers); null = use cell text
function odsValue(at: Record<string, string>): string | null {
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

export async function readOds(pkg: Package): Promise<Book> {
    if ((await pkg.text('META-INF/manifest.xml'))?.includes('encryption-data')) {
        throw new Error('the file is password-protected');
    }
    const found = odsSheets(xmlString((await pkg.bytes('content.xml')) as Uint8Array)); // entry checked by the caller
    // all sheets come with content.xml: cached at once
    const sheets = found.sheets.map((s) => ({ name: s.name, hidden: false, kind: 'sheet', size: 0, data: s.data }));
    return {
        format: 'OpenDocument spreadsheet',
        sheets,
        tables: odsTables(
            found.ranges,
            sheets.map((s) => s.name),
        ),
        active: 0,
        date1904: false,
        load: async (i) => sheets[i].data,
    };
}
