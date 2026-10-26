// Checks run in a Web Worker built from the script's own function sources; without workers: on the page
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../../helpers.ts';

const { lintFile } = await load('text/lint/worker.ts');
const json = await load('text/lint/json.ts');
const yaml = await load('text/lint/yaml.ts');

describe('text/lint/worker', () => {
    it('no Worker available: checked on the page', async () => {
        Object.assign(globalThis, { Worker: undefined });
        const r = await lintFile({}, 'json', '{"a": }');
        assert.equal(r.problems.length, 1);
    });
    it('worker source: function names the worker refers to are the real ones', () => {
        // minified builds keep names (cf. justfile _minify); the worker text names these functions
        assert.equal(json.lintJson.name, 'lintJson');
        assert.equal(yaml.lintYaml.name, 'lintYaml');
        assert.equal(yaml.stripYamlComment.name, 'stripYamlComment');
    });
});
