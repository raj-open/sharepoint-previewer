// Small shared helpers: HTML escaping, next frame, byte sizes, CSV cells

// ===========================================================================
// CONSTANTS
// ===========================================================================

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

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
