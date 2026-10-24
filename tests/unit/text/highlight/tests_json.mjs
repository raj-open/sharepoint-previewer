// Highlighter: json (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classesOf, joined, load } from '../../helpers.mjs';

const { highlightJson } = await load('text/highlight/json.js');
const SAMPLE = '{"key": "v", "n": 1.5, "b": true, "z": null}';

describe('text/highlight/json', () => {
  const tokens = highlightJson(SAMPLE);
  it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
  it('empty text', () => assert.equal(joined(highlightJson('')), ''));
  it('classes', () => {
    assert.ok(classesOf(tokens, '"key"').includes('key'), '"key"');
    assert.ok(classesOf(tokens, '"v"').includes('str'), '"v"');
    assert.ok(classesOf(tokens, '1.5').includes('num'), '1.5');
  });
});
