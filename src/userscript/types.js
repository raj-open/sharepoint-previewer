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
/** @typedef {{ format: string, sheets: Sheet[], active: number, date1904: boolean, load: (i: number) => Promise<SheetData|null> }} Book */

export {};
