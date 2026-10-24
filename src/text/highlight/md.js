import { tokenise } from './tokenise.js';

/** @typedef {import('../../_core/types.js').Token} Token */

// Markdown (line by line; fenced code blocks are kept as plain string content)
const MD_INLINE_RE = new RegExp(
  [
    /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.source, // 1-2 `code`
    String.raw`(\*\*|__)(?=\S)([\s\S]*?\S)\3`, // 3-4 **bold** (\3: group of the joined pattern)
    String.raw`(\*|_)(?=\S)([\s\S]*?\S)\5(?![\w*])`, // 5-6 *emphasis*
    /(!?\[)([^\]\n]*)(\]\()([^)\s]*)((?:\s+"[^"]*")?\))/.source, // 7-11 [text](url) / ![alt](url)
    /(<(?:https?:\/\/|mailto:)[^>\s]+>|\bhttps?:\/\/[^\s<>()]+)/.source, // 12 link
    /(<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>)/.source, // 13 HTML tag
  ].join('|'),
  'g',
);

/** @param {string} text @param {Token[]} out @returns {void} */
function mdInline(text, out) {
  out.push(
    ...tokenise(text, MD_INLINE_RE, (m, o) => {
      if (m[1]) o.push(['str', m[0]]);
      else if (m[3]) o.push(['type', m[0]]);
      else if (m[5]) o.push(['enum', m[0]]);
      else if (m[7]) o.push(['punct', m[7]], ['key', m[8]], ['punct', m[9]], ['aval', m[10]], ['punct', m[11]]);
      else if (m[12]) o.push(['aval', m[12]]);
      else o.push(['tag', m[13]]);
    }),
  );
}

/** @param {string} text @returns {Token[]} */
export function highlightMd(text) {
  /** @type {Token[]} */
  const out = [];
  /** @type {string|null} */
  let fence = null; // end marker of open ``` / ~~~ block
  text.split('\n').forEach((line, i) => {
    if (i) out.push(['', '\n']);
    if (fence) {
      if (line.trim().startsWith(fence)) {
        out.push(['meta', line]);
        fence = null;
      } else {
        out.push(['str', line]);
      }
      return;
    }
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (open) {
      fence = open[1];
      out.push(['meta', line]);
      return;
    }
    if (/^\s{0,3}#{1,6}(\s|$)/.test(line) || (/^\s{0,3}(=+|-+)\s*$/.test(line) && i > 0)) {
      out.push(['kw', line]); // heading or setext underline
      return;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(['punct', line]); // horizontal rule
      return;
    }
    const lead = /** @type {RegExpMatchArray} */ (
      line.match(/^(\s*(?:>\s?)*)((?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/)
    ); // all parts optional: always matches
    if (lead[1]) out.push(['punct', lead[1]]);
    if (lead[2]) out.push(['punct', lead[2]]);
    const rest = line.slice(lead[0].length);
    if (/^\s*\|/.test(rest) || /\|\s*$/.test(rest)) {
      // table row: pipes as punctuation
      for (const part of rest.split(/(\|)/)) {
        if (part === '|') out.push(['punct', part]);
        else mdInline(part, out);
      }
    } else {
      mdInline(rest, out);
    }
  });
  return out;
}
