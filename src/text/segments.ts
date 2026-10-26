// Message segments: text, JSON and Python-like literals (dicts, lists, tuples) found in a message

// ===========================================================================
// CONSTANTS
// ===========================================================================

const MAX_CHARS = 200000; // longer messages: one text segment
const OPEN = '{[(';
const CLOSE = '}])';
// Python literal tokens: strings, words, punctuation, spaces
const PY_TOKEN_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}[\](),:]|[^\s"'{}[\](),:]+|\s+/gy;
// JSON tokens for indenting: strings, punctuation, other
const JSON_TOKEN_RE = /"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s"{}[\],:]+|\s+/gy;

/** @typedef {{ kind: 'text'|'json'|'python', text: string }} Segment text; json: as in the message; python: converted to JSON */

// ===========================================================================
// METHODS
// ===========================================================================

// Message -> segments in order; objects and lists start at { or [ (not after a letter, e.g. sshd[123])
/** @param {string} text @returns {Segment[]} */
export function segments(text) {
    /** @type {Segment[]} */
    const out = [];
    if (text.length > MAX_CHARS) return [{ kind: 'text', text }];
    let from = 0; // start of pending text
    for (let i = 0; i < text.length; i++) {
        if ((text[i] !== '{' && text[i] !== '[') || /\w/.test(text[i - 1] ?? '')) continue;
        const end = closing(text, i);
        if (end < 0) continue;
        const part = text.slice(i, end);
        const found = /^.\s*.$/.test(part) ? null : asJson(part); // {} and [] stay text
        if (!found) continue;
        if (text.slice(from, i).trim()) out.push({ kind: 'text', text: text.slice(from, i) });
        out.push(found);
        from = end;
        i = end - 1;
    }
    if (text.slice(from).trim() || !out.length) out.push({ kind: 'text', text: text.slice(from) });
    return out;
}

// JSON indented by 2 spaces; values (numbers, strings) kept as written
/** @param {string} json @returns {string} */
export function indentJson(json) {
    const tokens = [...json.matchAll(JSON_TOKEN_RE)].map((m) => m[0]).filter((t) => t.trim());
    let out = '';
    let depth = 0;
    const nl = () => `\n${'  '.repeat(depth)}`;
    tokens.forEach((t, k) => {
        if (t === '{' || t === '[') {
            const empty = tokens[k + 1] === (t === '{' ? '}' : ']');
            out += t;
            if (!empty) {
                depth++;
                out += nl();
            }
        } else if (t === '}' || t === ']') {
            const empty = tokens[k - 1] === (t === '}' ? '{' : '[');
            if (!empty) {
                depth--;
                out += nl();
            }
            out += t;
        } else if (t === ',') out += `,${nl()}`;
        else if (t === ':') out += ': ';
        else out += t;
    });
    return out;
}

// ===========================================================================
// AUXILIARY METHODS
// ===========================================================================

// End (exclusive) of the bracket opened at i, quotes respected; -1 if not closed
/** @param {string} text @param {number} i @returns {number} */
function closing(text, i) {
    const stack = [];
    for (let k = i; k < text.length; k++) {
        const c = text[k];
        if (c === '"' || c === "'") {
            const end = text.indexOf(c, k + 1);
            let e = end;
            while (e > 0 && text[e - 1] === '\\') e = text.indexOf(c, e + 1);
            if (e < 0) return -1;
            k = e;
        } else if (OPEN.includes(c)) stack.push(CLOSE[OPEN.indexOf(c)]);
        else if (CLOSE.includes(c)) {
            if (stack.pop() !== c) return -1;
            if (!stack.length) return k + 1;
        }
    }
    return -1;
}

// Object or list as JSON (as is) or as Python literal (converted); null: neither
/** @param {string} part @returns {Segment|null} */
function asJson(part) {
    try {
        JSON.parse(part);
        return { kind: 'json', text: part };
    } catch {}
    const json = fromPython(part);
    return json ? { kind: 'python', text: json } : null;
}

// Python literal -> JSON: quotes, True / False / None, tuples as lists, trailing commas; null if not valid
/** @param {string} part @returns {string|null} */
function fromPython(part) {
    /** @type {string[]} */
    const out = [];
    PY_TOKEN_RE.lastIndex = 0;
    let m = PY_TOKEN_RE.exec(part);
    while (m) {
        const t = m[0];
        if (t.startsWith("'")) out.push(JSON.stringify(t.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')));
        else if (t === 'True' || t === 'False' || t === 'None')
            out.push({ True: 'true', False: 'false', None: 'null' }[t]);
        else if (t === '(' || t === ')') out.push(t === '(' ? '[' : ']');
        else if (t.trim()) out.push(t);
        if (/^[}\]]$/.test(out[out.length - 1]) && out[out.length - 2] === ',') out.splice(out.length - 2, 1); // trailing comma
        m = PY_TOKEN_RE.exec(part);
    }
    const json = out.join('');
    try {
        JSON.parse(json);
        return json;
    } catch {
        return null;
    }
}
