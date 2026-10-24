// Highlighter: md (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classesOf, joined, load } from '../../helpers.mjs';

const { highlightMd } = await load('text/highlight/md.js');
const SAMPLE = '# Title\n\nSome *em* and `code` and [link](http://x).\n\n- item';

describe('text/highlight/md', () => {
  const tokens = highlightMd(SAMPLE);
  it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
  it('empty text', () => assert.equal(joined(highlightMd('')), ''));
  it('classes', () => {
    assert.ok(classesOf(tokens, '# Title').includes('kw'), '# Title');
    assert.ok(classesOf(tokens, '*em*').includes('enum'), '*em*');
    assert.ok(classesOf(tokens, '`code`').includes('str'), '`code`');
    assert.ok(classesOf(tokens, 'http://x').includes('aval'), 'http://x');
  });
});
