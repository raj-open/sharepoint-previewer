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
/** @typedef {import('../_core/types.js').Table} Table */
/** @typedef {import('../_core/types.js').PickerList} PickerList */

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

// Sheet or table choice (spreadsheets only): picker next to table button, name in title.
// Its menu lists sheets and tables side by side (● cached, ○ not cached yet).
/** @param {Viewer} v @param {Source|null} src @returns {void} */
export function showSheets(v, src) {
    const lists = src?.isSheet ? sheetLists(src) : null;
    v.sheetPicker.button.hidden = !lists;
    v.titleSheet.hidden = !lists;
    if (!lists || !src) return v.sheetPicker.close();
    const tables = src.mode === 'tables';
    const list = lists[tables ? 1 : 0];
    const name = tables ? src.tables[src.current].name : src.sheets[src.current].name;
    const kind = tables ? 'Table' : 'Sheet';
    const counts = `${src.sheets.length} sheets, ${src.tables.length} tables`;
    const title = `${kind} ${src.current + 1} of ${list.items.length} (${counts}; ← → in the menu: sheets or tables)`;
    v.sheetPicker.set(lists, { list: tables ? 1 : 0, item: src.current }, name, title);
    v.titleSheet.innerHTML = ` · <strong>${kind}:</strong> ${esc(name)}`;
}

// Lists of the picker: sheets (hidden and chart sheets marked), tables (with their sheet)
/** @param {Source} src @returns {PickerList[]} */
export function sheetLists(src) {
    /** @type {Sheet[]} */
    const sheets = src.sheets;
    /** @type {Table[]} */
    const tables = src.tables;
    /** @param {Sheet} s */
    const mark = (s) => (s.data === undefined ? '○' : '●');
    return [
        {
            label: 'Sheets',
            items: sheets.map((s) => {
                const notes = [s.hidden && 'hidden', s.kind !== 'sheet' && s.kind].filter(Boolean).join(', ');
                const suffix = notes ? ` (${notes})` : '';
                return { text: `${mark(s)} ${s.name}${suffix}` };
            }),
            empty: 'No sheets',
            start: src.startOf('sheets'),
        },
        {
            label: 'Tables',
            items: tables.map((t) => ({ text: `${mark(sheets[t.sheet])} ${t.name} (${sheets[t.sheet].name})` })),
            empty: src.tablesRead ? 'No tables in this file' : 'Tables are not read from this format',
            start: src.startOf('tables'),
        },
    ];
}
