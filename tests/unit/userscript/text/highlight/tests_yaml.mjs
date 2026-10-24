// Highlighter: yaml (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classesOf, joined, load } from '../../../helpers.mjs';

const { highlightYaml } = await load('text/highlight/yaml.js');
const SAMPLE = '# c\nkey: value\nlist:\n  - 1\n  - "s"\nflag: true';

describe('text/highlight/yaml', () => {
  const tokens = highlightYaml(SAMPLE);
  it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
  it('empty text', () => assert.equal(joined(highlightYaml('')), ''));
  it('classes', () => {
    assert.ok(classesOf(tokens, '# c').includes('com'), '# c');
    assert.ok(classesOf(tokens, 'key').includes('key'), 'key');
    assert.ok(classesOf(tokens, 'value').includes('str'), 'value');
    assert.ok(classesOf(tokens, '1').includes('num'), '1');
  });
});
