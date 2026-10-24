// Excel binary workbook: BIFF12 records, RK numbers
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../../helpers.mjs';

const { rkNumber, XLSB_PARTS } = await load('readers/sheets/xlsb.js');

// record: type and size as 7-bit varints
const rec = (type, data = []) => [...(type < 128 ? [type] : [(type & 0x7f) | 0x80, type >> 7]), data.length, ...data];
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const wide = (s) => [...u32(s.length), ...[...s].flatMap((c) => [c.charCodeAt(0), 0])];

describe('readers/sheets/xlsb', () => {
  it('RK: integers, ×100, doubles', () => {
    assert.equal(rkNumber((42 << 2) | 2), 42);
    assert.equal(rkNumber((1234 << 2) | 3), 12.34);
    assert.equal(rkNumber(0x3ff00000), 1); // high bits of 1.0
  });
  it('workbook: sheets with state and relationship id', () => {
    const wb = XLSB_PARTS.workbook(
      new Uint8Array([
        ...rec(156, [...u32(0), ...u32(1), ...wide('rId1'), ...wide('Data')]),
        ...rec(156, [...u32(1), ...u32(2), ...wide('rId2'), ...wide('Hide')]),
      ]),
    );
    assert.deepEqual(wb.sheets, [
      { name: 'Data', id: 'rId1', hidden: false },
      { name: 'Hide', id: 'rId2', hidden: true },
    ]);
  });
  it('sheet: rows and cells of several types', () => {
    const cell = (c, style = 0) => [...u32(c), ...u32(style)];
    const bytes = new Uint8Array([
      ...rec(0, u32(0)),
      ...rec(7, [...cell(0), ...u32(0)]), // shared string
      ...rec(2, [...cell(1), ...u32((5 << 2) | 2)]), // RK 5
      ...rec(4, [...cell(2), 1]), // TRUE
      ...rec(0, u32(2)),
      ...rec(6, [...cell(0), ...wide('text')]),
      ...rec(3, [...cell(1), 0x07]), // #DIV/0!
    ]);
    const d = XLSB_PARTS.sheet(bytes, ['s0'], [], false);
    assert.deepEqual(d.rows, [['s0', '5', 'TRUE'], [], ['text', '#DIV/0!']]);
  });
});
