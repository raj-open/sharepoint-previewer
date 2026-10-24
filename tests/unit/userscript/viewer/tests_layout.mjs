// Layout (split modes measure SharePoint's page: behavioural tests); without viewer nothing moves
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../helpers.mjs';

const { syncPanel, setMode } = await load('viewer/layout.js');

describe('viewer/layout', () => {
  it('no viewer: sync and mode change do nothing', () => {
    assert.equal(syncPanel(), undefined);
    assert.equal(setMode('vertical'), undefined);
  });
});
