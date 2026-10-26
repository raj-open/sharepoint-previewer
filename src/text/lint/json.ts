// JSON checks

// ===========================================================================
// IMPORTS
// ===========================================================================

import { lineAt } from './core.ts';

/** @typedef {import('../../_core/types.ts').LintResult} LintResult */

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {string} text @returns {LintResult} */
export function lintJson(text) {
    try {
        const value = JSON.parse(text.replace(/^\uFEFF/, ''));
        const kind = Array.isArray(value) ? `array, ${value.length.toLocaleString()} items` : typeof value;
        return { problems: [], info: kind };
    } catch (e) {
        const msg = /** @type {Error} */ (e).message.replace(/^JSON\.parse:\s*/, '');
        const byLine = msg.match(/line (\d+)/i);
        const byPos = msg.match(/position (\d+)/i);
        const line = byLine ? +byLine[1] : byPos ? lineAt(text, +byPos[1]) : 1;
        return { problems: [{ line, msg, severity: 'error' }] };
    }
}
