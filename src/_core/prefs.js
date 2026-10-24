// Preferences kept in the browser (localStorage): theme, colours, wrap, CSV format, view choices

// ===========================================================================
// IMPORTS
// ===========================================================================

import { SEPARATOR_NAMES } from '../text/highlight/csv.js';
import { QUOTE_MODES } from '../view/table.js';
import { DEFAULT_COLOURS } from './settings.js';
import { DEFAULT_MODE } from './settings.js';
import { DEFAULT_SHEET_COLOURS } from './settings.js';
import { DEFAULT_TABLE_COLOURS } from './settings.js';
import { DEFAULT_WRAP } from './settings.js';
import { THEME } from './settings.js';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const THEME_KEY = 'tp-preview-theme';
const COLOUR_KEY = 'tp-preview-colours-text';
export const WRAP_KEY = 'tp-preview-wrap';
export const PROPS_KEY = 'tp-preview-properties'; // properties line shown (default) or hidden
export const CSV_SEP_KEY = 'tp-preview-csv-sep'; // '' = as in file
export const CSV_QUOTE_KEY = 'tp-preview-csv-quote'; // '' = as in file

const COLOUR_TABLE_KEY = 'tp-preview-colours-table';
const COLOUR_SHEET_KEY = 'tp-preview-colours-sheet';
export const COLOUR_KEYS = { text: COLOUR_KEY, table: COLOUR_TABLE_KEY, sheet: COLOUR_SHEET_KEY };

// ===========================================================================
// METHODS
// ===========================================================================

// Settings remembered in browser (localStorage): light / dark, colours, line wrap
/** @template {string|null} T @param {string} key @param {T} fallback @returns {string|T} */
export function loadPref(key, fallback) {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

/** @param {string} key @returns {void} */
export function removePref(key) {
    try {
        localStorage.removeItem(key);
    } catch {}
}

/** @param {string} key @param {string} value @returns {void} */
export function savePref(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {}
}

// Delimiter / quote style chosen in write mode ('' = keep file's own)
export const csvFormat = { sep: loadPref(CSV_SEP_KEY, '') || '', quote: loadPref(CSV_QUOTE_KEY, '') || '' };
if (!(csvFormat.sep in SEPARATOR_NAMES)) csvFormat.sep = '';
if (csvFormat.quote && !QUOTE_MODES[csvFormat.quote]) csvFormat.quote = '';

export const colourPrefs = {
    text: loadPref(COLOUR_KEY, DEFAULT_COLOURS ? '1' : '0') === '1',
    table: loadPref(COLOUR_TABLE_KEY, DEFAULT_TABLE_COLOURS ? '1' : '0') === '1',
    sheet: loadPref(COLOUR_SHEET_KEY, DEFAULT_SHEET_COLOURS ? '1' : '0') === '1',
};

// Remembered view choices (localStorage); settings give the start values
export const view = {
    // View choices: settings are start values, last choice is remembered (localStorage)
    table: loadPref('tp-preview-table', '1') === '1',
    // Lines of metadata shown (drag grip below it)
    metaLines: Math.max(1, Math.min(6, Number(loadPref('tp-preview-meta-lines', '1')) || 1)),
    props: loadPref('tp-preview-properties', '1') === '1',
    // Layout: popup / vertical / horizontal
    mode: ['popup', 'vertical', 'horizontal'].includes(loadPref('tp-preview-mode', ''))
        ? loadPref('tp-preview-mode', '')
        : DEFAULT_MODE,
    theme: ['light', 'dark'].includes(loadPref(THEME_KEY, '')) ? loadPref(THEME_KEY, '') : THEME,
    wrap: loadPref(WRAP_KEY, DEFAULT_WRAP ? '1' : '0') === '1',
    // 3D view chosen by user
    show3d: loadPref('tp-preview-3d', '0') === '1',
};
