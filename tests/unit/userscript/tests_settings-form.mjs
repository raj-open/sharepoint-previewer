import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gm, load } from '../helpers.mjs';

const form = await load('settings-form.js');

describe('settings form', () => {
  it('menu entries: settings, reset', () => {
    assert.equal(gm.menu['Settings …'], form.openSettingsForm);
    assert.equal(typeof gm.menu['Reset settings to defaults'], 'function');
  });
  it('reset writes every default back', async () => {
    const { DEFAULTS } = await load('settings.js');
    gm.store.theme = 'dark';
    globalThis.confirm = () => true;
    globalThis.alert = () => {};
    gm.menu['Reset settings to defaults']();
    assert.equal(gm.store.theme, DEFAULTS.theme);
  });
});
