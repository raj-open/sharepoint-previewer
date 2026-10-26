import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../../helpers.ts';

const { LINTERS } = await load('text/lint/index.ts');

describe('text/lint/index', () => {
    it('checks for JSON, XML, YAML, IFC, Power Query M', () => {
        assert.deepEqual(Object.keys(LINTERS).sort(), ['ifc', 'json', 'm', 'xml', 'yaml']);
    });
});
