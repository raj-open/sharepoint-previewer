// Workbooks of every format: sheets, values; read sheet by sheet (only the parts needed)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../../helpers.mjs';
import { load } from '../../helpers.mjs';
import { reader } from '../../helpers.mjs';
import { serve } from '../../helpers.mjs';
import { zip } from '../../helpers.mjs';

const { readBook, openSheetSource } = await load('readers/sheets/index.js');
const lib = { readBook };
const signal = () => new AbortController().signal;

/** @param {Uint8Array} bytes @returns {Promise<Object>} workbook with all sheets read */
async function readAll(bytes) {
    const { read } = reader(bytes);
    const book = await lib.readBook(read, bytes.length, bytes.subarray(0, 8));
    for (const [i, s] of book.sheets.entries()) if (s.data === undefined) s.data = await book.load(i);
    return book;
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('spreadsheet formats', () => {
    const PRICES = [
        ['fruit', 'price', 'harvest', 'ripe'],
        ['apple', '1.25', '2026-09-01', 'TRUE'],
        ['banana', '0.5', '2026-10-03', 'FALSE'],
        ['cherry', '7', '2026-06-21', 'TRUE'],
    ];
    for (const [ext, format] of [
        ['xlsx', 'Excel (XLSX)'],
        ['xlsb', 'Excel (XLSB)'],
        ['xls', 'Excel 97–2003 (XLS)'],
        ['ods', 'OpenDocument spreadsheet'],
    ]) {
        it(`${ext}: sheets, values, dates`, async () => {
            const book = await readAll(fixture(`Data/harvest.${ext}`));
            assert.equal(book.format, format);
            assert.deepEqual(
                book.sheets.map((s) => s.name),
                ['Prices', 'Notes', 'Secret'],
            );
            if (ext !== 'ods')
                assert.deepEqual(
                    book.sheets.map((s) => s.hidden),
                    [false, false, true],
                );
            assert.deepEqual(book.sheets[0].data.rows, PRICES);
            assert.equal(book.sheets[0].data.cols, 4);
            assert.deepEqual(book.sheets[1].data.rows, [['note'], ['first line'], [], ['after a gap']]);
        });
    }

    it('refuses what is not a spreadsheet', async () => {
        const bytes = new TextEncoder().encode('fruit,price\napple,1\n');
        await assert.rejects(lib.readBook(reader(bytes).read, bytes.length, bytes.subarray(0, 8)), /not a spreadsheet/);
    });
});

describe('sheet-wise reading', () => {
    // values that hardly compress: each sheet tens of KB in the archive, like real ones
    let seed = 1;
    const noise = () => {
        seed = (seed * 48271) % 2147483647;
        return seed;
    };
    const rows = (tag) =>
        Array.from(
            { length: 3000 },
            (_, r) =>
                `<row r="${r + 1}"><c r="A${r + 1}" t="inlineStr"><is><t>${tag}${r}</t></is></c>` +
                `<c r="B${r + 1}"><v>${r * 1.5}</v></c><c r="C${r + 1}"><v>${noise()}</v></c></row>`,
        ).join('');
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const { bytes, offsets } = zip({
        '_rels/.rels': `<Relationships><Relationship Id="r1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        'xl/workbook.xml': `<workbook xmlns:r="${R}"><bookViews><workbookView activeTab="1"/></bookViews><sheets>${[
            'One',
            'Two',
            'Three',
        ]
            .map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="s${i + 1}"/>`)
            .join('')}</sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships>${[1, 2, 3]
            .map((i) => `<Relationship Id="s${i}" Type="${R}/worksheet" Target="worksheets/sheet${i}.xml"/>`)
            .join('')}</Relationships>`,
        'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows('one')}</sheetData></worksheet>`,
        'xl/worksheets/sheet2.xml': `<worksheet><sheetData>${rows('two')}</sheetData></worksheet>`,
        'xl/worksheets/sheet3.xml': `<worksheet><sheetData>${rows('three')}</sheetData></worksheet>`,
    });
    // entry fetched = its local header read (the directory read at the end may graze the last entry)
    const touches = (ranges, [a]) => ranges.some(([from, to]) => from <= a && to >= a + 30);

    it('reads only the workbook first, then each sheet when asked for', async () => {
        const { read, ranges } = reader(bytes);
        const book = await lib.readBook(read, bytes.length, bytes.subarray(0, 8));
        assert.equal(book.active, 1);
        for (const n of [1, 2, 3])
            assert.ok(!touches(ranges, offsets[`xl/worksheets/sheet${n}.xml`]), `sheet ${n} unread`);

        const two = await book.load(1);
        assert.equal(two.rows.length, 3000);
        assert.deepEqual(two.rows[2999].slice(0, 2), ['two2999', '4498.5']);
        assert.ok(touches(ranges, offsets['xl/worksheets/sheet2.xml']));
        assert.ok(!touches(ranges, offsets['xl/worksheets/sheet1.xml']));
        assert.ok(!touches(ranges, offsets['xl/worksheets/sheet3.xml']));
    });
});

describe('spreadsheet source', () => {
    it('opens the active sheet only; others on request; CSV text with column letters and row numbers', async () => {
        serve({ '/h.xlsx': fixture('Data/harvest.xlsx') });
        const src = await openSheetSource('/h.xlsx', signal, false, () => {});
        assert.equal(src.isSheet, true);
        assert.equal(src.sheets[src.current].name, 'Prices');
        assert.deepEqual(
            src.sheets.map((s) => s.data !== undefined),
            [true, false, false],
        );
        assert.match(src.text, /^,A,B,C,D\n1,fruit,price,harvest,ripe\n2,apple,1.25,2026-09-01,TRUE/);
        assert.equal(src.done, false);
        assert.ok(src.loaded < src.total);
        assert.deepEqual(src.shown.header, ['A', 'B', 'C', 'D']);
        assert.equal(src.label(), '1 of 3 sheets cached');

        await src.loadSheet(1);
        src.select(1);
        assert.equal(src.text, ',A\n1,note\n2,first line\n3,\n4,after a gap');
        await src.loadAll();
        assert.equal(src.done, true);
        assert.equal(src.loaded, src.total);
        assert.deepEqual(Object.fromEntries(src.info), {
            sheets: '3 (1 hidden)',
            tables: '0',
            sheet: 'Notes: 4 rows × 1 columns',
        });
    });

    for (const ext of ['xlsx', 'ods']) {
        it(`${ext}: tables below their header rows, without totals rows; sheets or tables`, async () => {
            serve({ [`/o.${ext}`]: fixture(`Data/orders.${ext}`) });
            const src = await openSheetSource(`/o.${ext}`, signal, false, () => {}, 'tables');
            assert.equal(src.mode, 'tables');
            assert.deepEqual(
                src.tables.map((t) => t.name),
                ['Orders', 'Regions', 'Payments', 'Stock', 'Suppliers', 'PriceList'], // reading order
            );
            assert.equal(src.current, 0); // first table on the active sheet
            assert.deepEqual(src.shown.header, ['order', 'fruit', 'kg', 'date']);
            assert.equal(src.shown.rows.length, 12);
            assert.deepEqual(src.shown.rows.at(-1), ['1012', 'banana', '21.75', '2026-09-23']);
            assert.match(src.text, /^order,fruit,kg,date\n1001,apple,2.5,2026-09-01\n/);
            assert.deepEqual(Object.fromEntries(src.info), {
                sheets: '6',
                tables: '6',
                table: 'Orders (Sales!A1:D14): 12 rows × 4 columns',
            });

            // table below a title and notes: only its own cells
            await src.loadSheet(src.sheetOf(3));
            src.select(3);
            assert.deepEqual(src.shown.header, ['fruit', 'kg', 'ripe']);
            assert.deepEqual(src.shown.rows[0], ['apple', '140', 'TRUE']);
            assert.equal(src.shown.rows.length, 4);
            assert.equal(src.startOf('sheets'), 2); // the sheet of the table shown

            src.select(src.startOf('sheets'), 'sheets');
            assert.equal(src.mode, 'sheets');
            assert.equal(src.sheets[src.current].name, 'Stock');
            assert.match(
                src.text,
                /^,A,B,C,D\n1,,Stock of the farm shop,,\n2,,"counted on 2026-10-01, in kg",,\n3,,fruit,kg,ripe\n/,
            );

            await src.loadSheet(4);
            src.select(4); // sheet without tables
            assert.equal(src.startOf('tables'), 0); // none on it: the first table
        });
    }

    it('tables asked for, but there are none: sheets', async () => {
        serve({ '/h.xlsx': fixture('Data/harvest.xlsx') });
        const src = await openSheetSource('/h.xlsx', signal, false, () => {}, 'tables');
        assert.equal(src.mode, 'sheets');
        assert.equal(src.sheets[src.current].name, 'Prices');
    });

    it('broken file: message instead of an exception', async () => {
        serve({ '/x.xlsx': 'PK but not really a zip archive' });
        assert.match((await openSheetSource('/x.xlsx', signal, false, () => {})).error, /^Not shown: /);
    });
});
