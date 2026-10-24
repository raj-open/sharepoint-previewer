// Highlighter: xlf (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { classesOf } from '../../helpers.mjs';
import { joined } from '../../helpers.mjs';
import { load } from '../../helpers.mjs';

const { highlightXlf } = await load('text/highlight/xlf.js');
const SAMPLE = '=SUM(A1:B2, 3) & "t"';

describe('text/highlight/xlf', () => {
    const tokens = highlightXlf(SAMPLE);
    it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
    it('empty text', () => assert.equal(joined(highlightXlf('')), ''));
    it('classes', () => {
        assert.ok(classesOf(tokens, 'SUM').includes('type'), 'SUM');
        assert.ok(classesOf(tokens, 'A1:B2').includes('ref'), 'A1:B2');
        assert.ok(classesOf(tokens, '3').includes('num'), '3');
    });
});
