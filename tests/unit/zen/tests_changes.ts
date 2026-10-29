// Zen list changes kept in the view until uploaded: per folder (any case), most recent first, forgotten when none
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';

const { keepChanges, loadChanges, ZEN_CHANGES_KEY } = await load('zen/changes.ts');

describe('zen/changes', () => {
    it('kept per folder (any case, trailing "/"); read back as they were', () => {
        keepChanges('/sites/A/Docs/X', new Map([[3, { Status: 'Draft', FileLeafRef: 'a.txt' }]]));
        assert.deepEqual([...loadChanges('/SITES/a/docs/x/')], [[3, { Status: 'Draft', FileLeafRef: 'a.txt' }]]);
        assert.equal(loadChanges('/sites/A/Docs/Y').size, 0);
    });

    it('most recent folder first; none left: folder forgotten', () => {
        keepChanges('/sites/A/Docs/Y', new Map([[1, { Title: 't' }]]));
        assert.deepEqual(Object.keys(JSON.parse(gm.local.get(ZEN_CHANGES_KEY) ?? '{}')), [
            '/sites/a/docs/y',
            '/sites/a/docs/x',
        ]);
        keepChanges('/sites/A/Docs/X', new Map());
        assert.deepEqual(Object.keys(JSON.parse(gm.local.get(ZEN_CHANGES_KEY) ?? '{}')), ['/sites/a/docs/y']);
    });

    it('broken store: nothing kept', () => {
        gm.local.set(ZEN_CHANGES_KEY, '{oops');
        assert.equal(loadChanges('/sites/A/Docs/Y').size, 0);
        gm.local.set(ZEN_CHANGES_KEY, JSON.stringify({ '/sites/a/docs/y': { x: { Title: 't' }, 2: { Title: 3 } } }));
        assert.equal(loadChanges('/sites/A/Docs/Y').size, 0, 'no ids, no texts: left out');
    });
});
