// LZ4 decompression (raw blocks and frames, as in Parquet)

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {Uint8Array} src @param {number} outLen @returns {Uint8Array} */
export function unlz4(src, outLen) {
    const out = new Uint8Array(outLen);
    let ip = 0;
    let op = 0;
    while (ip < src.length) {
        const token = src[ip++];
        let lit = token >> 4;
        if (lit === 15) {
            let b;
            do {
                b = src[ip++];
                lit += b;
            } while (b === 255);
        }
        out.set(src.subarray(ip, ip + lit), op);
        ip += lit;
        op += lit;
        if (ip >= src.length) break;
        const off = src[ip] | (src[ip + 1] << 8);
        ip += 2;
        let m = token & 15;
        if (m === 15) {
            let b;
            do {
                b = src[ip++];
                m += b;
            } while (b === 255);
        }
        m += 4;
        for (let i = 0; i < m; i++, op++) out[op] = out[op - off];
    }
    return out;
}
