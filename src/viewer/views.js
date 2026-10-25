// Views: text, table, sheet choice and colours

// ===========================================================================
// IMPORTS
// ===========================================================================

import { colourPrefs } from '../_core/prefs.js';
import { view } from '../_core/prefs.js';
import { esc } from '../_core/util.js';
import { CUBE_SVG } from '../ui/icons.js';
import { EYE_FULL_SVG } from '../ui/icons.js';
import { MARKDOWN_SVG } from '../ui/icons.js';
import { TABLE_SVG } from '../ui/icons.js';
import { showCached } from './status.js';

/** @typedef {import('../_core/types.js').Source} Source */
/** @typedef {import('../_core/types.js').Viewer} Viewer */
/** @typedef {import('../_core/types.js').Sheet} Sheet */
/** @typedef {import('../_core/types.js').Table} Table */
/** @typedef {import('../_core/types.js').PickerList} PickerList */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Preview (view switch, right of Text): one per file type; its look follows the file shown
/** @type {Object<PreviewKind, { svg: string, label: string, title: string }>} */
export const PREVIEWS = {
    table: { svg: TABLE_SVG, label: 'Table', title: 'Table view (CSV, Parquet, spreadsheets)' },
    '3d': { svg: CUBE_SVG, label: '3D', title: '3D view (IFC, IFCZIP)' },
    md: { svg: MARKDOWN_SVG, label: 'Markdown', title: 'Markdown view' },
};
const LOG_TABLE_TITLE = 'Table view (experimental: fields guessed from the lines of the log)';

// ===========================================================================
// METHODS
// ===========================================================================

/** @typedef {'table'|'3d'|'md'} PreviewKind */

// Preview of a language (as in Viewer.lang); null: text only
/** @param {string|null|undefined} lang @returns {PreviewKind|null} */
export function previewOf(lang) {
    if (lang === 'csv' || lang === 'parquet' || lang === 'sheet' || lang === 'log') return 'table';
    if (lang === 'ifc') return '3d';
    if (lang === 'md') return 'md';
    return null;
}

// Logs: own choice, read only, only while fields were found (preview enabled)
/** @param {Viewer} v @returns {boolean} */
export const tableView = (v) =>
    v.lang === 'log'
        ? view.logTable && !v.writeMode && !v.previewBtn.disabled
        : previewOf(v.lang) === 'table' && view.table;

// View choice (prefs key in `view`) behind the Preview of a file type
/** @param {Viewer} v @param {'table'|'markdown'} key @returns {'table'|'logTable'|'markdown'} */
export const viewKey = (v, key) => (key === 'table' && v.lang === 'log' ? 'logTable' : key);

// Markdown shown rendered (not while edited: the editor shows its text)
/** @param {Viewer} v @returns {boolean} */
export const markdownView = (v) => v.lang === 'md' && view.markdown && !v.writeMode;

// Preview button for a file type: icon, label, tooltip; `reason` (or no preview): disabled
/** @param {Viewer} v @param {PreviewKind|null} kind @param {string} [reason] @returns {void} */
export function setPreview(v, kind, reason = '') {
    const p = kind ? PREVIEWS[kind] : null;
    const label = p ? p.label : 'Preview';
    v.previewBtn.innerHTML = `${p ? p.svg : EYE_FULL_SVG}<span>${label}</span>`;
    v.previewBtn.disabled = !p || !!reason;
    const title = kind === 'table' && v.lang === 'log' ? LOG_TABLE_TITLE : p?.title;
    v.previewBtn.title = reason || title || 'No preview for this file type';
}

// Colour choice of view shown: text, table (CSV / Parquet) or sheet (spreadsheets: own choice)
/** @param {Viewer} v @returns {'text'|'table'|'sheet'} */
export const colourKey = (v) => (!tableView(v) ? 'text' : v.lang === 'sheet' ? 'sheet' : 'table');

// View switch state (pressed = current view: Text or Preview) and idle cache bar
/** @param {Viewer} v @returns {void} */
export function updateViews(v) {
    const preview = !!v.view3d || tableView(v) || markdownView(v);
    const shown = !!v.source && !v.source.deferred; // content on screen
    v.textBtn.disabled = !shown;
    v.textBtn.setAttribute('aria-pressed', String(shown && !preview));
    v.previewBtn.setAttribute('aria-pressed', String(preview && !v.previewBtn.disabled));
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
