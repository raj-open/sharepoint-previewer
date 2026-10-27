// 3D view (WebGPU: behavioural tests); closing keeps the camera for next time
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fakeViewer } from '../helpers.ts';
import { load } from '../helpers.ts';

const view3d = await load('viewer/view3d.ts');
const { close3d, ifcLibraryReady, reload3d } = view3d;

describe('viewer/view3d', () => {
    it('library not loaded at start', () => assert.equal(ifcLibraryReady, false));
    it('close without 3D view: nothing happens', () => {
        const v = fakeViewer();
        close3d(v);
        assert.equal(v.stage3d.style.display, undefined);
    });
    it('close: model disposed, text view back', () => {
        let disposed = false;
        const v = fakeViewer({
            file: { url: '/m.ifc' },
            view3d: { handle: { pose: () => ({}), dispose: () => (disposed = true) } },
        });
        close3d(v);
        assert.equal(disposed, true);
        assert.equal(v.view3d, null);
        assert.equal(v.stage3d.style.display, 'none');
        assert.equal(v.content.style.display, '');
    });
    it('reload: library dropped, 3D view closed and opened again (here: no file, stays closed)', async () => {
        let disposed = false;
        const v = fakeViewer({ view3d: { handle: { pose: () => ({}), dispose: () => (disposed = true) } } });
        await reload3d(v);
        assert.equal(disposed, true);
        assert.equal(v.view3d, null);
        assert.equal(view3d.ifcLibraryReady, false);
    });
});
