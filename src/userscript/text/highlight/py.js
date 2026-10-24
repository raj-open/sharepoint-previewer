import { tokenise } from './tokenise.js';

/** @typedef {import('../../types.js').Token} Token */

// Python
const PY_KEYWORDS =
  'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|' +
  'global|if|import|in|is|lambda|match|case|nonlocal|not|or|pass|raise|return|try|while|with|yield';
const PY_RE = new RegExp(
  [
    /(#[^\n]*)/.source, // 1 comment
    // 2 string: prefixes (r, b, f, ...), triple quoted (multi-line) or single line
    /((?:\b[rRbBuUfF]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))/.source,
    /(@[\w.]+)/.source, // 3 decorator
    `\\b(${PY_KEYWORDS})\\b`, // 4 keyword
    /\b(True|False|None|self|cls)\b/.source, // 5 literal
    /\b(0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?j?)\b/.source, // 6 number
    /\b([A-Z]\w*)\b/.source, // 7 class name
    /([A-Za-z_]\w*)(?=\s*\()/.source, // 8 function call
    /([{}()[\];,.:]|[-+*/%=&|^!<>~@]+)/.source, // 9 operator / punctuation
  ].join('|'),
  'gm',
);
const PY_CLASSES = [null, 'com', 'str', 'meta', 'kw', 'lit', 'num', 'type', 'enum', 'punct'];

/** @param {string} text @returns {Token[]} */
export const highlightPy = (text) =>
  tokenise(text, PY_RE, (m, out) => {
    const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
    out.push([PY_CLASSES[i], m[0]]);
  });
