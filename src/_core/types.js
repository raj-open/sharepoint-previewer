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
/** @typedef {{ name: string, hidden: boolean, kind: string, size: number, path?: string, data?: SheetData|null, note?: string }} Sheet data: undefined = not read yet, null = no cells */
/** @typedef {{ entry: (path?: string) => ZipEntry|undefined, bytes: (path?: string) => Promise<Uint8Array|null>, text: (path?: string) => Promise<string|null> }} Package parts of a ZIP-based document by path */
/** @typedef {{ deferred: string, size: number, dates: Object<string, *> }} Deferred big file: shown only after "cache all" */
/** @typedef {{ sort: { col: number, dir: number }|null, filters: Map<number, { values: Set<string>|null, text: string }>, widths?: Map<number, number> }} TableState sort, filters, column widths of a table view */
/** @typedef {string[] & { raw?: string }} CsvRow cells of a CSV line; raw: its text as in the file (unedited rows are written back as they were) */
/** @typedef {Event & { target: HTMLElement }} TargetEvent event whose target is an element (handlers read e.target) */
/** @typedef {{ workbook: (bytes: Uint8Array) => { sheets: { name: string, id: string, hidden: boolean }[], active: number, date1904: boolean }, strings: (bytes: Uint8Array) => string[], styles: (bytes: Uint8Array) => string[], sheet: (bytes: Uint8Array, strings: string[], kinds: string[], date1904: boolean) => SheetData }} SheetParts readers of a workbook's parts (XML or binary) */
/** @typedef {{ format: string, sheets: Sheet[], active: number, date1904: boolean, load: (i: number) => Promise<SheetData|null> }} Book */

export {};
