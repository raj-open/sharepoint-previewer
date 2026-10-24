import { tokenise } from './tokenise.js';

/** @typedef {import('../../_core/types.js').Token} Token */

// reStructuredText (line by line; literal blocks after "::" are kept as plain string content)
const RST_INLINE_RE = new RegExp(
  [
    /(``[\s\S]+?``)/.source, // 1 ``literal``
    /(:[\w.+-]+:)(`[^`]+`)/.source, // 2-3 :role:`text`
    /(`[^`]+`__?)/.source, // 4 `link <url>`_ / `reference`_
    /(\*\*(?=\S)[\s\S]*?\S\*\*)/.source, // 5 **strong**
    /(\*(?=\S)[^*]*?\S\*)/.source, // 6 *emphasis*
    /(\|[^|\s][^|]*\|_{0,2})/.source, // 7 |substitution|
    /(\[[#*\w.-]+\]_)/.source, // 8 [footnote]_
    /(\bhttps?:\/\/[^\s<>`]+)/.source, // 9 link
  ].join('|'),
  'g',
);

/** @param {string} text @param {Token[]} out @returns {void} */
function rstInline(text, out) {
  out.push(
    ...tokenise(text, RST_INLINE_RE, (m, o) => {
      if (m[1]) o.push(['str', m[1]]);
      else if (m[2]) o.push(['meta', m[2]], ['str', m[3]]);
      else if (m[4]) o.push(['aval', m[4]]);
      else if (m[5]) o.push(['type', m[5]]);
      else if (m[6]) o.push(['enum', m[6]]);
      else if (m[7]) o.push(['anchor', m[7]]);
      else if (m[8]) o.push(['anchor', m[8]]);
      else o.push(['aval', m[9]]);
    }),
  );
}

const RST_ADORNMENT_RE = /^([=\-`:'"~^_*+#<>.])\1{2,}\s*$/;

/** @param {string} text @returns {Token[]} */
export function highlightRst(text) {
  /** @type {Token[]} */
  const out = [];
  const lines = text.split('\n');
  /** @type {number|null} */
  let literal = null; // indent of paragraph that ended in "::"
  let literalStarted = false;
  lines.forEach((line, i) => {
    if (i) out.push(['', '\n']);
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (literal !== null) {
      if (!line.trim()) {
        out.push(['', line]);
        return;
      }
      if (indent > literal) {
        literalStarted = true;
        out.push(['str', line]);
        return;
      }
      if (literalStarted || indent <= literal) literal = null;
    }

    const next = lines[i + 1] || '';
    if (RST_ADORNMENT_RE.test(line)) {
      out.push(['kw', line]); // section over-/underline
      return;
    }
    if (line.trim() && RST_ADORNMENT_RE.test(next) && next.trim().length >= line.trim().length) {
      out.push(['kw', line]); // section title
      return;
    }

    const directive = line.match(/^(\s*\.\.\s+)((?:\|[^|]+\|\s+)?[\w:.-]+::)(.*)$/);
    if (directive) {
      out.push(['meta', directive[1] + directive[2]]);
      rstInline(directive[3], out);
      // Indented body of code directive is code: show it as plain string content
      literal = /^(code|code-block|sourcecode|highlight)::/.test(directive[2]) ? indent : null;
      literalStarted = false;
      return;
    }
    const target = line.match(/^(\s*\.\.\s+)(_[^:]+:|\[[^\]]+\])(.*)$/);
    if (target) {
      out.push(['meta', target[1]], ['anchor', target[2]], ['aval', target[3]]);
      return;
    }
    if (/^\s*\.\.(\s|$)/.test(line)) {
      out.push(['com', line]); // comment
      return;
    }

    const lead = /** @type {RegExpMatchArray} */ (
      line.match(/^(\s*)((?:[-*+•]|\d+[.)]|#\.|\(?[a-zA-Z0-9]\))\s+)?(:[^:\s][^:]*:(?=\s|$))?/)
    ); // all parts optional: always matches
    if (lead[1]) out.push(['', lead[1]]);
    if (lead[2]) out.push(['punct', lead[2]]);
    if (lead[3]) out.push(['key', lead[3]]);
    rstInline(line.slice(lead[0].length), out);

    if (/::\s*$/.test(line)) {
      literal = indent;
      literalStarted = false;
    }
  });
  return out;
}
