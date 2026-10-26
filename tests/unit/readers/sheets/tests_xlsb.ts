// Excel binary workbook: BIFF12 records, RK numbers
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../../helpers.ts';

const { rkNumber, XLSB_PARTS } = await load('readers/sheets/xlsb.ts');

// record: type and size as 7-bit varints
const rec = (type: number, data: number[] = []): number[] => [
    ...(type < 128 ? [type] : [(type & 0x7f) | 0x80, type >> 7]),
    data.length,
    ...data,
];
const u32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const wide = (s: string): number[] => [...u32(s.length), ...[...s].flatMap((c) => [c.charCodeAt(0), 0])];

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
        const cell = (c: number, style = 0): number[] => [...u32(c), ...u32(style)];
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
    it('table: range, header and totals rows, names, column captions', () => {
        const none = u32(0xffffffff);
        // BrtBeginList: range (rows 2-5, columns 1-3), type, id, header, totals, flags, 6 styles, connection
        const list = [...u32(2), ...u32(5), ...u32(1), ...u32(3), ...u32(0), ...u32(1), ...u32(1), ...u32(1)];
        const fixed = [...list, ...u32(0), ...Array(6).fill(none).flat(), ...u32(0)];
        // BrtBeginListCol: id, total function, 3 styles, query field; name (none), caption
        const col = (caption: string): number[] => [
            ...u32(1),
            ...u32(0),
            ...none,
            ...none,
            ...none,
            ...u32(0),
            ...none,
            ...wide(caption),
        ];
        const bytes = new Uint8Array([
            ...rec(343, [...fixed, ...wide('Table1'), ...wide('Stock'), ...none]),
            ...rec(345, u32(2)),
            ...rec(347, col('fruit')),
            ...rec(348),
            ...rec(347, col('kg')),
            ...rec(348),
        ]);
        assert.deepEqual(XLSB_PARTS.table(bytes), {
            name: 'Stock',
            range: { r0: 2, r1: 5, c0: 1, c1: 3 },
            header: 1,
            totals: 1,
            columns: ['fruit', 'kg'],
        });
    });
});
