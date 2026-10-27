// Types shared by the modules

import type { View3d } from '../viewer/view3d.ts';

/** layout of the viewer: popup, below the list or right of it */
export type Layout = 'popup' | 'horizontal' | 'vertical';
/** [CSS class without "tp-", text] */
export type Token = [string, string];
export type Problem = { line: number; msg: string; severity: 'error' | 'warning' };
export type LintResult = { problems: Problem[]; info?: string };
/** lines or table shown; csvText: the table as CSV (table views) */
export type LineView = { stop: () => void; show: (line: number) => void; csvText?: () => string };
/** dates of a file as the server gives them (UTC; null: not given) */
export type FileDates = { modified: string | null; created: string | null };
/**
 * file as read: text so far (all of it once done), more on demand;
 * the other fields per reader (text, Parquet, ZIP) and while viewed or edited
 */
export type Source = SourceBase | SheetSource;
type SourceBase = {
    total: number;
    loaded: number;
    done: boolean;
    text: string;
    more: () => Promise<void>;
    loadAll: () => Promise<void>;
    isSheet?: false;
    name?: string;
    dates?: FileDates;
    format?: string;
    info?: [string, string | number][];
    label?: () => string;
    nextLabel?: string;
    wholeLines?: boolean;
    deferred?: boolean;
    // text: encoding, byte order mark, line ends, as in the file (written back so)
    encoding?: string;
    bom?: boolean;
    crlf?: boolean;
    trailingNewline?: boolean;
    // caching: relay of progress, "cache all" running
    relay?: { fn: ((loaded: number, total: number) => void) | null; controller: AbortController | null };
    fullJob?: Promise<void> | null;
    // editing: new file (not on Sharepoint until uploaded), text as read, checks of the text shown
    fresh?: boolean;
    originalText?: string | null;
    lintResult?: LintResult | null;
    needsLint?: boolean;
    // per reader
    ifcBytes?: Uint8Array;
    zipBytes?: Uint8Array;
    isZip?: boolean;
    isParquet?: boolean;
    rows?: number;
    // archives (Power BI): lists of parts (picker), the one shown (list 0, item 0: overview)
    parts?: { label: string; items: ArchivePart[] }[];
    part?: { list: number; item: number };
};
/** part of an archive: text read at once (null: not plain text, not readable) */
export type ArchivePart = { name: string; note: string; lang: string | null; text: string | null };
/** spreadsheet: sheets and tables, one shown (current entry of the view, `mode`); waiting: none chosen yet */
export type SheetSource = Omit<SourceBase, 'isSheet'> & {
    isSheet: true;
    sheets: Sheet[];
    tables: Table[];
    tablesRead: boolean;
    mode: SheetMode;
    current: number;
    waiting: boolean;
    shown: SheetShown;
    loadSheet: (i: number) => Promise<void>;
    select: (i: number, m?: SheetMode) => void;
    sheetOf: (i: number, m?: SheetMode) => number;
    startOf: (m: SheetMode) => number;
};
/** the open preview panel: its elements, the file shown and the state of its views */
export type Viewer = {
    // Elements
    backdrop: HTMLDivElement;
    box: HTMLDivElement;
    header: HTMLDivElement;
    layoutBtn: HTMLButtonElement;
    hBtn: HTMLButtonElement;
    vBtn: HTMLButtonElement;
    pBtn: HTMLButtonElement;
    refreshBtn: HTMLButtonElement;
    loadAllBtn: HTMLButtonElement;
    stopBtn: HTMLButtonElement;
    clearBtn: HTMLButtonElement;
    clearAllBtn: HTMLButtonElement;
    saveBtn: HTMLButtonElement;
    uploadBtn: HTMLButtonElement;
    writeBtn: HTMLButtonElement;
    newBtn: HTMLButtonElement;
    newItem: HTMLButtonElement;
    linkBtn: HTMLButtonElement;
    textBtn: HTMLButtonElement;
    previewBtn: HTMLButtonElement;
    sheetPicker: Picker;
    formatPicker: Picker;
    stage3d: HTMLDivElement;
    canvas3d: HTMLCanvasElement;
    status3d: HTMLDivElement;
    progress: HTMLDivElement;
    progressBar: HTMLElement;
    progressFill: HTMLElement;
    progressText: HTMLElement;
    editor: HTMLTextAreaElement;
    editorWrap: HTMLDivElement;
    updateGutter: () => void;
    title: HTMLDivElement;
    titleName: HTMLElement;
    titleSheet: HTMLElement;
    metaLine: HTMLDivElement;
    csvBar: HTMLDivElement;
    copyBtn: HTMLButtonElement;
    closeBtn: HTMLButtonElement;
    lint: HTMLDivElement;
    content: HTMLDivElement;
    loadMoreBtn: HTMLButtonElement;
    splitter: HTMLDivElement;
    removeListeners?: () => void;
    applyColour?: () => void;
    // Layout: mode; split modes: list region and its parts, as they were before (restored on close)
    mode: Layout;
    originalBodyStyle: string | null;
    selfResize?: boolean;
    grid?: HTMLElement | null;
    scroller?: HTMLElement | null;
    region?: HTMLElement | null;
    regionStyle?: string | null;
    regionObserver?: ResizeObserver | null;
    containerObserver?: ResizeObserver | null;
    base?: DOMRect;
    anchor?: HTMLElement | null;
    anchorParent?: HTMLElement | null;
    anchorParentStyle?: string | null;
    anchorSpace?: number;
    dock?: HTMLElement | null;
    dockBase?: DOMRect;
    dockStyle?: string | null;
    // File shown and its reading
    text: string;
    loadToken: number;
    file?: { name: string; url: string } | null;
    /** file shown (a link file: where it leads; path or URL), or folder of the empty viewer (null: open in Sharepoint) */
    place?: string | null;
    fileName?: string;
    linked?: boolean;
    lang?: string | null;
    source?: Source | null;
    abort?: AbortController | null;
    opening?: boolean;
    busy?: boolean;
    userStopped?: boolean;
    loadAll?: () => Promise<boolean>;
    updateMeta?: () => void;
    selectSheet?: (i: number, list: number) => Promise<void>; // picker: sheets / tables, or parts of an archive
    // Views: lines or table, 3D, checks
    lineView?: LineView | null;
    rerender?: (() => void) | null;
    view3d?: View3d | null;
    lintWorker?: Worker | null;
    relint?: (() => void) | null;
    // Editing
    writeMode?: boolean;
    tableEditing?: boolean;
    dirty?: boolean;
    staged?: string | null;
    // another name (save as): being edited, saved with the staged text
    newName?: string | null;
    stagedName?: string | null;
};
/** where an edit is uploaded: name, server-relative path, new file (the original stays) */
export type Target = { name: string; url: string; isNew: boolean };
/** bytes [from, to) of a file */
export type ByteReader = (from: number, to: number) => Promise<Uint8Array>;
export type RangeFile = {
    size: number;
    head: Uint8Array;
    dates: FileDates;
    read: ByteReader;
    fetched: () => number;
    whole: () => boolean;
};
export type ZipEntry = { name: string; method: number; packed: number; size: number; offset: number; head: number };
/** cells as text, rows without gaps */
export type SheetData = { rows: string[][]; cols: number; cut: boolean };
/** corners of a cell range (0-based, inclusive) */
export type CellRange = { r0: number; c0: number; r1: number; c1: number };
/** table (list object) of a sheet: header and totals rows, column names (may be empty) */
export type TablePart = { name: string; range: CellRange; header: number; totals: number; columns: string[] };
/** table and the index of its sheet */
export type Table = TablePart & { sheet: number };
/** list of a picker: entries, note if empty, entry marked first */
export type PickerList = { label: string; items: { text: string; title?: string }[]; empty: string; start: number };
/** drop-down with lists side by side */
export type Picker = {
    button: HTMLButtonElement;
    menu: HTMLElement;
    set: (lists: PickerList[], choice: { list: number; item: number }, label: string, title: string) => void;
    close: () => void;
};
/** what a spreadsheet shows: its sheets or its tables */
export type SheetMode = 'sheets' | 'tables';
/** sheet or table shown: rows, column names, note if no rows, text view (CSV) */
export type SheetShown = { rows: string[][]; header: string[]; note: string; text: string };
/** data: undefined = not read yet, null = no cells */
export type Sheet = {
    name: string;
    hidden: boolean;
    kind: string;
    size: number;
    path?: string;
    data?: SheetData | null;
    note?: string;
};
/** parts of a ZIP-based document by path */
export type Package = {
    paths: () => string[];
    entry: (path?: string) => ZipEntry | undefined;
    bytes: (path?: string) => Promise<Uint8Array | null>;
    text: (path?: string) => Promise<string | null>;
};
/** big file: shown only after "cache all" */
export type Deferred = { deferred: string; size: number; dates: FileDates };
/** sort, filters, column widths, rows expanded (detail shown; allOpen: last "expand all" opened) of a table view */
export type TableState = {
    sort: { col: number; dir: number } | null;
    filters: Map<number, { values: Set<string> | null; text: string }>;
    widths?: Map<number, number>;
    expanded?: Set<number>;
    allOpen?: boolean;
};
/** log as a table: columns line, fields (kinds: time, level, context, name), message */
export type LogTable = { header: string[]; rows: string[][]; kinds: string[] };
/** cells of a CSV line; raw: its text as in the file (unedited rows are written back as they were) */
export type CsvRow = string[] & { raw?: string };
/** readers of a workbook's parts (XML or binary) */
export type SheetParts = {
    workbook: (bytes: Uint8Array) => {
        sheets: { name: string; id: string; hidden: boolean }[];
        active: number;
        date1904: boolean;
    };
    strings: (bytes: Uint8Array) => string[];
    styles: (bytes: Uint8Array) => string[];
    sheet: (bytes: Uint8Array, strings: string[], kinds: string[], date1904: boolean) => SheetData;
    table: (bytes: Uint8Array) => TablePart | null;
};
/** tables: undefined if the format has none that are read */
export type Book = {
    format: string;
    sheets: Sheet[];
    active: number;
    date1904: boolean;
    load: (i: number) => Promise<SheetData | null>;
    tables?: Table[];
};
