// Unit tests: spreadsheet reader of the userscript (no browser).
// The section from "Files by byte range" up to "Links" of /src/main.js runs on its own:
// it needs only what Node has as well (TextDecoder, DecompressionStream, Blob, Response).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DATA = path.join(ROOT, 'tests/behave/fake-sharepoint/library/Data');

// ----------------------------------------------------------------
// Section of the userscript
// ----------------------------------------------------------------

/** @returns {Object<string, Function>} functions of the section */
function loadSection() {
  const text = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  const from = text.lastIndexOf('\n', text.indexOf('  // Files by byte range') - 2);
  const to = text.indexOf('  // Links: .url shortcut files');
  assert.ok(from > 0 && to > from, 'section markers in /src/main.js');
  return new Function(`${text.slice(from, to)}\nreturn { readBook, numberText, formatKind, colName };`)();
}
const lib = loadSection();

/** @param {Uint8Array} bytes @returns {{ read: (from: number, to: number) => Promise<Uint8Array>, ranges: number[][] }} */
function reader(bytes) {
  const ranges = [];
  const read = async (from, to) => {
    ranges.push([from, Math.min(to, bytes.length)]);
    return bytes.subarray(from, to);
  };
  return { read, ranges };
}

/** @param {Uint8Array} bytes @returns {Promise<Object>} workbook with all sheets read */
async function readAll(bytes) {
  const { read } = reader(bytes);
  const book = await lib.readBook(read, bytes.length, bytes.subarray(0, 8));
  for (const [i, s] of book.sheets.entries()) if (s.data === undefined) s.data = await book.load(i);
  return book;
}

// ZIP (deflated entries) from { path: text }, for workbooks made up in the tests
/** @param {Object<string, string>} files @returns {{ bytes: Uint8Array, offsets: Object<string, number[]> }} */
function zip(files) {
  const parts = [];
  const central = [];
  const offsets = {};
  let at = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = zlib.deflateRawSync(Buffer.from(text));
    const nameBytes = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(zlib.crc32(Buffer.from(text)), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(Buffer.byteLength(text), 22);
    head.writeUInt16LE(nameBytes.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    head.copy(dir, 6, 4, 30); // same fields, shifted by 2
    dir.writeUInt32LE(at, 42);
    central.push(Buffer.concat([dir, nameBytes]));
    offsets[name] = [at, at + 30 + nameBytes.length + data.length];
    parts.push(head, nameBytes, data);
    at += 30 + nameBytes.length + data.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(at, 16);
  return { bytes: new Uint8Array(Buffer.concat([...parts, dirBytes, end])), offsets };
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
      const book = await readAll(new Uint8Array(fs.readFileSync(path.join(DATA, `harvest.${ext}`))));
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
    for (const n of [1, 2, 3]) assert.ok(!touches(ranges, offsets[`xl/worksheets/sheet${n}.xml`]), `sheet ${n} unread`);

    const two = await book.load(1);
    assert.equal(two.rows.length, 3000);
    assert.deepEqual(two.rows[2999].slice(0, 2), ['two2999', '4498.5']);
    assert.ok(touches(ranges, offsets['xl/worksheets/sheet2.xml']));
    assert.ok(!touches(ranges, offsets['xl/worksheets/sheet1.xml']));
    assert.ok(!touches(ranges, offsets['xl/worksheets/sheet3.xml']));
  });
});

describe('cell values', () => {
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
  });

  it('column names', () => {
    assert.deepEqual([0, 25, 26, 701, 702].map(lib.colName), ['A', 'Z', 'AA', 'ZZ', 'AAA']);
  });
});
