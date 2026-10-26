// Formats: recognised from the file name or chosen by the user; reader and language of each

// ===========================================================================
// IMPORTS
// ===========================================================================

import { LANG_NAMES } from '../text/lang.ts';
import { langOf } from '../text/lang.ts';
import { PARQUET_RE } from './parquet/meta.ts';
import { SHEET_RE } from './sheets/cells.ts';
import { ZIP_RE } from './zip.ts';

/** @typedef {'text'|'parquet'|'sheet'|'ifczip'} Reader */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Formats with a reader of their own (binary files); all others are text, coloured by language
/** @type {Object<string, string>} */
const FILE_FORMATS = {
    parquet: 'Parquet',
    sheet: 'Spreadsheet',
    ifczip: 'IFCZIP',
};

// Lists of the format picker: text formats (plain text first, then by name), file formats
/** @type {[string, string[]][]} */
export const FORMAT_LISTS = [
    ['Text', ['text', ...Object.keys(LANG_NAMES).sort((a, b) => LANG_NAMES[a].localeCompare(LANG_NAMES[b]))]],
    ['Files', Object.keys(FILE_FORMATS)],
];

// ===========================================================================
// METHODS
// ===========================================================================

// Format recognised from a file name ('text': plain text)
/** @param {string} name @returns {string} */
export function formatOf(name) {
    if (PARQUET_RE.test(name)) return 'parquet';
    if (SHEET_RE.test(name)) return 'sheet';
    if (ZIP_RE.test(name)) return 'ifczip';
    return langOf(name) || 'text';
}

/** @param {string} format @returns {Reader} */
export const readerOf = (format) => /** @type {Reader} */ (format in FILE_FORMATS ? format : 'text');

// Language of a format, as in Viewer.lang (null: plain text)
/** @param {string} format @returns {string|null} */
export function langOfFormat(format) {
    if (format === 'ifczip') return 'ifc';
    return format === 'text' ? null : format;
}

/** @param {string} format @returns {string} */
export const formatName = (format) => FILE_FORMATS[format] || LANG_NAMES[format] || 'Text';
