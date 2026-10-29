// Small shared helpers: HTML escaping, next frame, byte sizes, CSV cells, typing (keys meant for a field), Ctrl / Cmd + A

// ===========================================================================
// CONSTANTS
// ===========================================================================

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

// Fields typed into: keys belong to them (not checkboxes, buttons and the like)
const TYPED = [
    'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="file"])',
    'textarea',
    'select',
    '[contenteditable]:not([contenteditable="false"])',
].join(', ');

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns HTML-escaped */
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);

export const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

export const csvCell = (s: string | null): string =>
    s === null ? '' : /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

/** @returns target is a field typed into (text input, text area, choice, editable cell): keys belong to it */
export const typing = (target: EventTarget | null): boolean => !!(target as Element | null)?.closest?.(TYPED);

/** @returns Ctrl / Cmd + A (no Shift or Alt): select all (of what the pointer is over: Zen list, viewer's content) */
export const isSelectAllKey = (e: KeyboardEvent): boolean =>
    !!(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a';
