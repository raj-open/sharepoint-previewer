// Log files: levels (error red, warning yellow, info blue, debug grey), dates, exceptions, stack frames

// ===========================================================================
// IMPORTS
// ===========================================================================

import { tokenise } from './tokenise.ts';

/** @typedef {import('../../_core/types.ts').Token} Token */

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const LOG_LEVELS = {
    'lv-err': [
        'FATAL',
        'CRITICAL',
        'CRIT',
        'ERROR',
        'ERR',
        'SEVERE',
        'EMERGENCY',
        'EMERG',
        'ALERT',
        'FAILED',
        'FAILURE',
        'FAIL',
    ],
    'lv-warn': ['WARNING', 'WARN', 'DEPRECATED'],
    'lv-info': ['INFORMATION', 'INFO', 'NOTICE'],
    'lv-debug': ['DEBUG', 'TRACE', 'VERBOSE'],
};
const LOG_LEVEL_CLASSES = Object.keys(LOG_LEVELS);

const LOG_RE = new RegExp(
    [
        /(^[ \t]+(?:at [^\n]*|File "[^\n]*))/.source, // 1 stack frame (Java, .NET, JS, Python)
        /("(?:\\.|[^"\\\n])*"|(?<!\w)'(?:\\.|[^'\\\n])*'(?!\w))/.source, // 2 string
        [
            /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/.source, // ISO 8601
            /\d{1,2}[./]\d{1,2}[./]\d{2,4}(?: \d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)?/.source, // 24.10.2026, 10/24/2026
            /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2}(?: \d{2}:\d{2}:\d{2})?/.source, // syslog
            /\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/.source, // time
        ]
            .map((x) => `\\b${x}\\b`)
            .join('|')
            .replace(/^/, '(')
            .concat(')'), // 3 date / time
        /\b([A-Za-z_$][\w.$]*(?:Exception|Error))\b/.source, // 4 exception
        ...LOG_LEVEL_CLASSES.map((cls) => {
            const words = LOG_LEVELS[/** @type {keyof typeof LOG_LEVELS} */ (cls)];
            const forms = words.flatMap((w) => [w, w[0] + w.slice(1).toLowerCase(), w.toLowerCase()]);
            return `\\b(${forms.join('|')})\\b`;
        }), // 5-8 levels
        /\b([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\b/.source, // 9 GUID
        /\b((?:https?|ftp|file):\/\/[^\s"'<>]+)/.source, // 10 URL
        /\b([A-Za-z_][\w.-]*)(?==)/.source, // 11 key of key=value
        /\b(true|false|null|None|undefined|NaN)\b/.source, // 12 literal
        /\b(0x[0-9A-Fa-f]+|\d+(?:\.\d+)?)\b/.source, // 13 number
    ].join('|'),
    'gm',
);

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {string} text @returns {Token[]} */
export const highlightLog = (text) =>
    tokenise(text, LOG_RE, (m, out) => {
        if (m[1]) out.push(['log-frame', m[1]]);
        else if (m[2]) out.push(['str', m[2]]);
        else if (m[3]) out.push(['log-date', m[3]]);
        else if (m[4]) out.push(['lv-err', m[4]]);
        else if (m[5]) out.push(['lv-err', m[5]]);
        else if (m[6]) out.push(['lv-warn', m[6]]);
        else if (m[7]) out.push(['lv-info', m[7]]);
        else if (m[8]) out.push(['lv-debug', m[8]]);
        else if (m[9] || m[13]) out.push(['num', m[0]]);
        else if (m[10]) out.push(['log-url', m[10]]);
        else if (m[11]) out.push(['key', m[11]]);
        else out.push(['lit', m[12]]);
    });
