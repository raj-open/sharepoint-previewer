// Formats: recognised from the file name or chosen by the user; reader and language of each

// ===========================================================================
// IMPORTS
// ===========================================================================

import { LANG_NAMES } from '../text/lang.ts';
import { langOf } from '../text/lang.ts';
import { CSET_RE } from './cset/index.ts';
import { PARQUET_RE } from './parquet/meta.ts';
import { PBIX_RE } from './pbix/index.ts';
import { SHEET_RE } from './sheets/cells.ts';
import { ZIP_RE } from './zip.ts';

// ===========================================================================
// TYPES
// ===========================================================================

export type Reader = 'text' | 'parquet' | 'sheet' | 'ifczip' | 'pbix' | 'cset';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Formats with a reader of their own (binary files); all others are text, coloured by language
const FILE_FORMATS: Record<string, string> = {
    parquet: 'Parquet',
    sheet: 'Spreadsheet',
    ifczip: 'IFCZIP',
    pbix: 'Power BI',
    cset: 'Solibri ruleset',
};

// Their usual extension (shown with them in the list of text formats)
const FILE_EXTENSIONS: Record<string, string> = {
    parquet: '.parquet',
    sheet: '.xlsx',
    ifczip: '.ifczip',
    pbix: '.pbix',
    cset: '.cset',
};

// Lists of the format picker: all formats (plain text first, then by name; file formats too, with their extension),
// file formats alone; an entry means the same format in either list
export const FORMAT_LISTS: [string, string[]][] = [
    [
        'Text',
        [
            'text',
            ...[...Object.keys(LANG_NAMES), ...Object.keys(FILE_FORMATS)].sort((a, b) =>
                formatName(a).localeCompare(formatName(b)),
            ),
        ],
    ],
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
    if (CSET_RE.test(name)) return 'cset';
    return langOf(name) || 'text';
}

export const readerOf = (format: string): Reader => (format in FILE_FORMATS ? format : 'text') as Reader;

// Language of a format, as in Viewer.lang (null: plain text)
export function langOfFormat(format: string): string | null {
    if (format === 'ifczip') return 'ifc';
    if (format === 'pbix' || format === 'cset') return 'md'; // overview shown as Markdown
    return format === 'text' ? null : format;
}

// Name of a format (function declarations: FORMAT_LISTS above uses them while the module loads)
export function formatName(format: string): string {
    return FILE_FORMATS[format] || LANG_NAMES[format] || 'Text';
}

/** @returns name of a format in the list of all formats: file formats with their extension (`Power BI (.pbix)`) */
export function formatLabel(format: string): string {
    return format in FILE_EXTENSIONS ? `${formatName(format)} (${FILE_EXTENSIONS[format]})` : formatName(format);
}
