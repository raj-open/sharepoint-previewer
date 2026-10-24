import { LOAD_ALL_SVG } from '../ui/icons.js';
import { formatBytes } from '../util.js';

/** @typedef {import('../types.js').Viewer} Viewer */

// Busy (cache in progress): drives stop button
/** @param {Viewer} v @param {boolean} on @returns {void} */
export function setBusy(v, on) {
  v.busy = on;
  v.stopBtn.disabled = !on && !v.writeMode;
  if (!on) showCached(v);
}

// Cache progress (bottom left): bar and "42% (1.2 MB of 2.9 MB)
// Idle: how much of the open file is cached; greyed without file
/** @param {Viewer} v @returns {void} */
export function showCached(v) {
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
    v.progressText.querySelector('.tp-click').onclick = () => v.loadAllBtn.click();
  }
}

/** @param {Viewer} v @param {number} loaded @param {number} total @returns {void} */
export function showProgress(v, loaded, total) {
  const share = total ? Math.min(1, loaded / total) : 0;
  v.progress.classList.remove('tp-off', 'tp-full', 'tp-idle');
  v.progressFill.style.width = `${(share * 100).toFixed(1)}%`;
  v.progressBar.style.display = total ? '' : 'none';
  v.progressText.textContent = total
    ? `${Math.floor(share * 100)}% (${formatBytes(loaded)} of ${formatBytes(total)})`
    : `Caching … ${formatBytes(loaded)}`;
}
