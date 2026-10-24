// Bytes and texts of binary formats (shared by the readers)

export const utf8 = new TextDecoder();
export const utf16le = new TextDecoder('utf-16le');

/** @param {Uint8Array[]} parts @returns {Uint8Array} */
export function concatBytes(parts) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** @param {Uint8Array} b @returns {DataView} */
export const dataView = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

// Little-endian unsigned 32-bit number at `pos`
/** @param {Uint8Array} b @param {number} pos @returns {number} */
export const u32 = (b, pos) => (b[pos] | (b[pos + 1] << 8) | (b[pos + 2] << 16) | (b[pos + 3] << 24)) >>> 0;

// Characters stored with 1 byte each: Unicode code points up to U+00FF
/** @param {Uint8Array} b @returns {string} */
export function latin1(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 8192)
    s += String.fromCharCode.apply(null, /** @type {*} */ (b.subarray(i, i + 8192))); // typed array as argument list
  return s;
}
