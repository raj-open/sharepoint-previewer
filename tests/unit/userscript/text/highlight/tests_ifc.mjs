// Highlighter: ifc (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classesOf, joined, load } from '../../../helpers.mjs';

const { highlightIfc } = await load('text/highlight/ifc.js');
const SAMPLE = "ISO-10303-21;\nDATA;\n#1=IFCWALL('id',$,#2,'Wall',.T.,1.5);\nENDSEC;";

describe('text/highlight/ifc', () => {
  const tokens = highlightIfc(SAMPLE);
  it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
  it('empty text', () => assert.equal(joined(highlightIfc('')), ''));
  it('classes', () => {
    assert.ok(classesOf(tokens, '#1').includes('ref'), '#1');
    assert.ok(classesOf(tokens, 'IFCWALL').includes('type'), 'IFCWALL');
    assert.ok(classesOf(tokens, 'DATA').includes('kw'), 'DATA');
  });
});
