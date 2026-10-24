import { tokenise } from './tokenise.js';

/** @typedef {import('../../_core/types.js').Token} Token */

const TOML_BARE_OR_QUOTED = /(?:[A-Za-z0-9_-]+|"(?:\\.|[^"\\\n])*"|'[^'\n]*')/.source;
const TOML_KEY = `${TOML_BARE_OR_QUOTED}(?:[ \\t]*\\.[ \\t]*${TOML_BARE_OR_QUOTED})*`;
const TOML_RE = new RegExp(
  [
    /^([ \t]*)(\[\[?[^\]\n]*\]\]?)(?=[ \t]*(?:#|$))/.source, // 1 indent, 2 [table] / [[array of tables]]
    `(?:^|(?<=[{,]))([ \\t]*)(${TOML_KEY})([ \\t]*=)`, // 3 indent, 4 key, 5 "="
    /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'[^'\n]*')/.source, // 6 string
    /(#[^\n]*)/.source, // 7 comment
    /(\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)/
      .source, // 8 date/time
    /((?<![\w.-])[+-]?(?:0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|inf|nan|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?)(?![\w.-]))/
      .source, // 9 number
    /\b(true|false)\b/.source, // 10 boolean
    /([[\]{},])/.source, // 11 punctuation
  ].join('|'),
  'gm',
);

/** @param {string} text @returns {Token[]} */
export const highlightToml = (text) =>
  tokenise(text, TOML_RE, (m, out) => {
    if (m[2]) {
      if (m[1]) out.push(['', m[1]]);
      out.push(['type', m[2]]);
    } else if (m[4]) {
      if (m[3]) out.push(['', m[3]]);
      out.push(['key', m[4]], ['punct', m[5]]);
    } else if (m[6]) out.push(['str', m[6]]);
    else if (m[7]) out.push(['com', m[7]]);
    else if (m[8] || m[9]) out.push(['num', m[0]]);
    else if (m[10]) out.push(['lit', m[10]]);
    else out.push(['punct', m[11]]);
  });
