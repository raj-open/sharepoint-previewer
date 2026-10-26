// Write mode: which files, pending changes
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fakeViewer } from '../helpers.ts';
import { load } from '../helpers.ts';

const { canWrite, markEdited, discardEdits, editedText, cancelEdits } = await load('viewer/edit.ts');

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
    it('cancel: nothing pending ends write mode without asking', () => {
        const v = fakeViewer({ writeMode: true, source: { text: 'a' } });
        globalThis.confirm = () => assert.fail('asked');
        assert.equal(cancelEdits(v), true);
        assert.equal(v.writeMode, false);
    });
    it('cancel: pending changes kept when the user says no', () => {
        const v = fakeViewer({ writeMode: true, dirty: true, source: { text: 'a' } });
        globalThis.confirm = () => false;
        assert.equal(cancelEdits(v), false);
        assert.equal(v.writeMode, true);
        assert.equal(v.dirty, true);
    });
    it('text being edited: from the text box', () => {
        const v = fakeViewer();
        v.editor.value = 'new text';
        assert.equal(editedText(v), 'new text');
    });
});
