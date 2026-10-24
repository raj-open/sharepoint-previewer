import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../../helpers.mjs';

const { lintM } = await load('text/lint/m.js');

describe('text/lint/m', () => {
  it('valid', () => assert.deepEqual(lintM('let\n  a = 1\nin\n  a').problems, []));
  it('bracket never closed: line of the bracket', () => {
    assert.deepEqual(lintM('let\n  a = (1\nin\n  a').problems, [
      { line: 2, msg: '"(" is never closed', severity: 'error' },
    ]);
  });
});
