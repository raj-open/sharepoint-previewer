// Zen list columns: order and hidden ones (view's columns first), moves, kept per library
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';

const { columnOrder, loadColumns, moveColumn, saveColumns, ZEN_COLUMNS_KEY } = await load('zen/columns.ts');

const field = (name: string) => ({
    name,
    title: name,
    type: 'Text',
    entity: name,
    textKey: name,
    editable: true,
    choices: [],
});
const DATA = {
    library: '/sites/A/Docs',
    folder: '/sites/A/Docs',
    fields: ['FileLeafRef', 'Title', 'Status', 'Notes', 'Modified'].map(field),
    view: ['Modified', 'Status'],
    items: [],
};
const NONE = { order: [], hidden: [], widths: {} };

describe('zen/columns', () => {
    it("nothing kept: view's columns in its order, the others hidden after them; the name never listed", () => {
        const { order, hidden } = columnOrder(DATA, NONE);
        assert.deepEqual(order, ['Modified', 'Status', 'Title', 'Notes']);
        assert.deepEqual([...hidden], ['Title', 'Notes']);
    });

    it('kept: their order and hidden ones; columns new since then hidden unless in the view; gone ones dropped', () => {
        const kept = { order: ['Status', 'Gone', 'Title'], hidden: ['Title'], widths: {} };
        const { order, hidden } = columnOrder(DATA, kept);
        assert.deepEqual(order, ['Status', 'Title', 'Modified', 'Notes']);
        assert.deepEqual([...hidden].sort(), ['Notes', 'Title']);
    });

    it('move: before another column, or to the end', () => {
        assert.deepEqual(moveColumn(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
        assert.deepEqual(moveColumn(['a', 'b', 'c'], 'a', null), ['b', 'c', 'a']);
        assert.deepEqual(moveColumn(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c']);
    });

    it('kept per library (any case), most recent first', () => {
        saveColumns('/sites/A/Docs', { order: ['Status'], hidden: [], widths: { Status: 80 } });
        saveColumns('/sites/B/Docs', { order: ['Title'], hidden: ['Title'], widths: {} });
        assert.deepEqual(loadColumns('/SITES/A/docs'), { order: ['Status'], hidden: [], widths: { Status: 80 } });
        assert.deepEqual(Object.keys(JSON.parse(gm.local.get(ZEN_COLUMNS_KEY) ?? '{}')), [
            '/sites/b/docs',
            '/sites/a/docs',
        ]);
        assert.deepEqual(loadColumns('/sites/C/Docs'), NONE);
    });
});
