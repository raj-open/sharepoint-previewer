// Formats: recognised from the file name or chosen; reader and language of each
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { FORMAT_LISTS, formatLabel, formatName, formatOf, langOfFormat, readerOf } = await load('readers/formats.ts');

describe('readers/formats', () => {
    it('recognised from the file name: file formats first, then languages, else plain text', () => {
        assert.deepEqual(
            [
                'a.parquet',
                'a.XLSX',
                'a.ods',
                'a.ifczip',
                'a.pbix',
                'a.cset',
                'a.ifc',
                'a.csv',
                'a.log',
                'a.xyz',
                'a',
            ].map(formatOf),
            ['parquet', 'sheet', 'sheet', 'ifczip', 'pbix', 'cset', 'ifc', 'csv', 'log', 'text', 'text'],
        );
    });
    it('reader and language of a format', () => {
        assert.deepEqual(['parquet', 'sheet', 'ifczip', 'pbix', 'cset', 'csv', 'text'].map(readerOf), [
            'parquet',
            'sheet',
            'ifczip',
            'pbix',
            'cset',
            'text',
            'text',
        ]);
        assert.deepEqual(['parquet', 'sheet', 'ifczip', 'pbix', 'cset', 'csv', 'text'].map(langOfFormat), [
            'parquet',
            'sheet',
            'ifc',
            'md',
            'md',
            'csv',
            null,
        ]);
    });
    it('picker lists: plain text first, then all formats by name (file formats too), file formats alone', () => {
        const [[text, texts], [files, binaries]] = FORMAT_LISTS;
        assert.deepEqual([text, files, texts[0]], ['Text', 'Files', 'text']);
        assert.deepEqual(binaries, ['parquet', 'sheet', 'ifczip', 'pbix', 'cset']);
        assert.equal(new Set(texts).size, texts.length);
        assert.ok(binaries.every((b: string) => texts.includes(b))); // the same formats in the first list
        const names = texts.slice(1).map(formatName);
        assert.deepEqual(
            names,
            [...names].sort((a, b) => a.localeCompare(b)),
        );
        assert.deepEqual(['text', 'csv', 'sheet', 'xyz'].map(formatName), ['Text', 'CSV', 'Spreadsheet', 'Text']);
        assert.deepEqual(['pbix', 'cset', 'csv'].map(formatLabel), [
            'Power BI (.pbix)',
            'Solibri ruleset (.cset)',
            'CSV',
        ]);
    });
});
