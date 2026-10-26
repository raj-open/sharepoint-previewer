// Highlighter: m (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { classesOf } from '../../helpers.ts';
import { joined } from '../../helpers.ts';
import { load } from '../../helpers.ts';

const { highlightM } = await load('text/highlight/m.ts');
const SAMPLE = 'let\n  Source = Excel.Workbook(File.Contents("a.xlsx"), null, true) // c\nin\n  Source';

describe('text/highlight/m', () => {
    const tokens = highlightM(SAMPLE);
    it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
    it('empty text', () => assert.equal(joined(highlightM('')), ''));
    it('classes', () => {
        assert.ok(classesOf(tokens, 'let').includes('kw'), 'let');
        assert.ok(classesOf(tokens, 'Excel.Workbook').includes('enum'), 'Excel.Workbook');
        assert.ok(classesOf(tokens, '"a.xlsx"').includes('str'), '"a.xlsx"');
    });
});
