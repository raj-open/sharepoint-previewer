import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';

const form = await load('_core/settings-form.ts');
const before = Object.keys(gm.menu).length; // loading only defines
form.registerMenu();

describe('settings form', () => {
    it('loading registers nothing, registerMenu does', () => assert.equal(before, 0));
    it('menu entries: settings, reset', () => {
        assert.equal(gm.menu['Settings …'], form.openSettingsForm);
        assert.equal(typeof gm.menu['Reset settings to defaults'], 'function');
    });
    it('completeSettings: missing from defaults, unknown dropped, given kept', async () => {
        const { DEFAULTS } = await load('_core/settings.ts');
        const out = form.completeSettings({ 'theme': 'dark', 'layout': 7, 'old-name': true });
        assert.deepEqual(Object.keys(out), Object.keys(DEFAULTS));
        assert.equal(out.theme, 'dark');
        assert.equal(out.layout, 7); // wrong values stay: the JSON view lists the reasons
        assert.equal(out['wrap-lines'], DEFAULTS['wrap-lines']);
    });
    it('reset writes every default back', async () => {
        const { DEFAULTS } = await load('_core/settings.ts');
        gm.store.theme = 'dark';
        globalThis.confirm = () => true;
        globalThis.alert = () => {};
        gm.menu['Reset settings to defaults']();
        assert.equal(gm.store.theme, DEFAULTS.theme);
    });
});
