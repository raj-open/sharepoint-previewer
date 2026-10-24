// XML check uses the browser's DOMParser (checked in the behavioural tests); here: no parser, no crash of the caller
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../../helpers.mjs';

const { lintXml } = await load('text/lint/xml.js');

describe('text/lint/xml', () => {
  it('needs DOMParser (page only, not in the worker)', () => {
    assert.throws(() => lintXml('<a/>'), /DOMParser/);
  });
});
