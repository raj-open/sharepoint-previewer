// Excel 2007+ XML parts: workbook, shared strings, styles, sheet
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../../helpers.mjs';

const { XLSX_PARTS } = await load('readers/sheets/xlsx.js');
const { formatKind } = await load('readers/sheets/cells.js');
const b = (s) => new TextEncoder().encode(s);

describe('readers/sheets/xlsx', () => {
  it('workbook: sheets, hidden, active tab, 1904 dates (also when repeated in extensions)', () => {
    const wb = XLSX_PARTS.workbook(
      b(
        '<workbook><workbookPr date1904="1"/><bookViews><workbookView activeTab="1"/></bookViews><sheets>' +
          '<sheet name="A" sheetId="1" r:id="r1"/><sheet name="B" sheetId="2" state="hidden" r:id="r2"/></sheets>' +
          '<extLst><ext><x:workbookPr/></ext></extLst></workbook>',
      ),
    );
    assert.deepEqual(wb.sheets, [
      { name: 'A', id: 'r1', hidden: false },
      { name: 'B', id: 'r2', hidden: true },
    ]);
    assert.equal(wb.active, 1);
    assert.equal(wb.date1904, true);
  });
  it('shared strings: rich text joined, phonetic hints left out', () => {
    const s = XLSX_PARTS.strings(
      b('<sst><si><t>plain</t></si><si><r><t>ri</t></r><r><t>ch</t></r><rPh><t>x</t></rPh></si><si><t/></si></sst>'),
    );
    assert.deepEqual(s, ['plain', 'rich', '']);
  });
  it('styles: format code per cell style (own and built-in)', () => {
    const codes = XLSX_PARTS.styles(
      b(
        '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="10"/></cellXfs></styleSheet>',
      ),
    );
    assert.deepEqual(codes.map(formatKind), ['', 'date', 'percent']);
  });
  it('sheet: types, styles, inline strings, missing references', () => {
    const d = XLSX_PARTS.sheet(
      b(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>46266</v></c><c t="b"><v>1</v></c></row>' +
          '<row r="3"><c r="A3" t="inlineStr"><is><t>in</t></is></c><c r="C3" t="e"><v>#N/A</v></c><c r="D3" t="str"><f>A1</f><v>x</v></c></row></sheetData></worksheet>',
      ),
      ['shared'],
      ['', 'date'],
      false,
    );
    const rows = d.rows.map((r) => Array.from(r, (x) => x ?? '')); // missing cells: empty
    assert.deepEqual(rows, [['shared', '2026-09-01', 'TRUE'], [], ['in', '', '#N/A', 'x']]);
    assert.equal(d.cols, 4);
  });
});
