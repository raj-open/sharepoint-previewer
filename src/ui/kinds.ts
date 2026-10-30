// Kinds of files (table, code, 3D model, …) by their names, and their icons: a tinted tile with a glyph

// ===========================================================================
// IMPORTS
// ===========================================================================

import { formatOf } from '../readers/formats.ts';

// ===========================================================================
// TYPES
// ===========================================================================

export type Kind =
    | 'folder'
    | 'table'
    | 'data'
    | 'code'
    | 'text'
    | 'log'
    | 'model'
    | 'report'
    | 'image'
    | 'document'
    | 'archive'
    | 'other';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Kinds by extension, before the formats of the viewer (cf. formatOf): those it has no reader for
const EXTENSION_KINDS: [Kind, RegExp][] = [
    ['image', /\.(png|jpe?g|gif|bmp|tiff?|webp|avif|heic|svg|ico)$/i],
    ['document', /\.(pdf|docx?|dotx?|odt|rtf|pptx?|potx?|odp|vsdx?|msg|eml)$/i],
    ['archive', /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|zst)$/i],
    ['code', /\.(ts|tsx|sh|bash|ps1|bat|cmd|c|h|cpp|hpp|cs|java|kt|go|rs|rb|php|r|html?|css|scss|ipynb)$/i],
    ['text', /\.(txt|text|ini|cfg|conf|env)$/i],
];

// Kinds of the viewer's formats (cf. formatOf); formats not listed: text
const FORMAT_KINDS: Record<string, Kind> = {
    sheet: 'table',
    parquet: 'table',
    csv: 'table',
    ifc: 'model',
    ifczip: 'model',
    pbix: 'report',
    json: 'data',
    xml: 'data',
    yaml: 'data',
    toml: 'data',
    js: 'code',
    py: 'code',
    sql: 'code',
    m: 'code',
    xlf: 'code',
    log: 'log',
};

// Kinds drawn plain (outline only, full size, no tile): as in common file trees
const PLAIN = new Set<Kind>(['folder', 'other']);

// Tile behind each other glyph (16 × 16): tinted with the kind's colour
const TILE = '<rect x=".5" y=".5" width="15" height="15" rx="4" fill="currentColor" fill-opacity=".16" stroke="none"/>';

// Glyphs (16 × 16, lines in the kind's colour)
const GLYPHS: Record<Kind, string> = {
    folder: '<path d="M1.5 3.6a1 1 0 0 1 1-1h3.4l1.5 1.6h6.1a1 1 0 0 1 1 1v7.2a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1zM1.5 6.2h13"/>',
    table: '<rect x="3.5" y="4" width="9" height="8" rx="1"/><path d="M3.5 7h9M3.5 9.5h9M7 7v5"/>',
    data: '<path d="M6.5 4c-1.2 0-1.2.8-1.2 1.8S5 7.6 4 8c1 .4 1.3 1.2 1.3 2.2S5.3 12 6.5 12M9.5 4c1.2 0 1.2.8 1.2 1.8S11 7.6 12 8c-1 .4-1.3 1.2-1.3 2.2S10.7 12 9.5 12"/>',
    code: '<path d="M6 5 3.5 8 6 11M10 5l2.5 3L10 11M8.8 4.5l-1.6 7"/>',
    text: '<path d="M4.5 5h7M4.5 8h7M4.5 11h4.5"/>',
    log: '<path d="M4 5h1.2M7 5h5M4 8h1.2M7 8h3.5M4 11h1.2M7 11h4.5"/>', // time stamps and messages
    model: '<path d="M8 3.5l4 2.2v4.6L8 12.5l-4-2.2V5.7zM4 5.7l4 2.2 4-2.2M8 7.9v4.6"/>',
    report: '<path d="M4 12.5h8M5.5 11V8.5M8 11V4.5M10.5 11V6.5"/>',
    image: '<rect x="3.5" y="4.5" width="9" height="7" rx="1"/><path d="M4 11l2.6-2.8 2 2 1.2-1.2 2 2"/><circle cx="10" cy="6.6" r=".7"/>',
    document: '<path d="M5 3.5h3.8l2.2 2.2v6.8H5zM8.8 3.5v2.2H11M6.5 8.5h3M6.5 10.5h3"/>',
    archive: '<path d="M7 3.5h1M8 5h1M7 6.5h1M8 8h1"/><rect x="6.3" y="9.3" width="3.4" height="3.2" rx=".8"/>',
    other: '<path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3"/>',
};

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns kind of a file by its name (folders: 'folder') */
export function kindOf(name: string, folder = false): Kind {
    if (folder) return 'folder';
    const own = EXTENSION_KINDS.find(([, re]) => re.test(name));
    if (own) return own[0];
    const format = formatOf(name);
    if (format in FORMAT_KINDS) return FORMAT_KINDS[format];
    return format === 'text' ? 'other' : 'text'; // Markdown, reStructuredText: text
}

/** @returns icon of a kind: coloured by its class (tp-kind-<kind>, cf. styles) */
export const kindIcon = (kind: Kind): string =>
    `<svg class="tp-kind tp-kind-${kind}" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PLAIN.has(kind) ? '' : TILE}${GLYPHS[kind]}</svg>`;
