import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../helpers.mjs';

const { LINTERS } = await load('text/lint/index.js');

describe('text/lint/index', () => {
  it('checks for JSON, XML, YAML, IFC, Power Query M', () => {
    assert.deepEqual(Object.keys(LINTERS).sort(), ['ifc', 'json', 'm', 'xml', 'yaml']);
  });
});
