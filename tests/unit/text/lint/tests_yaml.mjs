import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../../helpers.mjs';

const { lintYaml, stripYamlComment } = await load('text/lint/yaml.js');

describe('text/lint/yaml', () => {
    it('valid', () => assert.deepEqual(lintYaml('a: 1\nb:\n  - x').problems, []));
    it('bad indentation and tabs, by line', () => {
        const lines = lintYaml('a: 1\n  b: 2\n\tc: 3').problems.map((p) => p.line);
        assert.deepEqual(lines, [2, 3]);
    });
    it('comments stripped, but not inside quotes', () => {
        assert.equal(stripYamlComment('a: 1 # note').trimEnd(), 'a: 1');
        assert.equal(stripYamlComment("a: '# not a comment'"), "a: '# not a comment'");
    });
});
