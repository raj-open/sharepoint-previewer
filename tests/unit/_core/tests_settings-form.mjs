import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.mjs';
import { load } from '../helpers.mjs';

const form = await load('_core/settings-form.js');
const before = Object.keys(gm.menu).length; // loading only defines
form.registerMenu();

describe('settings form', () => {
    it('loading registers nothing, registerMenu does', () => assert.equal(before, 0));
    it('menu entries: settings, reset', () => {
        assert.equal(gm.menu['Settings …'], form.openSettingsForm);
        assert.equal(typeof gm.menu['Reset settings to defaults'], 'function');
    });
    it('reset writes every default back', async () => {
        const { DEFAULTS } = await load('_core/settings.js');
        gm.store.theme = 'dark';
        globalThis.confirm = () => true;
        globalThis.alert = () => {};
        gm.menu['Reset settings to defaults']();
        assert.equal(gm.store.theme, DEFAULTS.theme);
    });
});
