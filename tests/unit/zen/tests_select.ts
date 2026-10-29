// Zen list selection: one, a range (as shown), all shown or none; filtered out: dropped
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { pick, pickAll, pickState, pruneSelection, selectedItems } = await load('zen/select.ts');

const item = (id: number, name: string, folder = false) => ({
    id,
    name,
    path: `/sites/A/Docs/${name}`,
    folder,
    text: { FileLeafRef: name },
    raw: { FileLeafRef: name },
});

// shown: folder first (3), then 1, 2, 4
function zen() {
    return {
        data: {
            fields: [
                {
                    name: 'FileLeafRef',
                    title: 'Name',
                    type: 'File',
                    entity: 'FileLeafRef',
                    textKey: 'FileLeafRef',
                    editable: true,
                    choices: [],
                },
            ],
            items: [item(1, 'a.txt'), item(2, 'b.txt'), item(3, 'Sub', true), item(4, 'c.txt')],
        },
        sort: null,
        filters: new Map(),
        pending: new Map(),
        selected: new Set<number>(),
        anchor: null as number | null,
    };
}

const ids = (z: ReturnType<typeof zen>) => [...z.selected].sort();

describe('zen/select', () => {
    it('one: picked, again: dropped; the last one clicked is the start of a range', () => {
        const z = zen();
        pick(z, 2, null);
        assert.deepEqual(ids(z), [2]);
        assert.equal(z.anchor, 2);
        pick(z, 2, null);
        assert.deepEqual(ids(z), []);
        pick(z, 4, true);
        pick(z, 4, true);
        assert.deepEqual(ids(z), [4]);
    });

    it('range (Shift): from the last one clicked, in the order shown (folders first), either way', () => {
        const z = zen();
        pick(z, 3, true);
        pick(z, 2, true, true);
        assert.deepEqual(ids(z), [1, 2, 3]);
        pick(z, 4, false);
        pick(z, 1, false, true);
        assert.deepEqual(ids(z), [3]);
        assert.deepEqual(
            selectedItems(z).map((x: { id: number }) => x.id),
            [3],
        );
    });

    it('all shown, or none if all are; state of the head', () => {
        const z = zen();
        assert.equal(pickState(z), 'none');
        pick(z, 1, true);
        assert.equal(pickState(z), 'some');
        pickAll(z);
        assert.equal(pickState(z), 'all');
        assert.deepEqual(ids(z), [1, 2, 3, 4]);
        pickAll(z);
        assert.deepEqual(ids(z), []);
    });

    it('filtered out: dropped from the selection (what is picked is what is seen)', () => {
        const z = zen();
        pickAll(z);
        z.filters.set('FileLeafRef', { values: null, text: '.txt' });
        pruneSelection(z);
        assert.deepEqual(ids(z), [1, 2, 4]);
        assert.equal(pickState(z), 'all');
    });
});
