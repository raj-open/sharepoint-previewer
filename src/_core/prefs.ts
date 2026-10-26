// Preferences kept in the browser (localStorage): theme, colours, wrap, CSV format, view choices (some per file)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { SEPARATOR_NAMES } from '../text/highlight/csv.ts';
import { QUOTE_MODES } from '../view/table.ts';
import { DEFAULT_COLOURS } from './settings.ts';
import { DEFAULT_LOG_COLOURS } from './settings.ts';
import { DEFAULT_MODE } from './settings.ts';
import { DEFAULT_SHEET_COLOURS } from './settings.ts';
import { DEFAULT_SHEET_VIEW } from './settings.ts';
import { DEFAULT_TABLE_COLOURS } from './settings.ts';
import { DEFAULT_WRAP } from './settings.ts';
import { THEME } from './settings.ts';

import type { Layout } from './types.ts';
import type { SheetMode } from './types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const THEME_KEY = 'tp-preview-theme';
const COLOUR_KEY = 'tp-preview-colours-text';
export const WRAP_KEY = 'tp-preview-wrap';
export const ZOOM_KEY = 'tp-preview-zoom'; // text size in the content area (1 = 100 %)
export const ZOOM_RANGE = [0.5, 3];
export const PROPS_KEY = 'tp-preview-properties'; // properties line shown (default) or hidden
export const CSV_SEP_KEY = 'tp-preview-csv-sep'; // '' = as in file
export const CSV_QUOTE_KEY = 'tp-preview-csv-quote'; // '' = as in file

const COLOUR_TABLE_KEY = 'tp-preview-colours-table';
const COLOUR_SHEET_KEY = 'tp-preview-colours-sheet';
const COLOUR_LOG_KEY = 'tp-preview-colours-log';
export const COLOUR_KEYS = { text: COLOUR_KEY, table: COLOUR_TABLE_KEY, sheet: COLOUR_SHEET_KEY, log: COLOUR_LOG_KEY };

// Spreadsheets: sheets or tables, per file (most recent first, the oldest dropped)
export const SHEET_MODES_KEY = 'tp-preview-sheet-modes';
const MAX_SHEET_MODES = 500;

// ===========================================================================
// METHODS
// ===========================================================================

// Settings remembered in browser (localStorage): light / dark, colours, line wrap
export function loadPref<T extends string | null>(key: string, fallback: T): string | T {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

export function removePref(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {}
}

export function savePref(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {}
}

// Sheets or tables chosen for a spreadsheet (file path -> mode)
function sheetModes(): Record<string, SheetMode> {
    try {
        const modes = JSON.parse(loadPref(SHEET_MODES_KEY, '{}'));
        return modes && typeof modes === 'object' && !Array.isArray(modes) ? modes : {};
    } catch {
        return {};
    }
}

// View of a spreadsheet: last choice for this file, else the setting
export function sheetMode(url: string): SheetMode {
    const mode = sheetModes()[url] ?? DEFAULT_SHEET_VIEW;
    return mode === 'tables' ? 'tables' : 'sheets';
}

export function rememberSheetMode(url: string, mode: SheetMode): void {
    const modes = sheetModes();
    delete modes[url];
    const kept = Object.entries(modes).slice(0, MAX_SHEET_MODES - 1);
    savePref(SHEET_MODES_KEY, JSON.stringify(Object.fromEntries([[url, mode], ...kept])));
}

// Delimiter / quote style chosen in write mode ('' = keep file's own)
export const csvFormat = { sep: loadPref(CSV_SEP_KEY, '') || '', quote: loadPref(CSV_QUOTE_KEY, '') || '' };
if (!(csvFormat.sep in SEPARATOR_NAMES)) csvFormat.sep = '';
if (csvFormat.quote && !QUOTE_MODES[csvFormat.quote]) csvFormat.quote = '';

export const colourPrefs = {
    text: loadPref(COLOUR_KEY, DEFAULT_COLOURS ? '1' : '0') === '1',
    table: loadPref(COLOUR_TABLE_KEY, DEFAULT_TABLE_COLOURS ? '1' : '0') === '1',
    sheet: loadPref(COLOUR_SHEET_KEY, DEFAULT_SHEET_COLOURS ? '1' : '0') === '1',
    log: loadPref(COLOUR_LOG_KEY, DEFAULT_LOG_COLOURS ? '1' : '0') === '1',
};

// Remembered view choices (localStorage); settings give the start values
export const view = {
    // View choices: settings are start values, last choice is remembered (localStorage)
    table: loadPref('tp-preview-table', '1') === '1',
    logTable: loadPref('tp-preview-log-table', '0') === '1', // logs: text first (table experimental)
    // Lines of metadata shown (drag grip below it)
    metaLines: Math.max(1, Math.min(6, Number(loadPref('tp-preview-meta-lines', '1')) || 1)),
    props: loadPref('tp-preview-properties', '0') === '1',
    // Layout: popup / vertical / horizontal
    mode: (['popup', 'vertical', 'horizontal'].includes(loadPref('tp-preview-mode', ''))
        ? loadPref('tp-preview-mode', '')
        : DEFAULT_MODE) as Layout,
    theme: ['light', 'dark'].includes(loadPref(THEME_KEY, '')) ? loadPref(THEME_KEY, '') : THEME,
    wrap: loadPref(WRAP_KEY, DEFAULT_WRAP ? '1' : '0') === '1',
    // 3D view chosen by user
    show3d: loadPref('tp-preview-3d', '0') === '1',
    // Markdown rendered (else its text)
    markdown: loadPref('tp-preview-markdown', '1') === '1',
    // Text size in the content area (text, table, Markdown, editor)
    zoom: Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], Number(loadPref(ZOOM_KEY, '1')) || 1)),
};
