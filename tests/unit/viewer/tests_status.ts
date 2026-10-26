// Cache progress (status bar): bar, text, state classes
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fakeViewer } from '../helpers.ts';
import { load } from '../helpers.ts';

const { showProgress, showCached, setBusy, showStatus } = await load('viewer/status.ts');

describe('viewer/status', () => {
    it('progress while caching: share and sizes', () => {
        const v = fakeViewer();
        showProgress(v, 512, 2048);
        assert.equal(v.progressFill.style.width, '25.0%');
        assert.equal(v.progressText.textContent, '25% (512 B of 2.0 KB)');
    });
    it('unknown size: bytes only, no bar', () => {
        const v = fakeViewer();
        showProgress(v, 100, 0);
        assert.equal(v.progressBar.style.display, 'none');
        assert.equal(v.progressText.textContent, 'Caching … 100 B');
    });
    it('idle without file: greyed', () => {
        const v = fakeViewer();
        setBusy(v, false);
        assert.equal(v.progressText.textContent, 'nothing cached');
        assert.ok(v.progress.classList.contains('tp-off'));
    });
    it('fully cached file', () => {
        const v = fakeViewer({ source: { total: 2048, loaded: 2048, done: true } });
        showCached(v);
        assert.equal(v.progressText.textContent, 'fully cached (2.0 KB)');
        assert.ok(v.progress.classList.contains('tp-full'));
    });
    it('partly cached: hint to cache the rest', () => {
        const v = fakeViewer({ source: { total: 2048, loaded: 1024, done: false } });
        showCached(v);
        assert.match(v.progressText.textContent, /^50% .* cached · Click .* to fully cache file$/);
        assert.ok(v.progress.classList.contains('tp-idle'));
    });
    it('note (upload): text instead of the bar, until the cache state is shown again', () => {
        const v = fakeViewer({ source: { total: 10, loaded: 10, done: true, text: '' } });
        showStatus(v, 'Uploading …');
        assert.equal(v.progressText.textContent, 'Uploading …');
        assert.equal(v.progressBar.style.display, 'none');
        showCached(v);
        assert.match(v.progressText.textContent, /fully cached/);
    });
});
