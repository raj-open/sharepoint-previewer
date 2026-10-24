// View choices remembered in localStorage; settings give the start values
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.mjs';
import { load } from '../helpers.mjs';

gm.local.set('tp-preview-mode', 'popup');
gm.local.set('tp-preview-meta-lines', '42'); // out of range: clamped
gm.local.set('tp-preview-csv-sep', 'nonsense'); // unknown delimiter: as in the file
const prefs = await load('_core/prefs.js');

describe('prefs', () => {
    it('remembered choices win over start values', () => assert.equal(prefs.view.mode, 'popup'));
    it('start values where nothing is remembered', () => {
        assert.equal(prefs.view.theme, 'light');
        assert.equal(prefs.view.table, true);
    });
    it('lines of properties are kept in 1 … 6', () => assert.equal(prefs.view.metaLines, 6));
    it('unknown CSV delimiter falls back to the file', () => assert.equal(prefs.csvFormat.sep, ''));
    it('save, load, remove', () => {
        prefs.savePref('k', 'v');
        assert.equal(prefs.loadPref('k', 'x'), 'v');
        prefs.removePref('k');
        assert.equal(prefs.loadPref('k', 'x'), 'x');
    });
    it('colour choices per view; sheet colours off', () => {
        assert.deepEqual(Object.keys(prefs.COLOUR_KEYS), ['text', 'table', 'sheet']);
        assert.equal(prefs.colourPrefs.sheet, false);
    });
    it('blocked storage: fallbacks, no errors', () => {
        const saved = globalThis.localStorage;
        globalThis.localStorage = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
        };
        assert.equal(prefs.loadPref('x', 'fallback'), 'fallback');
        prefs.savePref('x', 'y');
        globalThis.localStorage = saved;
    });
});
