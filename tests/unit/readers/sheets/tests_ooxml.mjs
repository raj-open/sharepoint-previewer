// Excel 2007+ package: workbook found via relationships, sheets loaded one by one
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../../helpers.mjs';
import { load } from '../../helpers.mjs';
import { reader } from '../../helpers.mjs';

const { readOoxml } = await load('readers/sheets/ooxml.js');
const { zipPackage } = await load('readers/sheets/package.js');

const open = async (file) => {
    const bytes = fixture(file);
    return readOoxml(await zipPackage(reader(bytes).read, bytes.length));
};

describe('readers/sheets/ooxml', () => {
    for (const [ext, format] of [
        ['xlsx', 'Excel (XLSX)'],
        ['xlsb', 'Excel (XLSB)'],
    ]) {
        it(`${ext}: sheets with path and packed size, then cells`, async () => {
            const book = await open(`Data/harvest.${ext}`);
            assert.equal(book.format, format);
            assert.deepEqual(
                book.sheets.map((s) => [s.name, s.kind, s.size > 0]),
                [
                    ['Prices', 'sheet', true],
                    ['Notes', 'sheet', true],
                    ['Secret', 'sheet', true],
                ],
            );
            assert.equal((await book.load(2)).rows[0][0], 'hidden value');
        });
    }
});
