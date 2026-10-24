// Previewed files in memory: least recently viewed go first; asks before clearing others
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.mjs';

const { memoryCache, keepInMemory, makeRoom, clearAllCached, clearedUrls } = await load('viewer/cache.js');
const { MEMORY_CACHE_BYTES } = await load('_core/settings.js');
const entry = (loaded) => ({ src: { loaded }, fileName: 'f', hops: [] });

describe('viewer/cache', () => {
    it('over the limit: oldest dropped, newest kept', () => {
        memoryCache.clear();
        keepInMemory('/a', entry(MEMORY_CACHE_BYTES / 2));
        keepInMemory('/b', entry(MEMORY_CACHE_BYTES / 2));
        keepInMemory('/c', entry(MEMORY_CACHE_BYTES / 2));
        assert.deepEqual([...memoryCache.keys()], ['/b', '/c']);
    });
    it('room: yes while under the limit; else asks, then clears the others', () => {
        memoryCache.clear();
        keepInMemory('/a', entry(MEMORY_CACHE_BYTES - 10));
        assert.equal(makeRoom({ file: { url: '/b' } }, 5), true);
        const asked = [];
        globalThis.confirm = (q) => asked.push(q) > 0;
        assert.equal(makeRoom({ file: { url: '/b' } }, 100), true);
        assert.match(asked[0], /The cache is full/);
        assert.equal(memoryCache.size, 0);
        assert.ok(clearedUrls.has('/a'));
    });
    it('file alone bigger than the limit: refused', () => {
        globalThis.alert = (m) => assert.match(m, /bigger than the cache limit/);
        assert.equal(makeRoom({ file: { url: '/x' } }, MEMORY_CACHE_BYTES + 1), false);
    });
    it('clear all', () => {
        keepInMemory('/a', entry(1));
        clearAllCached();
        assert.equal(memoryCache.size, 0);
    });
});
