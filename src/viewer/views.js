// Views: text, table, sheet choice and colours

// ===========================================================================
// IMPORTS
// ===========================================================================

import { colourPrefs } from '../_core/prefs.js';
import { view } from '../_core/prefs.js';
import { esc } from '../_core/util.js';
import { showCached } from './status.js';

/** @typedef {import('../_core/types.js').Source} Source */
/** @typedef {import('../_core/types.js').Viewer} Viewer */
/** @typedef {import('../_core/types.js').Sheet} Sheet */

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {Viewer} v @returns {boolean} */
export const tableView = (v) => ['csv', 'parquet', 'sheet'].includes(v.lang) && view.table;

// Colour choice of view shown: text, table (CSV / Parquet) or sheet (spreadsheets: own choice)
/** @param {Viewer} v @returns {'text'|'table'|'sheet'} */
export const colourKey = (v) => (!tableView(v) ? 'text' : v.lang === 'sheet' ? 'sheet' : 'table');

// View switch state (pressed = current view) and idle cache bar
/** @param {Viewer} v @returns {void} */
export function updateViews(v) {
    const table = !v.view3d && tableView(v);
    const shown = !!v.source && !v.source.deferred; // content on screen
    v.textBtn.disabled = !shown;
    v.textBtn.setAttribute('aria-pressed', String(shown && !v.view3d && !table));
    v.tableBtn.setAttribute('aria-pressed', String(table && !v.tableBtn.disabled));
    v.view3dBtn.setAttribute('aria-pressed', String(!!v.view3d));
    if (!v.busy) showCached(v);
}

// Colours on in view now shown
/** @param {Viewer} v @returns {boolean} */
export function colourOn(v) {
    return colourPrefs[colourKey(v)];
}

// Sheet choice (spreadsheets only): drop-down next to table button, sheet name in title
/** @param {Viewer} v @param {Source|null} src @returns {void} */
export function showSheets(v, src) {
    /** @type {Sheet[]|null} */
    const sheets = src?.isSheet ? src.sheets : null;
    v.sheetSelect.hidden = !sheets;
    v.titleSheet.hidden = !sheets;
    if (!sheets || !src) return;
    const s = sheets[src.current];
    v.sheetSelect.innerHTML = sheets
        .map((x, i) => {
            const notes = [x.hidden && 'hidden', x.kind !== 'sheet' && x.kind].filter(Boolean).join(', ');
            const suffix = notes ? ` (${notes})` : '';
            return `<option value="${i}">${x.data === undefined ? '○' : '●'} ${esc(x.name)}${suffix}</option>`;
        })
        .join('');
    v.sheetSelect.value = String(src.current);
    v.sheetSelect.title = `Sheet ${src.current + 1} of ${sheets.length} (● cached, ○ not cached yet)`;
    v.titleSheet.innerHTML = ` · <strong>Sheet:</strong> ${esc(s.name)}`;
}
