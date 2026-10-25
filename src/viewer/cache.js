// Cache of opened files: memory limits, clearing, cancelled loads

// ===========================================================================
// IMPORTS
// ===========================================================================

import { refreshEyes } from '../_core/list.js';
import { MEMORY_CACHE_BYTES } from '../_core/settings.js';
import { formatBytes } from '../_core/util.js';
import { confirmDiscard } from './edit.js';
import { exitWriteView } from './edit.js';
import { showPlain } from './messages.js';
import { forcedUrls } from './open.js';
import { viewer } from './open.js';
import { setBusy } from './status.js';
import { close3d } from './view3d.js';
import { showSheets } from './views.js';

/** @typedef {import('../_core/types.js').Source} Source */
/** @typedef {import('../_core/types.js').Viewer} Viewer */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Previewed files in memory up to MEMORY_CACHE_BYTES (least recently viewed go first)
export const memoryCache = new Map(); // url -> { src, fileName, hops, reader }

// Cleared files: next fetch skips (and replaces) browser's stored copy
export const clearedUrls = new Set();

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {{ src: Source }} entry @returns {number} bytes */
const keptSize = (entry) => entry.src.loaded || 0; // bytes of the file cached

// Room for `need` more bytes in the cache; else asks to clear the other files first
/** @param {Viewer} v @param {number} need @returns {boolean} */
export function makeRoom(v, need) {
    let used = 0;
    for (const entry of memoryCache.values()) used += keptSize(entry);
    if (used + need <= MEMORY_CACHE_BYTES) return true;
    const own = memoryCache.get(v.file?.url);
    const mine = own ? keptSize(own) : 0;
    if (mine + need > MEMORY_CACHE_BYTES) {
        alert(
            `This file is bigger than the cache limit (${formatBytes(MEMORY_CACHE_BYTES)}). Raise it in the settings to cache more.`,
        );
        return false;
    }
    if (
        !confirm(
            `The cache is full (${formatBytes(used)} of ${formatBytes(MEMORY_CACHE_BYTES)}). Clear the other cached files first, then go on?`,
        )
    )
        return false;
    for (const url of [...memoryCache.keys()]) {
        if (url === v.file?.url || memoryCache.get(url).src.fullJob) continue;
        clearedUrls.add(url);
        memoryCache.delete(url);
    }
    refreshEyes();
    return true;
}

/** @returns {void} */
export function trimMemory() {
    let total = 0;
    for (const entry of memoryCache.values()) total += keptSize(entry);
    for (const [url, entry] of memoryCache) {
        if (total <= MEMORY_CACHE_BYTES || memoryCache.size <= 1) break;
        if (entry.src.fullJob) continue; // still caching in the background
        total -= keptSize(entry);
        memoryCache.delete(url);
    }
    refreshEyes();
}

/** @param {string} url @param {{ src: Source, fileName: string, hops: string[], reader: string }} entry @returns {void} */
export function keepInMemory(url, entry) {
    memoryCache.delete(url);
    memoryCache.set(url, entry);
    trimMemory();
}

// Clear every file this previewer cached (its own memory only; nothing else is touched)
/** @returns {void} */
export function clearAllCached() {
    if (viewer?.file && memoryCache.has(viewer.file.url)) {
        clearCached(viewer);
        if (memoryCache.has(viewer.file.url)) return; // kept: pending, user stayed
    }
    for (const url of memoryCache.keys()) clearedUrls.add(url);
    memoryCache.clear();
    refreshEyes();
}

/** @param {Viewer} v @returns {void} */
export function clearCached(v) {
    close3d(v);
    if (v.file) forcedUrls.delete(v.file.url); // asks again next time
    cancelLoad(v, true);
    setBusy(v, false);
    clearedUrls.add(v.file.url);
    memoryCache.delete(v.file.url);
    refreshEyes();
    if (!confirmDiscard(v)) return;
    if (v.writeMode) exitWriteView(v);
    v.loadToken++; // anything still on its way is ignored
    v.source = null;
    v.writeBtn.disabled = true;
    v.rerender = null;
    v.relint = null;
    v.text = '';
    v.copyBtn.disabled = true;
    v.loadAllBtn.disabled = true;
    v.clearBtn.disabled = true;
    v.lint.style.display = 'none';
    showSheets(v, null);
    showPlain(v, 'Cache cleared for this file. Use refresh, or open the file again, to cache it anew.');
}

/** @param {Viewer} v @returns {void} */
// Cancel the fetch; a running "cache all" goes on in the background (unless `stop`)
/** @param {Viewer} v @param {boolean} [stop] @returns {void} */
export function cancelLoad(v, stop = false) {
    if (stop || !(v.source?.fullJob || v.opening)) v.abort?.abort();
    v.opening = false;
    v.abort = null;
    v.lintWorker?.terminate(); // cancels check in progress
    v.lintWorker = null;
}
