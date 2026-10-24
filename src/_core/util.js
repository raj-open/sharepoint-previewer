// Small shared helpers: HTML escaping, next frame, byte sizes, CSV cells

// ===========================================================================
// CONSTANTS
// ===========================================================================

/** @type {Object<string, string>} */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {string} s @returns {string} HTML-escaped */
export const esc = (s) => s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);

/** @returns {Promise<void>} */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** @param {number} n @returns {string} */
export const formatBytes = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

/** @param {string|null} s @returns {string} */
export const csvCell = (s) => (s === null ? '' : /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
