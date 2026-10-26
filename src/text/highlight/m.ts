// Power Query M highlighting

// ===========================================================================
// IMPORTS
// ===========================================================================

import { tokenise } from './tokenise.ts';

/** @typedef {import('../../_core/types.ts').Token} Token */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Power Query M
const M_KEYWORDS = 'let|in|each|if|then|else|try|otherwise|catch|error|and|or|not|as|is|meta|section|shared|type';
const M_TYPES =
    'any|anynonnull|binary|date|datetime|datetimezone|duration|function|list|logical|none|null|' +
    'number|record|table|text|time|nullable|optional';
const M_RE = new RegExp(
    [
        /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.source, // 1 comment
        /(#"(?:[^"]|"")*")/.source, // 2 quoted identifier
        /("(?:[^"]|"")*")/.source, // 3 string
        /(#(?:date|datetime|datetimezone|duration|time|table|binary|infinity|nan|sections|shared)\b)/.source, // 4 intrinsic
        `\\b(${M_KEYWORDS})\\b`, // 5 keyword
        /\b(true|false|null)\b/.source, // 6 literal
        `\\b(${M_TYPES})\\b(?!\\s*\\.)`, // 7 type
        /\b([A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\b/.source, // 8 library name (Table.AddColumn, Int64.Type)
        /\b(0x[0-9A-Fa-f]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/.source, // 9 number
        /(=>|<>|<=|>=|\.\.\.|\.\.|[=<>+\-*/&?@!]|[()[\]{},;])/.source, // 10 operator / punctuation
    ].join('|'),
    'g',
);

const M_CLASSES = ['', 'com', 'key', 'str', 'meta', 'kw', 'lit', 'type', 'enum', 'num', 'punct'];

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {string} text @returns {Token[]} */
export const highlightM = (text) =>
    tokenise(text, M_RE, (m, out) => {
        const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
        out.push([M_CLASSES[i], m[0]]);
    });
