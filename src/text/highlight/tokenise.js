/** @typedef {import('../../_core/types.js').Token} Token */

// ---------------------------------------------------------------------------
// Highlighters: text -> [[cssClass, text], ...]
// ---------------------------------------------------------------------------

/** @param {string} text @param {RegExp} re @param {(m: RegExpMatchArray, out: Token[]) => void} onMatch @param {(s: string, out: Token[]) => void} [onGap] @returns {Token[]} */
export function tokenise(text, re, onMatch, onGap = (s, out) => out.push(['', s])) {
  /** @type {Token[]} */
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    if (m.index > last) onGap(text.slice(last, m.index), out);
    onMatch(m, out);
    last = m.index + m[0].length;
  }
  if (last < text.length) onGap(text.slice(last), out);
  return out;
}
