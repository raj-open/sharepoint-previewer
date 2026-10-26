import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../../helpers.ts';

const { lineAt, collector } = await load('text/lint/core.ts');
const { MAX_PROBLEMS } = await load('_core/settings.ts');

describe('text/lint/core', () => {
    it('lineAt: line of a character position', () => {
        assert.deepEqual(
            [0, 2, 3, 6].map((i) => lineAt('ab\ncd\nef', i)),
            [1, 1, 2, 3],
        );
    });
    it('collector: at most MAX_PROBLEMS', () => {
        const c = collector();
        for (let i = 0; i < MAX_PROBLEMS + 10; i++) c.add(i, 'x');
        c.add(1, 'w', 'warning');
        assert.equal(c.problems.length, MAX_PROBLEMS);
        assert.equal(c.problems[0].severity, 'error');
    });
});
