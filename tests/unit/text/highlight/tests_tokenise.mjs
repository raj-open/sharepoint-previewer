// Tokeniser: matches and gaps in order, nothing lost
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { joined, load } from '../../helpers.mjs';

const { tokenise } = await load('text/highlight/tokenise.js');

describe('text/highlight/tokenise', () => {
  it('matches get their class, gaps stay plain', () => {
    const tokens = tokenise('a1b22', /\d+/g, (m, out) => out.push(['num', m[0]]));
    assert.deepEqual(tokens, [
      ['', 'a'],
      ['num', '1'],
      ['', 'b'],
      ['num', '22'],
    ]);
    assert.equal(joined(tokens), 'a1b22');
  });
});
