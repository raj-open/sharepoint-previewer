// Status: busy state, progress, cache bar

// ===========================================================================
// IMPORTS
// ===========================================================================

import { formatBytes } from '../_core/util.ts';
import { LOAD_ALL_SVG } from '../ui/icons.ts';

import type { Viewer } from '../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

// Busy (cache in progress): drives stop button
export function setBusy(v: Viewer, on: boolean): void {
    v.busy = on;
    v.stopBtn.disabled = !on && !v.writeMode;
    if (!on) showCached(v);
}

// Cache progress (bottom left): bar and "42% (1.2 MB of 2.9 MB)
// Idle: how much of the open file is cached; greyed without file
export function showCached(v: Viewer): void {
    const src = v.source;
    if (!src) {
        showProgress(v, 0, 1);
        v.progressText.textContent = 'nothing cached';
        v.progress.classList.add('tp-off');
        return;
    }
    const total = src.total || (src.done ? src.loaded : 0);
    // all bytes here (Parquet: also when not all rows are shown yet)
    const full = src.done || (total > 0 && src.loaded >= total);
    showProgress(v, full ? total : src.loaded, total);
    v.progressText.textContent = full ? `fully cached (${formatBytes(total)})` : `${v.progressText.textContent} cached`;
    // calm colour when nothing runs: blue only while caching
    v.progress.classList.toggle('tp-full', full); // only when truly complete (% is floored)
    v.progress.classList.toggle('tp-idle', !full);
    if (!full && !v.loadAllBtn.disabled) {
        const icon = LOAD_ALL_SVG.replace(/\s+/g, ' ').trim();
        v.progressText.insertAdjacentHTML(
            'beforeend',
            ` · Click <span class="tp-inline-icon tp-click" title="Cache the whole file">${icon}</span> to fully cache file`,
        );
        (v.progressText.querySelector('.tp-click') as HTMLElement).onclick = () => v.loadAllBtn.click(); // written above
    }
}

// Note in place of the cache state (e.g. upload under way); showCached() brings the cache state back
export function showStatus(v: Viewer, text: string): void {
    v.progress.classList.remove('tp-off', 'tp-full', 'tp-idle');
    v.progressBar.style.display = 'none';
    v.progressText.textContent = text;
}

export function showProgress(v: Viewer, loaded: number, total: number): void {
    const share = total ? Math.min(1, loaded / total) : 0;
    v.progress.classList.remove('tp-off', 'tp-full', 'tp-idle');
    v.progressFill.style.width = `${(share * 100).toFixed(1)}%`;
    v.progressBar.style.display = total ? '' : 'none';
    v.progressText.textContent = total
        ? `${Math.floor(share * 100)}% (${formatBytes(loaded)} of ${formatBytes(total)})`
        : `Caching … ${formatBytes(loaded)}`;
}
