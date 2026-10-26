// Highlighters: text -> [[cssClass, text], ...]

// ===========================================================================
// IMPORTS
// ===========================================================================

import type { Token } from '../../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

export function tokenise(
    text: string,
    re: RegExp,
    onMatch: (m: RegExpMatchArray, out: Token[]) => void,
    onGap: (s: string, out: Token[]) => void = (s, out) => out.push(['', s]),
): Token[] {
    const out: Token[] = [];
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
