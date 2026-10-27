// Cache of opened files: memory limits, clearing, cancelled loads

// ===========================================================================
// IMPORTS
// ===========================================================================

import { refreshEyes } from '../_core/list.ts';
import { MEMORY_CACHE_BYTES } from '../_core/settings.ts';
import { formatBytes } from '../_core/util.ts';
import { confirmDiscard } from './edit.ts';
import { exitWriteView } from './edit.ts';
import { showPlain } from './messages.ts';
import { forcedUrls } from './open.ts';
import { viewer } from './open.ts';
import { setBusy } from './status.ts';
import { close3d } from './view3d.ts';
import { showSheets } from './views.ts';

import type { Source } from '../_core/types.ts';
import type { Viewer } from '../_core/types.ts';

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

/** @returns bytes */
const keptSize = (entry: { src: Source }): number => entry.src.loaded || 0; // bytes of the file cached

// Room for `need` more bytes in the cache; else asks to clear the other files first
export function makeRoom(v: Viewer, need: number): boolean {
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

export function trimMemory(): void {
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

export function keepInMemory(
    url: string,
    entry: { src: Source; fileName: string; hops: string[]; reader: string },
): void {
    memoryCache.delete(url);
    memoryCache.set(url, entry);
    trimMemory();
}

// Clear every file this previewer cached (its own memory only; nothing else is touched)
export function clearAllCached(): void {
    if (viewer?.file && memoryCache.has(viewer.file.url)) {
        clearCached(viewer);
        if (memoryCache.has(viewer.file.url)) return; // kept: pending, user stayed
    }
    for (const url of memoryCache.keys()) clearedUrls.add(url);
    memoryCache.clear();
    refreshEyes();
}

export function clearCached(v: Viewer): void {
    const file = v.file;
    if (!file) return;
    close3d(v);
    forcedUrls.delete(file.url); // asks again next time
    cancelLoad(v, true);
    setBusy(v, false);
    clearedUrls.add(file.url);
    memoryCache.delete(file.url);
    refreshEyes();
    if (!confirmDiscard(v)) return;
    if (v.writeMode) exitWriteView(v);
    v.loadToken++; // anything still on its way is ignored
    v.source = null;
    v.writeBtn.disabled = true;
    v.rerender = null;
    v.goToLine = null;
    v.relint = null;
    v.text = '';
    v.copyBtn.disabled = true;
    v.loadAllBtn.disabled = true;
    v.clearBtn.disabled = true;
    v.lint.style.display = 'none';
    showSheets(v, null);
    showPlain(v, 'Cache cleared for this file. Use refresh, or open the file again, to cache it anew.');
}

// Cancel the fetch; a running "cache all" goes on in the background (unless `stop`)
export function cancelLoad(v: Viewer, stop = false): void {
    if (stop || !(v.source?.fullJob || v.opening)) v.abort?.abort();
    v.opening = false;
    v.abort = null;
    v.lintWorker?.terminate(); // cancels check in progress
    v.lintWorker = null;
}
