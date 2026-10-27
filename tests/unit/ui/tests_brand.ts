// Logo and version of the script (viewer, settings form)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { brandHtml, brandTitle, scriptVersion } = await load('ui/brand.ts');

describe('ui/brand', () => {
    it('version of the running script; no logo set: version only', () => {
        assert.equal(scriptVersion(), 'test');
        assert.equal(brandHtml(), '<span>vtest</span>');
        assert.equal(brandTitle(), 'Sharepoint Previewer vtest');
    });
});
