import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';

const form = await load('_core/settings-form.ts');

describe('settings form', () => {
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
        form.resetSettings();
        assert.equal(gm.store.theme, DEFAULTS.theme);
    });
});
