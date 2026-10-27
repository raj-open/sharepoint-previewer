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
    it('entries: editor (with version), settings, reset (in this order)', () => {
        assert.deepEqual(Object.keys(gm.menu), ['Edit (vtest)', 'Settings …', 'Reset settings']);
        assert.equal(gm.menu['Edit (vtest)'], script.openEditor);
        assert.equal(gm.menu['Settings …'], form.openSettingsForm);
        assert.equal(gm.menu['Reset settings'], form.resetSettings);
    });
});
