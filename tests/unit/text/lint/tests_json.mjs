import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../helpers.mjs';

const { lintJson } = await load('text/lint/json.js');

describe('text/lint/json', () => {
  it('valid: no problems, kind of top value', () =>
    assert.deepEqual(lintJson('{"a": 1}'), { problems: [], info: 'object' }));
  it('invalid: one error', () => {
    const r = lintJson('{"a": 1,\n "b": }');
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].severity, 'error');
  });
});
