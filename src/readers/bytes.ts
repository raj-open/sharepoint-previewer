// Bytes and texts of binary formats (shared by the readers)

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const utf8 = new TextDecoder();
export const utf16le = new TextDecoder('utf-16le');

// ===========================================================================
// METHODS
// ===========================================================================

export function concatBytes(parts: Uint8Array[]): Uint8Array {
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

export const dataView = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

// Little-endian unsigned 32-bit number at `pos`
export const u32 = (b: Uint8Array, pos: number): number =>
    (b[pos] | (b[pos + 1] << 8) | (b[pos + 2] << 16) | (b[pos + 3] << 24)) >>> 0;

// Characters stored with 1 byte each: Unicode code points up to U+00FF
export function latin1(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i += 8192)
        s += String.fromCharCode.apply(null, b.subarray(i, i + 8192) as unknown as number[]); // typed array as argument list
    return s;
}
