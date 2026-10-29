// Filters and sorting of tables: rows shown, next sort
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { nextSort, shownRows } = await load('view/filter.ts');

const ROWS = [
    ['b', '10'],
    ['a', '9'],
    ['c', '9'],
    ['A', ''],
];
const cell = (i: number, c: number) => ROWS[i][c];

describe('view/filter', () => {
    it('no filters, no sort: all rows in order', () => {
        assert.deepEqual(shownRows(4, cell, new Map(), null), [0, 1, 2, 3]);
    });

    it('filters: values kept and text contained (any case); all of them apply', () => {
        assert.deepEqual(shownRows(4, cell, new Map([[1, { values: new Set(['9']), text: '' }]]), null), [1, 2]);
        assert.deepEqual(shownRows(4, cell, new Map([[0, { values: null, text: 'A' }]]), null), [1, 3]);
        const both = new Map([
            [0, { values: null, text: 'a' }],
            [1, { values: new Set(['9']), text: '' }],
        ]);
        assert.deepEqual(shownRows(4, cell, both, null), [1]);
    });

    it('sort: numbers as numbers, any case, stable; descending; own sort keys', () => {
        assert.deepEqual(shownRows(4, cell, new Map(), { col: 1, dir: 1 }), [3, 1, 2, 0]);
        assert.deepEqual(shownRows(4, cell, new Map(), { col: 0, dir: -1 }), [2, 0, 1, 3]);
        const key = (i: number) => String(3 - i);
        assert.deepEqual(shownRows(4, cell, new Map(), { col: 0, dir: 1 }, key), [3, 2, 1, 0]);
    });

    it('next sort: ascending, descending, off; another column: ascending', () => {
        assert.deepEqual(nextSort(null, 'x'), { col: 'x', dir: 1 });
        assert.deepEqual(nextSort({ col: 'x', dir: 1 }, 'x'), { col: 'x', dir: -1 });
        assert.equal(nextSort({ col: 'x', dir: -1 }, 'x'), null);
        assert.deepEqual(nextSort({ col: 'x', dir: -1 }, 'y'), { col: 'y', dir: 1 });
    });
});
