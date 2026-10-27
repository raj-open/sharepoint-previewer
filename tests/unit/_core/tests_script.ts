import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { gm } from '../helpers.ts';
import { load } from '../helpers.ts';

const { openEditor, scriptVersion } = await load('_core/script.ts');

describe('_core/script', () => {
    it('version of the running script', () => assert.equal(scriptVersion(), 'test'));
    it('editor: relative URL of this script in the extension', () => {
        openEditor();
        assert.deepEqual(gm.tabs, ['options.html#nav=test-uuid+editor']);
    });
});
