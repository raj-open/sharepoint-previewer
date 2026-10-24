// Settings: defaults, own values from Tampermonkey's storage; values of wrong type are ignored
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gm, load } from '../helpers.mjs';

gm.store['parquet-rows'] = 250; // own value
gm.store['wrap-lines'] = 'yes'; // wrong type: default applies
const settings = await load('_core/settings.js');

describe('settings', () => {
  it('own values replace defaults', () => assert.equal(settings.PARQUET_ROWS, 250));
  it('values of wrong type are ignored', () => assert.equal(settings.DEFAULT_WRAP, false));
  it('missing values are stored with their default', () => {
    for (const key of Object.keys(settings.DEFAULTS)) assert.ok(key in gm.store, key);
    assert.equal(gm.store.layout, 'horizontal');
  });
  it('spreadsheet column colours are off by default', () => assert.equal(settings.DEFAULT_SHEET_COLOURS, false));
  it('3D checksums are SHA-256 in hex', () => {
    assert.match(settings.VIEWER_3D_JS_SHA256, /^[0-9a-f]{64}$/);
    assert.match(settings.VIEWER_3D_WASM_SHA256, /^[0-9a-f]{64}$/);
  });
});
