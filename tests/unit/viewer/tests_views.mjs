// View switch: table view, colour choice per view, sheet and table picker
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fakeViewer } from '../helpers.mjs';
import { load } from '../helpers.mjs';

const { tableView, colourKey, showSheets, sheetLists } = await load('viewer/views.js');
const { view } = await load('_core/prefs.js');

describe('viewer/views', () => {
    it('table view only for tables, and only while chosen', () => {
        view.table = true;
        assert.deepEqual(
            ['csv', 'parquet', 'sheet', 'json'].map((lang) => tableView({ lang })),
            [true, true, true, false],
        );
        view.table = false;
        assert.equal(tableView({ lang: 'csv' }), false);
    });
    it('colour choice: text, table, sheet', () => {
        view.table = true;
        assert.deepEqual(
            ['json', 'csv', 'sheet'].map((lang) => colourKey({ lang })),
            ['text', 'table', 'sheet'],
        );
    });
    it('picker: sheets (cached, hidden, chart) and tables side by side; name in title', () => {
        const v = fakeViewer();
        const sheets = [
            { name: 'A', hidden: false, kind: 'sheet', data: { rows: [], cols: 0 } },
            { name: 'B <x>', hidden: true, kind: 'sheet', data: undefined },
            { name: 'C', hidden: false, kind: 'chart', data: null },
        ];
        const tables = [{ name: 'T', sheet: 1 }];
        const src = { isSheet: true, sheets, tables, tablesRead: true, mode: 'sheets', current: 0, startOf: () => 0 };
        showSheets(v, src);
        assert.equal(v.sheetPicker.button.hidden, false);
        const [lists, choice, label] = v.sheetPicker.last;
        assert.deepEqual(
            lists.map((l) => [l.label, l.items.map((x) => x.text)]),
            [
                ['Sheets', ['● A', '○ B <x> (hidden)', '● C (chart)']],
                ['Tables', ['○ T (B <x>)']],
            ],
        );
        assert.deepEqual([choice, label], [{ list: 0, item: 0 }, 'A']);
        assert.equal(v.titleSheet.innerHTML, ' · <strong>Sheet:</strong> A');

        showSheets(v, { ...src, mode: 'tables' });
        assert.deepEqual(v.sheetPicker.last.slice(1, 3), [{ list: 1, item: 0 }, 'T']);
        assert.equal(v.titleSheet.innerHTML, ' · <strong>Table:</strong> T');

        showSheets(v, null);
        assert.equal(v.sheetPicker.button.hidden, true);
    });

    it('picker: no tables (or none read) say why', () => {
        const src = { isSheet: true, sheets: [], tables: [], mode: 'sheets', current: 0, startOf: () => 0 };
        assert.equal(sheetLists({ ...src, tablesRead: true })[1].empty, 'No tables in this file');
        assert.equal(sheetLists({ ...src, tablesRead: false })[1].empty, 'Tables are not read from this format');
    });
});
