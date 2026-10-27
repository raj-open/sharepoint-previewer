// Settings: defaults below; own values in Tampermonkey's storage (menu → "Settings …"),
// kept across updates. Values of wrong type are ignored.

// ===========================================================================
// TYPES
// ===========================================================================

// Value of a setting (its type: that of its default)
export type SettingValue = string | number | boolean;
export type Settings = Record<string, SettingValue>;

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const DEFAULTS = {
    // 'popup', 'horizontal' (below list) or 'vertical' (right of it); start value
    'layout': 'horizontal',

    // Share of space for preview in split mode (0.2 – 0.8); start value
    'viewer-share': 1 / 3,

    // Show light markers for whitespace: · for spaces, → for tabs
    'show-whitespace': true,

    // Wrap long lines (start value)
    'wrap-lines': false,

    // Syntax colours: text view, table view, table view of logs (start values)
    'colours-text': true,
    'colours-table': false,
    'colours-log': true,

    // Column colours in table view of spreadsheets (start value; rows stay striped)
    'colours-sheet': false,

    // Spreadsheets show 'sheets' or 'tables' (start value; sheets if a file has no tables)
    'spreadsheet-view': 'tables',

    // Spreadsheets up to this size show their first sheet or table at once; larger ones wait for a choice
    'spreadsheet-autoload-bytes': 512 * 1024,

    // Bytes per cache step ("Cache next"); 512 KB ≈ 10,000 lines of code
    'cache-chunk-bytes': 512 * 1024,

    // Parquet files: rows shown at first; "Cache next" shows this many more
    'parquet-rows': 100,

    // Cache limit for all files together (bytes of the files); more asks to clear first
    'memory-cache-bytes': 256 * 1024 * 1024,

    // "cache all" button asks for confirmation for files bigger than this
    'cache-all-confirm-bytes': 16 * 1024 * 1024,

    // Longer lines are cut for display (copy still gets full text)
    'max-line-chars': 5000,

    // Follow link files (.url shortcuts) and show file they point to
    'follow-links': true,

    // Folder with ifc-lite-3d.js and ifc-lite_bg.wasm: relative to site, or from top
    // with leading '/'. Fetched on first use of 3D button, checked by SHA-256.
    'viewer-3d-folder': '',

    // 3D view asks first for IFC files above this size (for .ifczip: unpacked IFC file)
    'viewer-3d-max-bytes': 25 * 1024 * 1024,

    // 'dark' or 'light' (start value)
    'theme': 'light',

    // Logo (top right) as data: URI; empty = none. No network request.
    'logo': '',
};

// Fixed values (internal)
// Links followed in row at most (against loops)
export const MAX_LINK_HOPS = 5;

// Bytes at start that decide whether file is text
export const SNIFF_BYTES = 512;

// Most problems listed by checker
export const MAX_PROBLEMS = 500;

// Space between list and preview in split mode, in pixels
export const SPLIT_GAP = 3;

// Width of preview (eye) column, in pixels
export const COL_WIDTH = 32;

// Checksums of 3D viewer files (they belong to this script version): dummies, stamped by the release build
export const VIEWER_3D_JS_SHA256 = '<sha256>';
export const VIEWER_3D_WASM_SHA256 = '<sha256>';

// ===========================================================================
// METHODS
// ===========================================================================

function loadSettings(): typeof DEFAULTS {
    const out: Settings = {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
        let value = GM_getValue(key);
        if (value === undefined) {
            value = fallback;
            GM_setValue(key, value); // shown in Tampermonkey's storage
        }
        out[key] = typeof value === typeof fallback ? (value as SettingValue) : fallback;
    }
    return out as typeof DEFAULTS; // types checked above
}
export const {
    'layout': DEFAULT_MODE,
    'viewer-share': DEFAULT_PREVIEW_SIZE,
    'show-whitespace': SHOW_WHITESPACE,
    'wrap-lines': DEFAULT_WRAP,
    'colours-text': DEFAULT_COLOURS,
    'colours-table': DEFAULT_TABLE_COLOURS,
    'colours-log': DEFAULT_LOG_COLOURS,
    'colours-sheet': DEFAULT_SHEET_COLOURS,
    'spreadsheet-view': DEFAULT_SHEET_VIEW,
    'spreadsheet-autoload-bytes': SHEET_AUTOLOAD_BYTES,
    'cache-chunk-bytes': MAX_BYTES,
    'parquet-rows': PARQUET_ROWS,
    'memory-cache-bytes': MEMORY_CACHE_BYTES,
    'cache-all-confirm-bytes': LARGE_FILE_BYTES,
    'max-line-chars': MAX_LINE_CHARS,
    'follow-links': FOLLOW_LINKS,
    'viewer-3d-folder': VIEWER_3D_FOLDER,
    'viewer-3d-max-bytes': MAX_3D_BYTES,
    'theme': THEME,
    'logo': LOGO,
} = loadSettings();
