import { collector } from './core.js';
/** @typedef {import('../../_core/types.js').LintResult} LintResult */

// Power Query M: brackets, strings, comments and let / in pairs
/** @param {string} text @returns {LintResult} */
export function lintM(text) {
  const { problems, add } = collector();
  const PAIRS = { ')': '(', ']': '[', '}': '{' };
  /** @type {[string, number][]} */
  const stack = []; // [char, line]
  /** @type {number[]} */
  const lets = []; // lines of "let" that still need their "in"
  let line = 1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') {
      line++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = (end === -1 ? text.length : end) - 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const start = line;
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      if (end === -1) add(start, 'Comment is never closed');
      for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
      i = stop - 1;
      continue;
    }
    if (c === '"') {
      const start = line;
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') j++;
          else break;
        } else if (text[j] === '\n') line++;
      }
      if (j >= text.length) add(start, 'Text is never closed with "');
      i = j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      stack.push([c, line]);
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      const top = stack.pop();
      if (!top) add(line, `Unexpected "${c}"`);
      else if (top[0] !== PAIRS[c]) add(line, `"${c}" does not match "${top[0]}" opened on line ${top[1]}`);
      continue;
    }
    if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_.#]/.test(text[i - 1] || '')) {
      const word = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? '';
      if (word === 'let') lets.push(line);
      else if (word === 'in' && !lets.pop()) add(line, '"in" without its "let"');
      i += word.length - 1;
    }
  }

  for (const [c, l] of stack) add(l, `"${c}" is never closed`);
  for (const l of lets) add(l, '"let" without its "in"');
  problems.sort((a, b) => a.line - b.line);
  return { problems };
}
