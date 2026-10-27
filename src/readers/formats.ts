// Formats: recognised from the file name or chosen by the user; reader and language of each

// ===========================================================================
// IMPORTS
// ===========================================================================

import { LANG_NAMES } from '../text/lang.ts';
import { langOf } from '../text/lang.ts';
import { PARQUET_RE } from './parquet/meta.ts';
import { PBIX_RE } from './pbix.ts';
import { SHEET_RE } from './sheets/cells.ts';
import { ZIP_RE } from './zip.ts';

// ===========================================================================
// TYPES
// ===========================================================================

export type Reader = 'text' | 'parquet' | 'sheet' | 'ifczip' | 'pbix';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Formats with a reader of their own (binary files); all others are text, coloured by language
const FILE_FORMATS: Record<string, string> = {
    parquet: 'Parquet',
    sheet: 'Spreadsheet',
    ifczip: 'IFCZIP',
    pbix: 'Power BI',
};

// Lists of the format picker: text formats (plain text first, then by name), file formats
export const FORMAT_LISTS: [string, string[]][] = [
    ['Text', ['text', ...Object.keys(LANG_NAMES).sort((a, b) => LANG_NAMES[a].localeCompare(LANG_NAMES[b]))]],
    ['Files', Object.keys(FILE_FORMATS)],
];

// ===========================================================================
// METHODS
// ===========================================================================

// Format recognised from a file name ('text': plain text)
export function formatOf(name: string): string {
    if (PARQUET_RE.test(name)) return 'parquet';
    if (SHEET_RE.test(name)) return 'sheet';
    if (ZIP_RE.test(name)) return 'ifczip';
    if (PBIX_RE.test(name)) return 'pbix';
    return langOf(name) || 'text';
}

export const readerOf = (format: string): Reader => (format in FILE_FORMATS ? format : 'text') as Reader;

// Language of a format, as in Viewer.lang (null: plain text)
export function langOfFormat(format: string): string | null {
    if (format === 'ifczip') return 'ifc';
    if (format === 'pbix') return 'md'; // shown as Markdown
    return format === 'text' ? null : format;
}

export const formatName = (format: string): string => FILE_FORMATS[format] || LANG_NAMES[format] || 'Text';
