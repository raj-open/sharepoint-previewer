// XML without DOM (also for huge sheets; DOMParser builds the whole tree)

// ===========================================================================
// CONSTANTS
// ===========================================================================

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const SHEET_ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// ===========================================================================
// METHODS
// ===========================================================================

// Line ends as XML reads them (\r\n -> \n), entities decoded
export const xmlText = (s: string): string => xmlEntities(s.includes('\r') ? s.replace(/\r\n?/g, '\n') : s);

const xmlEntities = (s: string): string =>
    s.includes('&')
        ? s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
              if (e[0] !== '#') return XML_ENTITIES[e] ?? m;
              const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1));
              return code <= 0x10ffff ? String.fromCodePoint(code) : m;
          })
        : s;

// OOXML escapes characters XML cannot hold: _x000D_ = carriage return
export const ooxmlText = (s: string): string =>
    s.includes('_x') ? s.replace(/_x([\da-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : s;

// Attributes, names without namespace prefix
export function xmlAttrs(s: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of s.matchAll(SHEET_ATTR_RE)) out[m[1].slice(m[1].indexOf(':') + 1)] = xmlText(m[2] ?? m[3]);
    return out;
}

// Tags (names without prefix) and raw text between them; empty tags open and close at once
/**
 * @param text raw (entities not decoded)
 */
export function scanXml(
    xml: string,
    open: (name: string, attrs: string) => void,
    close: (name: string) => void,
    text?: (raw: string) => void,
) {
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

export function xmlString(b: Uint8Array): string {
    const bom = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : 'utf-8';
    return new TextDecoder(bom).decode(b);
}
