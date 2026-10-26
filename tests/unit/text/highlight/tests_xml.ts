// Highlighter: xml (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { classesOf } from '../../helpers.ts';
import { joined } from '../../helpers.ts';
import { load } from '../../helpers.ts';

const { highlightXml } = await load('text/highlight/xml.ts');
const SAMPLE = '<?xml version="1.0"?>\n<a x="1"><!-- c --><b>t &amp;</b></a>';

describe('text/highlight/xml', () => {
    const tokens = highlightXml(SAMPLE);
    it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
    it('empty text', () => assert.equal(joined(highlightXml('')), ''));
    it('classes', () => {
        assert.ok(classesOf(tokens, '<a').includes('tag'), '<a');
        assert.ok(classesOf(tokens, 'x').includes('attr'), 'x');
        assert.ok(classesOf(tokens, '"1"').includes('aval'), '"1"');
        assert.ok(classesOf(tokens, '<!-- c -->').includes('com'), '<!-- c -->');
    });
});
