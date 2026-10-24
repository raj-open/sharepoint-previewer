import { tokenise } from './tokenise.js';

/** @typedef {import('../../types.js').Token} Token */

// Excel formulas (.xlf), any UI language: functions by their "(", errors by "#".
// Argument separator , or ; from text (with ; decimal separator is ,).
/** @param {string} text @returns {',' | ';'} */
function xlfSeparator(text) {
  let commas = 0;
  let semis = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i = text.indexOf('"', i + 1);
      while (i !== -1 && text[i + 1] === '"') i = text.indexOf('"', i + 2);
      if (i === -1) break;
    } else if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i === -1) break;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i === -1) break;
    } else if (c === '(' || c === '{') depth++;
    else if (c === ')' || c === '}') depth = Math.max(0, depth - 1);
    else if (depth && c === ',') commas++;
    else if (depth && c === ';') semis++;
  }
  return semis > commas ? ';' : ',';
}

const XLF_ERRORS = '#[\\p{L}\\p{N}_/]+[!?]?';
const XLF_REF =
  "((?:'(?:[^']|'')+'|[\\p{L}_][\\p{L}\\p{N}_.]*)!)?" + // optional sheet: Tabelle1! or 'My sheet'!
  '(\\$?[A-Za-z]{1,3}\\$?\\d+(?::\\$?[A-Za-z]{1,3}\\$?\\d+)?' + // A1, $A$1, A1:B2
  '|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d+:\\$?\\d+' + // A:C, 1:3
  '|R(?:\\[-?\\d+\\]|\\d+)?C(?:\\[-?\\d+\\]|\\d+)?)'; // R1C1, R[-1]C[2]

/** @param {string} text @returns {Token[]} */
export function highlightXlf(text) {
  const decimal = xlfSeparator(text) === ';' ? ',' : '\\.';
  const re = new RegExp(
    [
      '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1 comment
      '("(?:[^"]|"")*")', // 2 text
      `(${XLF_ERRORS})`, // 3 error value
      '(^[ \\t]*[\\p{L}_][\\p{L}\\p{N}_.]*(?=[ \\t]*=(?!=)))', // 4 name definition (Name = ...)
      `(?<![\\p{L}\\p{N}_.$])${XLF_REF}(?![\\p{L}\\p{N}_(.!])`, // 5-6 cell reference
      '([\\p{L}_][\\p{L}\\p{N}_.]*)(?=\\s*\\()', // 7 function
      `((?<![\\p{L}\\p{N}_.])\\d+(?:${decimal}\\d+)?(?:[eE][+-]?\\d+)?%?)`, // 8 number
      '(<>|<=|>=|[-+*/^&=<>:@#%]|[,;(){}\\\\])', // 9 operator / separator
    ].join('|'),
    'gimu',
  );
  return tokenise(text, re, (m, out) => {
    if (m[1]) out.push(['com', m[1]]);
    else if (m[2]) out.push(['str', m[2]]);
    else if (m[3]) out.push(['attr', m[3]]);
    else if (m[4]) out.push(['key', m[4]]);
    else if (m[6]) {
      if (m[5]) out.push(['meta', m[5]]);
      out.push(['ref', m[6]]);
    } else if (m[7]) out.push(['type', m[7]]);
    else if (m[8]) out.push(['num', m[8]]);
    else out.push(['punct', m[9]]);
  });
}
