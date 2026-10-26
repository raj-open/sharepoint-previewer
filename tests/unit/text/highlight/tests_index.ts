import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../../helpers.ts';

const { HIGHLIGHTERS } = await load('text/highlight/index.ts');
const { LANG_NAMES } = await load('text/lang.ts');

describe('text/highlight/index', () => {
    it('a highlighter for every language with a name (except plain IFCZIP)', () => {
        for (const lang of Object.keys(LANG_NAMES)) assert.equal(typeof HIGHLIGHTERS[lang], 'function', lang);
    });
});
