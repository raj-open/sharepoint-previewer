// Excel 97–2003: BIFF8 globals, then each sheet's records by itself
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../../helpers.ts';
import { load } from '../../helpers.ts';
import { reader } from '../../helpers.ts';

const { readXls } = await load('readers/sheets/xls.ts');

describe('readers/sheets/xls', () => {
    it('sheets, hidden, sizes; cells with dates and booleans', async () => {
        const bytes = fixture('Data/harvest.xls');
        const book = await readXls(reader(bytes).read, bytes.length);
        assert.equal(book.format, 'Excel 97–2003 (XLS)');
        assert.deepEqual(
            book.sheets.map((s) => [s.name, s.hidden, s.size > 0]),
            [
                ['Prices', false, true],
                ['Notes', false, true],
                ['Secret', true, true],
            ],
        );
        const d = await book.load(0);
        assert.deepEqual(d.rows[1], ['apple', '1.25', '2026-09-01', 'TRUE']);
    });
});
