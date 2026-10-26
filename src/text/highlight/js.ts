// JavaScript highlighting

// ===========================================================================
// IMPORTS
// ===========================================================================

import { tokenise } from './tokenise.ts';

import type { Token } from '../../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// JavaScript
const JS_KEYWORDS =
    'async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|' +
    'extends|finally|for|from|function|get|if|import|in|instanceof|let|new|of|return|set|static|' +
    'super|switch|this|throw|try|typeof|var|void|while|with|yield';
const JS_RE = new RegExp(
    [
        /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.source, // 1 comment
        /(`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/.source, // 2 string / template
        // 3 regex literal (only where value may start, so "a / b" stays division)
        /((?<=(?:^|[=(,:;!&|?{}[+\-*%<>~^])\s*|\b(?:return|typeof|case|do|else|in|of|void|yield|await)\s+)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*)/
            .source,
        `\\b(${JS_KEYWORDS})\\b`, // 4 keyword
        /\b(true|false|null|undefined|NaN|Infinity)\b/.source, // 5 literal
        /\b(0[xX][\da-fA-F_]+n?|0[oO][0-7_]+n?|0[bB][01_]+n?|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?)\b/.source, // 6 number
        /\b([A-Z][\w$]*)\b/.source, // 7 class / constructor name
        /([A-Za-z_$][\w$]*)(?=\s*\()/.source, // 8 function call
        /(=>|[{}()[\];,.?:]|[-+*/%=&|^!<>~]+)/.source, // 9 operator / punctuation
    ].join('|'),
    'gm',
);

const JS_CLASSES = ['', 'com', 'str', 'meta', 'kw', 'lit', 'num', 'type', 'enum', 'punct'];

// ===========================================================================
// METHODS
// ===========================================================================

export const highlightJs = (text: string): Token[] =>
    tokenise(text, JS_RE, (m, out) => {
        const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
        out.push([JS_CLASSES[i], m[0]]);
    });
