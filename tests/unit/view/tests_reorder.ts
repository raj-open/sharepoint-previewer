// Order changed by dragging with the pointer: wired on the container (no HTML drag and drop)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { wireReorder } = await load('view/reorder.ts');

describe('view/reorder', () => {
    it('listens for the pointer only (no drag events: Sharepoint takes those)', () => {
        const types: string[] = [];
        const root = { addEventListener: (type: string) => types.push(type) };
        wireReorder(root, { item: '[data-col]', axis: 'x', drop: () => {} });
        assert.deepEqual(types, ['pointerdown']);
    });
});
