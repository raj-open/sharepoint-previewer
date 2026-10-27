// Logo and version of the script (viewer, settings form)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';

const { bindBrand, brandHtml, brandTitle } = await load('ui/brand.ts');

describe('ui/brand', () => {
    it('no logo set: version only, as a link to the editor', () => {
        assert.match(brandHtml(), /^<a href="#" data-edit title="[^"]+" [^>]*>vtest<\/a>$/);
        assert.equal(brandTitle(), 'Sharepoint Previewer vtest');
    });
    it('bound link opens the editor, page stays', () => {
        const link = { onclick: null as ((e: { preventDefault: () => void }) => void) | null };
        bindBrand({ querySelector: () => link });
        let prevented = false;
        link.onclick?.({ preventDefault: () => (prevented = true) });
        assert.ok(prevented);
        assert.equal(gm.tabs.at(-1), 'options.html#nav=test-uuid+editor');
    });
});
