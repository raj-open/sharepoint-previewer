import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';

const menu = await load('_core/menu.ts');
const form = await load('_core/settings-form.ts');
const script = await load('_core/script.ts');
const before = Object.keys(gm.menu).length; // loading only defines
menu.registerMenu();

describe('menu', () => {
    it('loading registers nothing, registerMenu does', () => assert.equal(before, 0));
    it('entries: editor (with version), settings, reset, about (in this order: about last)', () => {
        assert.deepEqual(Object.keys(gm.menu), ['Edit (vtest)', 'Settings …', 'Reset settings', 'About …']);
        assert.equal(gm.menu['Edit (vtest)'], script.openEditor);
        assert.equal(gm.menu['Reset settings'], form.resetSettings);
        // settings and about: the form, on the tab "Form" or "About" (not on whatever Tampermonkey passes in)
        for (const label of ['Settings …', 'About …']) assert.equal(typeof gm.menu[label], 'function', label);
        assert.match(String(gm.menu['About …']), /openSettingsForm\('about'\)/);
        assert.match(String(gm.menu['Settings …']), /openSettingsForm\(\)/);
    });
});
