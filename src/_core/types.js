// Types shared by the modules (JSDoc only)

/** @typedef {[string, string]} Token [CSS class without "tp-", text] */
/** @typedef {{ line: number, msg: string, severity: 'error'|'warning' }} Problem */
/** @typedef {{ problems: Problem[], info?: string }} LintResult */
/** @typedef {{ stop: () => void, show: (line: number) => void }} LineView */
/** @typedef {{ total: number, loaded: number, done: boolean, text: string, more: () => Promise<void>, loadAll: () => Promise<void> } & Object<string, *>} Source */
/** @typedef {Object<string, *>} Viewer the open preview panel: its elements and state */
/** @typedef {(from: number, to: number) => Promise<Uint8Array>} ByteReader bytes [from, to) of a file */
/** @typedef {{ size: number, head: Uint8Array, dates: Object, read: ByteReader, fetched: () => number, whole: () => boolean }} RangeFile */
/** @typedef {{ name: string, method: number, packed: number, size: number, offset: number, head: number }} ZipEntry */
/** @typedef {{ rows: string[][], cols: number, cut: boolean }} SheetData cells as text, rows without gaps */
/** @typedef {{ r0: number, c0: number, r1: number, c1: number }} CellRange corners of a cell range (0-based, inclusive) */
/** @typedef {{ name: string, range: CellRange, header: number, totals: number, columns: string[] }} TablePart table (list object) of a sheet: header and totals rows, column names (may be empty) */
/** @typedef {TablePart & { sheet: number }} Table table and the index of its sheet */
/** @typedef {{ label: string, items: { text: string, title?: string }[], empty: string, start: number }} PickerList list of a picker: entries, note if empty, entry marked first */
/** @typedef {{ button: HTMLButtonElement, menu: HTMLElement, set: (lists: PickerList[], choice: { list: number, item: number }, label: string, title: string) => void, close: () => void }} Picker drop-down with lists side by side */
/** @typedef {'sheets'|'tables'} SheetMode what a spreadsheet shows: its sheets or its tables */
/** @typedef {{ rows: string[][], header: string[], note: string, text: string }} SheetShown sheet or table shown: rows, column names, note if no rows, text view (CSV) */
/** @typedef {{ name: string, hidden: boolean, kind: string, size: number, path?: string, data?: SheetData|null, note?: string }} Sheet data: undefined = not read yet, null = no cells */
/** @typedef {{ paths: () => string[], entry: (path?: string) => ZipEntry|undefined, bytes: (path?: string) => Promise<Uint8Array|null>, text: (path?: string) => Promise<string|null> }} Package parts of a ZIP-based document by path */
/** @typedef {{ deferred: string, size: number, dates: Object<string, *> }} Deferred big file: shown only after "cache all" */
/** @typedef {{ sort: { col: number, dir: number }|null, filters: Map<number, { values: Set<string>|null, text: string }>, widths?: Map<number, number>, expanded?: Set<number>, allOpen?: boolean }} TableState sort, filters, column widths, rows expanded (detail shown; allOpen: last "expand all" opened) of a table view */
/** @typedef {{ header: string[], rows: string[][], kinds: string[] }} LogTable log as a table: columns line, fields (kinds: time, level, context, name), message */
/** @typedef {string[] & { raw?: string }} CsvRow cells of a CSV line; raw: its text as in the file (unedited rows are written back as they were) */
/** @typedef {Event & { target: HTMLElement }} TargetEvent event whose target is an element (handlers read e.target) */
/** @typedef {{ workbook: (bytes: Uint8Array) => { sheets: { name: string, id: string, hidden: boolean }[], active: number, date1904: boolean }, strings: (bytes: Uint8Array) => string[], styles: (bytes: Uint8Array) => string[], sheet: (bytes: Uint8Array, strings: string[], kinds: string[], date1904: boolean) => SheetData, table: (bytes: Uint8Array) => TablePart|null }} SheetParts readers of a workbook's parts (XML or binary) */
/** @typedef {{ format: string, sheets: Sheet[], active: number, date1904: boolean, load: (i: number) => Promise<SheetData|null>, tables?: Table[] }} Book tables: undefined if the format has none that are read */

export {};
