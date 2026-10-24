// View switch: table view, colour choice per view, sheet drop-down
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fakeViewer, load } from '../helpers.mjs';

const { tableView, colourKey, showSheets } = await load('viewer/views.js');
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
  it('sheet drop-down: cached marks, hidden and chart sheets, name in title', () => {
    const v = fakeViewer();
    const sheets = [
      { name: 'A', hidden: false, kind: 'sheet', data: { rows: [], cols: 0 } },
      { name: 'B <x>', hidden: true, kind: 'sheet', data: undefined },
      { name: 'C', hidden: false, kind: 'chart', data: null },
    ];
    showSheets(v, { isSheet: true, sheets, current: 0 });
    assert.equal(v.sheetSelect.hidden, false);
    assert.match(v.sheetSelect.innerHTML, /● A<\/option>.*○ B &lt;x&gt; \(hidden\)<\/option>.*● C \(chart\)/s);
    assert.equal(v.titleSheet.innerHTML, ' · <strong>Sheet:</strong> A');
    showSheets(v, null);
    assert.equal(v.sheetSelect.hidden, true);
  });
});
