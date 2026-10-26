// Tokeniser: matches and gaps in order, nothing lost
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { joined } from '../../helpers.ts';
import { load } from '../../helpers.ts';

const { tokenise } = await load('text/highlight/tokenise.ts');

describe('text/highlight/tokenise', () => {
    it('matches get their class, gaps stay plain', () => {
        const tokens: [string, string][] = tokenise('a1b22', /\d+/g, (m, out) => out.push(['num', m[0]]));
        assert.deepEqual(tokens, [
            ['', 'a'],
            ['num', '1'],
            ['', 'b'],
            ['num', '22'],
        ]);
        assert.equal(joined(tokens), 'a1b22');
    });
});
