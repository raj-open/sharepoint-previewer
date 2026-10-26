// XML highlighting

// ===========================================================================
// IMPORTS
// ===========================================================================

import { tokenise } from './tokenise.ts';

/** @typedef {import('../../_core/types.ts').Token} Token */

// ===========================================================================
// CONSTANTS
// ===========================================================================

const XML_RE = new RegExp(
    [
        /(<!--[\s\S]*?-->)/.source, // 1 comment
        /(<!\[CDATA\[[\s\S]*?\]\]>)/.source, // 2 CDATA
        /(<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>)/.source, // 3 declaration
        /(<\/?[A-Za-z_][\w:.-]*)/.source + // 4 tag start
            /((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)/.source + // 5 attributes
            /(\s*\/?>)/.source, // 6 tag end
        /(&[#\w]+;)/.source, // 7 entity
    ].join('|'),
    'g',
);

const XML_ATTR_RE = /([^\s=]+)(\s*=\s*)?("[^"]*"|'[^']*')?/g;

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {string} text @returns {Token[]} */
export const highlightXml = (text) =>
    tokenise(text, XML_RE, (m, out) => {
        if (m[1]) out.push(['com', m[1]]);
        else if (m[2]) out.push(['meta', m[2]]);
        else if (m[3]) out.push(['meta', m[3]]);
        else if (m[4]) {
            out.push(['tag', m[4]]);
            if (m[5]) {
                out.push(
                    ...tokenise(m[5], XML_ATTR_RE, (a, o) => {
                        o.push(['attr', a[1]]);
                        if (a[2]) o.push(['punct', a[2]]);
                        if (a[3]) o.push(['aval', a[3]]);
                    }),
                );
            }
            out.push(['tag', m[6]]);
        } else out.push(['ent', m[7]]);
    });
