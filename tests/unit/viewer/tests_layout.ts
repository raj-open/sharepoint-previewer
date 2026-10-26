// Layout (split modes measure SharePoint's page: behavioural tests); without viewer nothing moves
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { syncPanel, setMode } = await load('viewer/layout.ts');

describe('viewer/layout', () => {
    it('no viewer: sync and mode change do nothing', () => {
        assert.equal(syncPanel(), undefined);
        assert.equal(setMode('vertical'), undefined);
    });
});
