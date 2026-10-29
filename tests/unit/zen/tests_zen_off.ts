// Zen mode with the setting "sharepoint-api" off: refused, with the reason
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';

gm.store['sharepoint-api'] = false; // before the settings load
const { zenProblem } = await load('zen/zen.ts');
const { getJson } = await load('readers/api.ts');

describe('zen/zen (API off)', () => {
    it('refused, saying which setting; no request made', async () => {
        assert.match(zenProblem(), /not allowed \(setting "sharepoint-api"\)/);
        let called = false;
        globalThis.fetch = (async () => {
            called = true;
            return new Response('{}');
        }) as typeof fetch;
        assert.match(await getJson('/sites/A/_api/web'), /not allowed/);
        assert.equal(called, false);
    });
});
