// Zen mode: when it can start (setting, library page); without a viewer nothing is pending or saved
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { setLocation } from '../helpers.ts';

const { zenPending, zenProblem, zenSave } = await load('zen/zen.ts');

describe('zen/zen', () => {
    it('starts only in a library (API allowed by default)', () => {
        setLocation('/sites/A/Shared%20Documents/Forms/AllItems.aspx');
        assert.equal(zenProblem(), '');
        setLocation('/sites/A/SitePages/Home.aspx');
        assert.match(zenProblem(), /document library/);
    });

    it('no viewer: nothing pending, Ctrl+S left to others', () => {
        assert.equal(zenPending(), false);
        assert.equal(zenSave(), false);
    });
});
