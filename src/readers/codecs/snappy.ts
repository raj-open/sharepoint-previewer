// Decompression (Snappy, LZ4 raw and ZSTD are built in; GZIP uses browser)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { u32 } from '../bytes.ts';

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {Uint8Array} src @returns {Uint8Array} */
export function unsnappy(src) {
    let pos = 0;
    let len = 0;
    let shift = 0;
    let b;
    do {
        b = src[pos++];
        len += (b & 0x7f) * 2 ** shift;
        shift += 7;
    } while (b & 0x80);
    const out = new Uint8Array(len);
    let op = 0;
    while (pos < src.length) {
        const tag = src[pos++];
        const kind = tag & 3;
        if (kind === 0) {
            let n = tag >> 2;
            if (n >= 60) {
                const bytes = n - 59;
                n = 0;
                for (let i = 0; i < bytes; i++) n += src[pos++] * 2 ** (8 * i);
            }
            n += 1;
            out.set(src.subarray(pos, pos + n), op);
            pos += n;
            op += n;
            continue;
        }
        let n;
        let off;
        if (kind === 1) {
            n = ((tag >> 2) & 7) + 4;
            off = ((tag >> 5) << 8) | src[pos++];
        } else if (kind === 2) {
            n = (tag >> 2) + 1;
            off = src[pos] | (src[pos + 1] << 8);
            pos += 2;
        } else {
            n = (tag >> 2) + 1;
            off = u32(src, pos);
            pos += 4;
        }
        for (let i = 0; i < n; i++, op++) out[op] = out[op - off];
    }
    return out;
}
