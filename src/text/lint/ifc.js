import { collector } from './core.js';
/** @typedef {import('../../_core/types.js').LintResult} LintResult */

// IFC = ISO 10303-21 (STEP physical file)
/** @param {string} text @returns {LintResult} */
export function lintIfc(text) {
  const { problems, add } = collector();

  // Split into statements (";"-terminated), ignoring comments and string contents
  const statements = [];
  let buf = '';
  let start = 1;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') {
      line++;
      buf += ' ';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      if (end === -1) add(line, 'Comment is never closed');
      for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
      i = stop - 1;
      buf += ' ';
      continue;
    }
    if (!buf.trim() && !/\s/.test(c)) start = line;
    if (c === "'") {
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") j++;
          else break;
        } else if (text[j] === '\n') line++;
      }
      if (j >= text.length) add(start, 'String is never closed');
      buf += "''";
      i = j;
      continue;
    }
    if (c === ';') {
      statements.push({ text: buf.trim(), line: start });
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) add(start, 'Statement is not terminated with ";"');

  // Structure: ISO-10303-21; HEADER; ... ENDSEC; DATA; ... ENDSEC; END-ISO-10303-21;
  const ids = new Map(); // id -> line
  /** @type {[string, number][]} */
  const refs = []; // [id, line]
  const headerSeen = new Set();
  let section = 'start';
  let entities = 0;

  for (const s of statements) {
    const upper = s.text.toUpperCase();
    if (section === 'start') {
      if (upper !== 'ISO-10303-21') add(s.line, 'File must start with "ISO-10303-21;"');
      section = 'pre';
      if (upper === 'ISO-10303-21') continue;
    }
    if (upper === 'HEADER') {
      section = 'header';
      continue;
    }
    if (upper === 'DATA' || /^DATA\s*\(/.test(upper)) {
      section = 'data';
      continue;
    }
    if (upper === 'ENDSEC') {
      if (section !== 'header' && section !== 'data') add(s.line, '"ENDSEC;" without an open section');
      section = 'between';
      continue;
    }
    if (upper === 'END-ISO-10303-21') {
      section = 'end';
      continue;
    }

    if (section === 'end') {
      add(s.line, 'Content after "END-ISO-10303-21;"');
      continue;
    }

    const open = (s.text.match(/\(/g) || []).length;
    const close = (s.text.match(/\)/g) || []).length;
    if (open !== close) add(s.line, `Unbalanced parentheses (${open} "(" vs ${close} ")")`);

    if (section === 'header') {
      const type = (upper.match(/^([A-Z_][A-Z0-9_]*)\s*\(/) || [])[1];
      if (!type) add(s.line, 'Malformed header entry');
      else headerSeen.add(type);
      continue;
    }
    if (section !== 'data') {
      add(s.line, 'Statement outside of HEADER / DATA sections');
      continue;
    }

    const m = s.text.match(/^#(\d+)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)?\s*\(([\s\S]*)\)$/);
    if (!m) {
      add(s.line, 'Malformed entity instance (expected "#id=IFCTYPE(...);")');
      continue;
    }
    entities++;
    if (ids.has(m[1])) add(s.line, `Duplicate id #${m[1]} (first defined on line ${ids.get(m[1])})`);
    else ids.set(m[1], s.line);
    for (const r of m[3].matchAll(/#(\d+)/g)) refs.push([r[1], s.line]);
  }

  if (section !== 'end') add(line, 'No "END-ISO-10303-21;" at the end of the file');
  for (const h of ['FILE_DESCRIPTION', 'FILE_NAME', 'FILE_SCHEMA']) {
    if (!headerSeen.has(h)) add(1, `Header lacks ${h}`, 'warning');
  }
  for (const [id, refLine] of refs) {
    if (!ids.has(id)) add(refLine, `Reference to undefined instance #${id}`);
  }

  problems.sort((a, b) => a.line - b.line);
  return { problems, info: `${entities.toLocaleString()} entities` };
}
