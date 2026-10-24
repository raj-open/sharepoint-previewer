// --- XML without DOM (also for huge sheets; DOMParser builds the whole tree) ---

/** @type {Object<string, string>} */
const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

// Line ends as XML reads them (\r\n -> \n), entities decoded
/** @param {string} s @returns {string} */
export const xmlText = (s) => xmlEntities(s.includes('\r') ? s.replace(/\r\n?/g, '\n') : s);

/** @param {string} s @returns {string} */
const xmlEntities = (s) =>
  s.includes('&')
    ? s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
        if (e[0] !== '#') return XML_ENTITIES[e] ?? m;
        const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return code <= 0x10ffff ? String.fromCodePoint(code) : m;
      })
    : s;

// OOXML escapes characters XML cannot hold: _x000D_ = carriage return
/** @param {string} s @returns {string} */
export const ooxmlText = (s) =>
  s.includes('_x') ? s.replace(/_x([\da-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : s;

const SHEET_ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// Attributes, names without namespace prefix
/** @param {string} s @returns {Object<string, string>} */
export function xmlAttrs(s) {
  /** @type {Object<string, string>} */
  const out = {};
  for (const m of s.matchAll(SHEET_ATTR_RE)) out[m[1].slice(m[1].indexOf(':') + 1)] = xmlText(m[2] ?? m[3]);
  return out;
}

// Tags (names without prefix) and raw text between them; empty tags open and close at once
/**
 * @param {string} xml @param {(name: string, attrs: string) => void} open
 * @param {(name: string) => void} close @param {(raw: string) => void} [text] raw (entities not decoded)
 */
export function scanXml(xml, open, close, text) {
  const re = /<(\/?)([^\s/>!?]+)([^>]*?)(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[!?][^>]*>/g;
  let last = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (text && m.index > last) text(xml.slice(last, m.index));
    last = re.lastIndex;
    if (m[5] !== undefined) {
      if (text) text(m[5].replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'))); // raw like other text
      continue;
    }
    if (!m[2]) continue; // comment, declaration
    const name = m[2].slice(m[2].indexOf(':') + 1);
    if (m[1]) close(name);
    else {
      open(name, m[3]);
      if (m[4]) close(name);
    }
  }
}

/** @param {Uint8Array} b @returns {string} */
export function xmlString(b) {
  const bom = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(bom).decode(b);
}
