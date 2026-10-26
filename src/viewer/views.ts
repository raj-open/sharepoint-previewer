// Views: text, table, sheet choice and colours

// ===========================================================================
// IMPORTS
// ===========================================================================

import { colourPrefs } from '../_core/prefs.ts';
import { view } from '../_core/prefs.ts';
import { esc } from '../_core/util.ts';
import { FORMAT_LISTS } from '../readers/formats.ts';
import { formatName } from '../readers/formats.ts';
import { CUBE_SVG } from '../ui/icons.ts';
import { EYE_FULL_SVG } from '../ui/icons.ts';
import { MARKDOWN_SVG } from '../ui/icons.ts';
import { TABLE_SVG } from '../ui/icons.ts';
import { showCached } from './status.ts';

import type { Source } from '../_core/types.ts';
import type { Viewer } from '../_core/types.ts';
import type { Sheet } from '../_core/types.ts';
import type { SheetSource } from '../_core/types.ts';
import type { PickerList } from '../_core/types.ts';

// ===========================================================================
// TYPES
// ===========================================================================

export type PreviewKind = 'table' | '3d' | 'md';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Preview (view switch, right of Text): one per file type; its look follows the file shown
export const PREVIEWS: Record<PreviewKind, { svg: string; label: string; title: string }> = {
    table: { svg: TABLE_SVG, label: 'Table', title: 'Table view (CSV, Parquet, spreadsheets)' },
    '3d': { svg: CUBE_SVG, label: '3D', title: '3D view (IFC, IFCZIP)' },
    md: { svg: MARKDOWN_SVG, label: 'Markdown', title: 'Markdown view' },
};
const LOG_TABLE_TITLE = 'Table view (experimental: fields guessed from the lines of the log)';

// ===========================================================================
// METHODS
// ===========================================================================

// Preview of a language (as in Viewer.lang); null: text only
export function previewOf(lang: string | null | undefined): PreviewKind | null {
    if (lang === 'csv' || lang === 'parquet' || lang === 'sheet' || lang === 'log') return 'table';
    if (lang === 'ifc') return '3d';
    if (lang === 'md') return 'md';
    return null;
}

// Logs: own choice, read only, only while fields were found (preview enabled)
export const tableView = (v: Viewer): boolean =>
    v.lang === 'log'
        ? view.logTable && !v.writeMode && !v.previewBtn.disabled
        : previewOf(v.lang) === 'table' && view.table;

// View choice (prefs key in `view`) behind the Preview of a file type
export const viewKey = (v: Viewer, key: 'table' | 'markdown'): 'table' | 'logTable' | 'markdown' =>
    key === 'table' && v.lang === 'log' ? 'logTable' : key;

// Markdown shown rendered (not while edited: the editor shows its text)
export const markdownView = (v: Viewer): boolean => v.lang === 'md' && view.markdown && !v.writeMode;

// Preview button for a file type: icon, label, tooltip; `reason` (or no preview): disabled
export function setPreview(v: Viewer, kind: PreviewKind | null, reason = ''): void {
    const p = kind ? PREVIEWS[kind] : null;
    const label = p ? p.label : 'Preview';
    v.previewBtn.innerHTML = `${p ? p.svg : EYE_FULL_SVG}<span>${label}</span>`;
    v.previewBtn.disabled = !p || !!reason;
    const title = kind === 'table' && v.lang === 'log' ? LOG_TABLE_TITLE : p?.title;
    v.previewBtn.title = reason || title || 'No preview for this file type';
}

// Colour choice of view shown: text, table (CSV / Parquet), sheet or log (spreadsheets, logs: own choice)
export function colourKey(v: Viewer): 'text' | 'table' | 'sheet' | 'log' {
    if (!tableView(v)) return 'text';
    return v.lang === 'sheet' || v.lang === 'log' ? v.lang : 'table';
}

// View switch state (pressed = current view: Text or Preview) and idle cache bar
export function updateViews(v: Viewer): void {
    const preview = !!v.view3d || tableView(v) || markdownView(v);
    const shown = !!v.source && !v.source.deferred; // content on screen
    v.textBtn.disabled = !shown;
    v.textBtn.setAttribute('aria-pressed', String(shown && !preview));
    v.previewBtn.setAttribute('aria-pressed', String(preview && !v.previewBtn.disabled));
    if (!v.busy) showCached(v);
}

// Colours on in view now shown
export function colourOn(v: Viewer): boolean {
    return colourPrefs[colourKey(v)];
}

// Format (status bar, left of the text size): recognised from the file name or chosen by the user;
// its menu lists text formats and file formats side by side (null: no file, hidden)
export function showFormat(v: Viewer, format: string | null, recognised: string = format ?? ''): void {
    v.formatPicker.button.hidden = !format;
    if (!format) {
        v.formatPicker.close();
        return;
    }
    const lists = FORMAT_LISTS.map(([label, keys]) => ({
        label,
        items: keys.map((k) => ({ text: k === recognised ? `${formatName(k)} (recognised)` : formatName(k) })),
        empty: '',
        start: Math.max(0, keys.indexOf(recognised)),
    }));
    const list = Math.max(
        0,
        FORMAT_LISTS.findIndex(([, keys]) => keys.includes(format)),
    );
    const item = FORMAT_LISTS[list][1].indexOf(format);
    const chosen = format !== recognised;
    const name = formatName(format);
    const how = chosen ? `chosen; recognised: ${formatName(recognised)}` : 'recognised from the file name';
    v.formatPicker.set(lists, { list, item }, name, `Format: ${name} (${how}). View the file as another format`);
    v.formatPicker.button.classList.toggle('tp-chosen', chosen);
}

// Sheet or table choice (spreadsheets only): picker next to table button, name in title.
// Its menu lists sheets and tables side by side (● cached, ○ not cached yet).
export function showSheets(v: Viewer, src: Source | null): void {
    const lists = src?.isSheet ? sheetLists(src) : null;
    v.sheetPicker.button.hidden = !lists;
    v.titleSheet.hidden = !lists;
    if (!lists || !src?.isSheet) {
        v.sheetPicker.close();
        return;
    }
    const tables = src.mode === 'tables';
    const list = lists[tables ? 1 : 0];
    const kind = tables ? 'Table' : 'Sheet';
    const counts = `${src.sheets.length} sheets, ${src.tables.length} tables`;
    const keys = '← → in the menu: sheets or tables';
    if (src.waiting) {
        // large file: nothing shown until chosen
        v.titleSheet.hidden = true;
        const choice = { list: tables ? 1 : 0, item: -1 };
        v.sheetPicker.set(lists, choice, 'Select sheet or table', `${counts}; ${keys}`);
        return;
    }
    const name = tables ? src.tables[src.current].name : src.sheets[src.current].name;
    const title = `${kind} ${src.current + 1} of ${list.items.length} (${counts}; ${keys})`;
    v.sheetPicker.set(lists, { list: tables ? 1 : 0, item: src.current }, name, title);
    v.titleSheet.innerHTML = ` · <strong>${kind}:</strong> ${esc(name)}`;
}

// Lists of the picker: sheets (hidden and chart sheets marked), tables (with their sheet)
export function sheetLists(src: SheetSource): PickerList[] {
    const { sheets, tables } = src;
    const mark = (s: Sheet) => (s.data === undefined ? '○' : '●');
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
