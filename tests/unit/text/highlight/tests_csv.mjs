// Highlighter: csv (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classesOf, joined, load } from '../../helpers.mjs';

const { highlightCsv } = await load('text/highlight/csv.js');
const SAMPLE = 'a,b,c\n1,"x,y",3';

describe('text/highlight/csv', () => {
  const tokens = highlightCsv(SAMPLE);
  it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
  it('empty text', () => assert.equal(joined(highlightCsv('')), ''));
  it('classes', () => {
    assert.ok(classesOf(tokens, 'a').includes('key'), 'a');
    assert.ok(classesOf(tokens, 'b').includes('str'), 'b');
    assert.ok(classesOf(tokens, '"x,y"').includes('str'), '"x,y"');
  });
});
