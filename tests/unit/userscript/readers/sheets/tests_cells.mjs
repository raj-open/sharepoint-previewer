// Cell values: numbers as Excel's "General", dates and times as ISO 8601; grid of one sheet
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../../helpers.mjs';

const lib = await load('readers/sheets/cells.js');

describe('readers/sheets/cells', () => {
  it('numbers as Excel shows them in "General"', () => {
    assert.equal(lib.numberText(0.1 + 0.2, '', false), '0.3');
    assert.equal(lib.numberText(-1234.5, '', false), '-1234.5');
    assert.equal(lib.numberText(0.125, lib.formatKind('0.0%'), false), '12.5%');
  });

  it('dates and times as ISO 8601, in both date systems', () => {
    assert.equal(lib.numberText(46266, lib.formatKind('dd/mm/yyyy'), false), '2026-09-01');
    assert.equal(lib.numberText(46266 - 1462, lib.formatKind('dd/mm/yyyy'), true), '2026-09-01');
    assert.equal(lib.numberText(1, lib.formatKind('yyyy-mm-dd'), false), '1900-01-01');
    assert.equal(lib.numberText(61, lib.formatKind('yyyy-mm-dd'), false), '1900-03-01');
    assert.equal(lib.numberText(46266.75, lib.formatKind('yyyy-mm-dd hh:mm'), false), '2026-09-01 18:00:00');
    assert.equal(lib.numberText(0.5, lib.formatKind('h:mm AM/PM'), false), '12:00:00');
    assert.equal(lib.numberText(10.5, lib.formatKind('[h]:mm:ss'), false), '252:00:00');
  });

  it('format kinds ignore literal text, colours and locales', () => {
    assert.equal(lib.formatKind('#,##0.00 "days"'), '');
    assert.equal(lib.formatKind('[Red]0.00;[Blue]-0.00'), '');
    assert.equal(lib.formatKind('[$-409]mmmm d, yyyy'), 'date');
    assert.equal(lib.formatKind('mm:ss'), 'time');
    assert.equal(lib.formatKind(lib.BUILTIN_FORMATS[14]), 'date');
    assert.equal(lib.formatKind(lib.BUILTIN_FORMATS[9]), 'percent');
  });

  it('column names and references', () => {
    assert.deepEqual([0, 25, 26, 701, 702].map(lib.colName), ['A', 'Z', 'AA', 'ZZ', 'AAA']);
    assert.deepEqual(['A1', 'Z9', 'AA10', 'xfd3'].map(lib.refCol), [0, 25, 26, 16383]);
  });

  it('format by file extension', () => {
    assert.equal(lib.sheetFormat('a.xlsx'), 'Excel (XLSX)');
    assert.equal(lib.sheetFormat('b.ODS'), 'OpenDocument spreadsheet (ODS)');
    assert.equal(lib.sheetFormat('c.csv'), null);
  });

  it('grid: no gaps between rows, empty cells skipped, limits', () => {
    const g = lib.sheetGrid();
    g.set(2, 1, 'x');
    g.set(0, 0, '');
    g.set(-1, 0, 'out');
    g.set(0, lib.MAX_SHEET_COLS, 'out');
    const d = g.done();
    assert.equal(d.rows.length, 3);
    assert.deepEqual(d.rows[0], []);
    assert.equal(d.rows[2][1], 'x');
    assert.equal(d.cols, 2);
    assert.equal(d.cut, false);
  });
});
