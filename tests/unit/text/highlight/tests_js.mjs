// Highlighter: js (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { classesOf } from '../../helpers.mjs';
import { joined } from '../../helpers.mjs';
import { load } from '../../helpers.mjs';

const { highlightJs } = await load('text/highlight/js.js');
const SAMPLE = 'const x = 1; // c\nfunction f(a) { return "s" + `t`; }';

describe('text/highlight/js', () => {
    const tokens = highlightJs(SAMPLE);
    it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
    it('empty text', () => assert.equal(joined(highlightJs('')), ''));
    it('classes', () => {
        assert.ok(classesOf(tokens, 'const').includes('kw'), 'const');
        assert.ok(classesOf(tokens, '1').includes('num'), '1');
        assert.ok(classesOf(tokens, '// c').includes('com'), '// c');
        assert.ok(classesOf(tokens, 'function').includes('kw'), 'function');
    });
});
