// JSON highlighting

// ===========================================================================
// IMPORTS
// ===========================================================================

import { tokenise } from './tokenise.ts';

/** @typedef {import('../../_core/types.ts').Token} Token */

// ===========================================================================
// CONSTANTS
// ===========================================================================

const JSON_RE =
    /("(?:\\.|[^"\\\n])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b|([{}[\],:])/g;

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {string} text @returns {Token[]} */
export const highlightJson = (text) =>
    tokenise(text, JSON_RE, (m, out) => {
        if (m[1] && m[2]) out.push(['key', m[1]], ['punct', m[2]]);
        else if (m[1]) out.push(['str', m[1]]);
        else if (m[3]) out.push(['num', m[3]]);
        else if (m[4]) out.push(['lit', m[4]]);
        else out.push(['punct', m[5]]);
    });
