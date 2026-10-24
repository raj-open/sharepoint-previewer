// Highlighter: rst (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { classesOf } from '../../helpers.mjs';
import { joined } from '../../helpers.mjs';
import { load } from '../../helpers.mjs';

const { highlightRst } = await load('text/highlight/rst.js');
const SAMPLE = 'Title\n=====\n\n.. note:: text\n\n``code`` and *em*';

describe('text/highlight/rst', () => {
    const tokens = highlightRst(SAMPLE);
    it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
    it('empty text', () => assert.equal(joined(highlightRst('')), ''));
    it('classes', () => {
        assert.ok(classesOf(tokens, '=====').includes('kw'), '=====');
        assert.ok(classesOf(tokens, '.. note::').includes('meta'), '.. note::');
        assert.ok(classesOf(tokens, '``code``').includes('str'), '``code``');
    });
});
