// Highlighter: py (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { classesOf } from '../../helpers.mjs';
import { joined } from '../../helpers.mjs';
import { load } from '../../helpers.mjs';

const { highlightPy } = await load('text/highlight/py.js');
const SAMPLE = 'def f(x):\n    # c\n    return "s" if x else None';

describe('text/highlight/py', () => {
    const tokens = highlightPy(SAMPLE);
    it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
    it('empty text', () => assert.equal(joined(highlightPy('')), ''));
    it('classes', () => {
        assert.ok(classesOf(tokens, 'def').includes('kw'), 'def');
        assert.ok(classesOf(tokens, '# c').includes('com'), '# c');
        assert.ok(classesOf(tokens, '"s"').includes('str'), '"s"');
    });
});
