// XML checks

// ===========================================================================
// IMPORTS
// ===========================================================================

/** @typedef {import('../../_core/types.js').LintResult} LintResult */

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {string} text @returns {LintResult} */
export function lintXml(text) {
    const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (!err) {
        return { problems: [], info: `root <${doc.documentElement.nodeName}>` };
    }
    const raw = err.textContent;
    const line = +((raw.match(/line(?: number)?\s*(\d+)/i) || [])[1] || 1);
    const msg =
        (raw.match(/error on line \d+ at column \d+:\s*([^\n]*)/i) || [])[1] ||
        raw.split('\n')[0].replace(/^XML Parsing Error:\s*/i, '');
    return { problems: [{ line, msg: msg.trim(), severity: 'error' }] };
}
