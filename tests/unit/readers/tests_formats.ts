// Formats: recognised from the file name or chosen; reader and language of each
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { FORMAT_LISTS, formatName, formatOf, langOfFormat, readerOf } = await load('readers/formats.ts');

describe('readers/formats', () => {
    it('recognised from the file name: file formats first, then languages, else plain text', () => {
        assert.deepEqual(
            ['a.parquet', 'a.XLSX', 'a.ods', 'a.ifczip', 'a.ifc', 'a.csv', 'a.log', 'a.xyz', 'a'].map(formatOf),
            ['parquet', 'sheet', 'sheet', 'ifczip', 'ifc', 'csv', 'log', 'text', 'text'],
        );
    });
    it('reader and language of a format', () => {
        assert.deepEqual(['parquet', 'sheet', 'ifczip', 'csv', 'text'].map(readerOf), [
            'parquet',
            'sheet',
            'ifczip',
            'text',
            'text',
        ]);
        assert.deepEqual(['parquet', 'sheet', 'ifczip', 'csv', 'text'].map(langOfFormat), [
            'parquet',
            'sheet',
            'ifc',
            'csv',
            null,
        ]);
    });
    it('picker lists: plain text first, every format once, each with a name', () => {
        const [[text, texts], [files, binaries]] = FORMAT_LISTS;
        assert.deepEqual([text, files, texts[0]], ['Text', 'Files', 'text']);
        assert.deepEqual(binaries, ['parquet', 'sheet', 'ifczip']);
        const all = texts.concat(binaries);
        assert.equal(new Set(all).size, all.length);
        assert.deepEqual(['text', 'csv', 'sheet', 'xyz'].map(formatName), ['Text', 'CSV', 'Spreadsheet', 'Text']);
    });
});
