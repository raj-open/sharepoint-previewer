// Highlighter: toml (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classesOf, joined, load } from '../../../helpers.mjs';

const { highlightToml } = await load('text/highlight/toml.js');
const SAMPLE = '[table]\nkey = "v"\nn = 42 # c';

describe('text/highlight/toml', () => {
  const tokens = highlightToml(SAMPLE);
  it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
  it('empty text', () => assert.equal(joined(highlightToml('')), ''));
  it('classes', () => {
    assert.ok(classesOf(tokens, '[table]').includes('type'), '[table]');
    assert.ok(classesOf(tokens, 'key').includes('key'), 'key');
    assert.ok(classesOf(tokens, '"v"').includes('str'), '"v"');
    assert.ok(classesOf(tokens, '42').includes('num'), '42');
    assert.ok(classesOf(tokens, '# c').includes('com'), '# c');
  });
});
