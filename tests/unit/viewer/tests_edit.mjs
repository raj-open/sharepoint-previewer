// Write mode: which files, pending changes
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fakeViewer } from '../helpers.mjs';
import { load } from '../helpers.mjs';

const { canWrite, markEdited, discardEdits, editedText } = await load('viewer/edit.js');

describe('viewer/edit', () => {
    it('only plain text files are editable', () => {
        assert.equal(canWrite({ source: { text: '' } }), true);
        for (const kind of ['isParquet', 'isZip', 'isSheet'])
            assert.equal(canWrite({ source: { [kind]: true } }), false, kind);
        assert.equal(canWrite({}), false);
    });
    it('edited: save again before upload', () => {
        const v = fakeViewer();
        markEdited(v);
        assert.equal(v.dirty, true);
        assert.equal(v.saveBtn.disabled, false);
        assert.equal(v.uploadBtn.disabled, true);
    });
    it('discard: saved text back to the cached one', () => {
        const v = fakeViewer({ source: { text: 'saved', originalText: 'cached' }, staged: 'saved', dirty: true });
        discardEdits(v);
        assert.equal(v.text, 'cached');
        assert.equal(v.source.originalText, null);
        assert.equal(v.staged, null);
    });
    it('text being edited: from the text box', () => {
        const v = fakeViewer();
        v.editor.value = 'new text';
        assert.equal(editedText(v), 'new text');
    });
});
