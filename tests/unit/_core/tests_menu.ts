import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';

const menu = await load('_core/menu.ts');
const form = await load('_core/settings-form.ts');
const before = Object.keys(gm.menu).length; // loading only defines
menu.registerMenu();

describe('menu', () => {
    it('loading registers nothing, registerMenu does', () => assert.equal(before, 0));
    it('entries: settings, reset, editor (in this order)', () => {
        assert.deepEqual(Object.keys(gm.menu), ['Settings …', 'Reset settings to defaults', 'Edit plugin']);
        assert.equal(gm.menu['Settings …'], form.openSettingsForm);
        assert.equal(gm.menu['Reset settings to defaults'], form.resetSettings);
    });
    it('editor: relative URL of this script in the extension', () => {
        gm.menu['Edit plugin']();
        assert.deepEqual(gm.tabs, ['options.html#nav=test-uuid+editor']);
    });
});
