// View switch: table view, colour choice per view, sheet and table picker
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fakeViewer } from '../helpers.ts';
import { load } from '../helpers.ts';

const { tableView, colourKey, showSheets, sheetLists } = await load('viewer/views.ts');
const { markdownView, previewOf, setPreview, updateViews, viewKey } = await load('viewer/views.ts');
const { showFormat } = await load('viewer/views.ts');
const { view } = await load('_core/prefs.ts');

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
    it('log table: own choice (text first), not while edited, only with fields found', () => {
        const v = fakeViewer({ lang: 'log' });
        view.table = true;
        view.logTable = false;
        assert.equal(tableView(v), false);
        view.logTable = true;
        assert.equal(tableView(v), true);
        v.previewBtn.disabled = true; // no fields found
        assert.equal(tableView(v), false);
        v.previewBtn.disabled = false;
        v.writeMode = true;
        assert.equal(tableView(v), false);
        assert.deepEqual(
            [viewKey(v, 'table'), viewKey({ lang: 'csv' }, 'table'), viewKey(v, 'markdown')],
            ['logTable', 'table', 'markdown'],
        );
    });
    it('log table: tooltip says it is experimental', () => {
        const v = fakeViewer({ lang: 'log' });
        setPreview(v, 'table');
        assert.match(v.previewBtn.title, /experimental/);
    });
    it('preview by file type: table, 3D, Markdown, none', () => {
        assert.deepEqual(['csv', 'parquet', 'sheet', 'log', 'ifc', 'md', 'json', null].map(previewOf), [
            'table',
            'table',
            'table',
            'table',
            '3d',
            'md',
            null,
            null,
        ]);
    });
    it('preview button: look follows the file type; disabled with a reason or without preview', () => {
        const v = fakeViewer();
        setPreview(v, 'md');
        assert.match(v.previewBtn.innerHTML, /<span>Markdown<\/span>/);
        assert.equal(v.previewBtn.disabled, false);
        setPreview(v, '3d', 'too big');
        assert.match(v.previewBtn.innerHTML, /<span>3D<\/span>/);
        assert.deepEqual([v.previewBtn.disabled, v.previewBtn.title], [true, 'too big']);
        setPreview(v, null);
        assert.match(v.previewBtn.innerHTML, /<span>Preview<\/span>/);
        assert.equal(v.previewBtn.disabled, true);
    });
    it('Markdown view: while chosen, not while edited; Text or Preview pressed', () => {
        view.markdown = true;
        const v = fakeViewer({ lang: 'md', source: { text: '' }, busy: true });
        assert.equal(markdownView(v), true);
        setPreview(v, 'md');
        updateViews(v);
        assert.deepEqual(
            [v.textBtn.getAttribute('aria-pressed'), v.previewBtn.getAttribute('aria-pressed')],
            ['false', 'true'],
        );
        v.writeMode = true;
        assert.equal(markdownView(v), false);
        updateViews(v);
        assert.equal(v.textBtn.getAttribute('aria-pressed'), 'true');
        view.markdown = false;
        assert.equal(markdownView({ lang: 'md' }), false);
    });
    it('colour choice: text, table, sheet, log table', () => {
        view.table = true;
        assert.deepEqual(
            ['json', 'csv', 'sheet'].map((lang) => colourKey({ lang })),
            ['text', 'table', 'sheet'],
        );
        view.logTable = true;
        assert.equal(colourKey(fakeViewer({ lang: 'log' })), 'log');
        view.logTable = false;
        assert.equal(colourKey(fakeViewer({ lang: 'log' })), 'text');
    });
    it('format picker: recognised or chosen; text and file formats side by side; hidden without file', () => {
        const v = fakeViewer();
        showFormat(v, 'csv', 'csv');
        assert.equal(v.formatPicker.button.hidden, false);
        const [lists, choice, label, title] = v.formatPicker.last;
        assert.deepEqual(
            lists.map((l) => l.label),
            ['Text', 'Files'],
        );
        assert.equal(lists[0].items[choice.item].text, 'CSV (recognised)');
        assert.deepEqual([choice.list, label], [0, 'CSV']);
        assert.match(title, /recognised from the file name/);
        assert.equal(v.formatPicker.button.classList.contains('tp-chosen'), false);

        showFormat(v, 'sheet', 'log');
        const [, chosen, , chosenTitle] = v.formatPicker.last;
        assert.deepEqual([chosen.list, lists[1].items[chosen.item].text], [1, 'Spreadsheet']);
        assert.match(chosenTitle, /chosen; recognised: Log/);
        assert.equal(v.formatPicker.button.classList.contains('tp-chosen'), true);

        showFormat(v, null);
        assert.equal(v.formatPicker.button.hidden, true);
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

        showSheets(v, { ...src, waiting: true });
        assert.deepEqual(v.sheetPicker.last.slice(1, 3), [{ list: 0, item: -1 }, 'Select sheet or table']);
        assert.equal(v.titleSheet.hidden, true);

        showSheets(v, null);
        assert.equal(v.sheetPicker.button.hidden, true);
    });

    it('picker: no tables (or none read) say why', () => {
        const src = { isSheet: true, sheets: [], tables: [], mode: 'sheets', current: 0, startOf: () => 0 };
        assert.equal(sheetLists({ ...src, tablesRead: true })[1].empty, 'No tables in this file');
        assert.equal(sheetLists({ ...src, tablesRead: false })[1].empty, 'Tables are not read from this format');
    });
});
