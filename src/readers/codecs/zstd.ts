// Zstandard decompression (RFC 8878): frames with FSE and Huffman tables, no dictionaries (unused by Parquet)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { u32 } from '../bytes.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** Huffman decoding table: symbol and code length by code prefix */
export type HuffmanTable = { symbol: Uint8Array; bits: Uint8Array; maxBits: number };
/** decoder state kept across the blocks of a frame: repeat offsets, last Huffman and sequence tables */
type FrameState = { rep: number[]; huf?: HuffmanTable; ll?: FseTable; of?: FseTable; ml?: FseTable };
export type FseTable = Array<{ symbol: number; nbBits: number; baseline: number }> & { log: number };

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Literal and match length codes: [baseline, extra bits]
const LL_CODES: [number, number][] = [];
for (let c = 0; c < 16; c++) LL_CODES.push([c, 0]);
LL_CODES.push(
    [16, 1],
    [18, 1],
    [20, 1],
    [22, 1],
    [24, 2],
    [28, 2],
    [32, 3],
    [40, 3],
    [48, 4],
    [64, 6],
    [128, 7],
    [256, 8],
    [512, 9],
    [1024, 10],
    [2048, 11],
    [4096, 12],
    [8192, 13],
    [16384, 14],
    [32768, 15],
    [65536, 16],
);
const ML_CODES: [number, number][] = [];
for (let c = 0; c < 32; c++) ML_CODES.push([c + 3, 0]);
ML_CODES.push(
    [35, 1],
    [37, 1],
    [39, 1],
    [41, 1],
    [43, 2],
    [47, 2],
    [51, 3],
    [59, 3],
    [67, 4],
    [83, 4],
    [99, 5],
    [131, 7],
    [259, 8],
    [515, 9],
    [1027, 10],
    [2051, 11],
    [4099, 12],
    [8195, 13],
    [16387, 14],
    [32771, 15],
    [65539, 16],
);

// ===========================================================================
// METHODS
// ===========================================================================

// Backward bitstream (ZSTD Huffman / FSE): from last set bit; past start = 0
function backReader(
    bytes: Uint8Array,
    start: number,
    end: number,
): {
    bit(p: number): number;
    read(n: number): number;
    peek(n: number): number;
    skip(n: number): void;
    overflow(): boolean;
    done(): boolean;
} {
    const last = bytes[end - 1];
    if (!last) throw new Error('ZSTD: damaged bitstream');
    let pos = (end - start - 1) * 8 + (31 - Math.clz32(last)); // just below end marker
    const bit = (p: number) => (p < 0 ? 0 : (bytes[start + (p >> 3)] >> (p & 7)) & 1);

    const take = (p: number, n: number) => {
        let v = 0;
        for (let i = 0; i < n; ) {
            const q = p + i;
            if (q < 0) {
                i++;
                continue;
            }
            const off = q & 7;
            const width = Math.min(8 - off, n - i);
            v += ((bytes[start + (q >> 3)] >> off) & ((1 << width) - 1)) * 2 ** i;
            i += width;
        }
        return v;
    };
    return {
        read(n) {
            pos -= n;
            return n ? take(pos, n) : 0;
        },
        peek(n) {
            return take(pos - n, n);
        },
        skip(n) {
            pos -= n;
        },
        overflow: () => pos < 0,
        done: () => pos === 0,
        bit,
    };
}

// FSE table description (forward bits) -> normalised counts; returns them and position after
function readFseCounts(
    bytes: Uint8Array,
    pos: number,
    maxSymbol: number,
): { counts: number[]; log: number; pos: number } {
    let bitPos = pos * 8;

    const read = (n: number) => {
        let v = 0;
        for (let i = 0; i < n; i++, bitPos++) v |= ((bytes[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
        return v;
    };

    const peek = (n: number) => {
        const keep = bitPos;
        const v = read(n);
        bitPos = keep;
        return v;
    };
    const log = read(4) + 5;
    let remaining = (1 << log) + 1;
    let threshold = 1 << log;
    let nbBits = log + 1;
    const counts = [];
    let previousZero = false;
    while (remaining > 1 && counts.length <= maxSymbol) {
        if (previousZero) {
            let repeat: number;
            do {
                repeat = read(2);
                for (let i = 0; i < repeat; i++) counts.push(0);
            } while (repeat === 3);
        }
        if (counts.length > maxSymbol) break;
        const max = 2 * threshold - 1 - remaining;
        let count: number;
        if (peek(nbBits - 1) < max) {
            count = read(nbBits - 1);
        } else {
            count = read(nbBits);
            if (count >= threshold) count -= max;
        }
        count--;
        remaining -= count < 0 ? -count : count;
        counts.push(count);
        previousZero = count === 0;
        while (remaining < threshold) {
            nbBits--;
            threshold >>= 1;
        }
    }
    if (remaining !== 1) throw new Error('ZSTD: damaged FSE table');
    return { counts, log, pos: (bitPos + 7) >> 3 };
}

// Decode table from normalised counts: { symbol, nbBits, baseline }
function buildFseTable(counts: number[], log: number): FseTable {
    const size = 1 << log;
    const symbols: number[] = new Array(size);
    const next: number[] = [];
    let high = size - 1;
    counts.forEach((c, s) => {
        if (c === -1) {
            symbols[high--] = s;
            next[s] = 1;
        } else {
            next[s] = c;
        }
    });
    const step = (size >> 1) + (size >> 3) + 3;
    let pos = 0;
    counts.forEach((c, s) => {
        for (let i = 0; i < c; i++) {
            symbols[pos] = s;
            do pos = (pos + step) & (size - 1);
            while (pos > high);
        }
    });
    const table: FseTable = Object.assign(new Array(size), { log });
    for (let u = 0; u < size; u++) {
        const s = symbols[u];
        const state = next[s]++;
        const nbBits = log - (31 - Math.clz32(state));
        table[u] = { symbol: s, nbBits, baseline: (state << nbBits) - size };
    }
    return table;
}

// Predefined distributions (RFC 8878, 3.1.1.3.2.2)
const LL_DEFAULT = buildFseTable(
    [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1],
    6,
);
const ML_DEFAULT = buildFseTable(
    [
        1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
    ],
    6,
);
const OF_DEFAULT = buildFseTable(
    [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1],
    5,
);

// Huffman description -> decode table (index = next maxBits bits)
function readHuffmanTable(bytes: Uint8Array, pos: number): { table: HuffmanTable; pos: number } {
    const header = bytes[pos++];
    let weights: number[];
    if (header < 128) {
        // Weights are FSE-compressed, decoded with two interleaved states
        const end = pos + header;
        const { counts, log, pos: at } = readFseCounts(bytes, pos, 255);
        const table = buildFseTable(counts, log);
        const r = backReader(bytes, at, end);
        let s1 = r.read(log);
        let s2 = r.read(log);
        weights = [];

        const step = (s: number) => {
            const e = table[s];
            weights.push(e.symbol);
            return e.baseline + r.read(e.nbBits);
        };
        for (;;) {
            s1 = step(s1);
            if (r.overflow()) {
                weights.push(table[s2].symbol);
                break;
            }
            s2 = step(s2);
            if (r.overflow()) {
                weights.push(table[s1].symbol);
                break;
            }
        }
        pos = end;
    } else {
        // Direct 4-bit weights
        const count = header - 127;
        weights = [];
        for (let i = 0; i < count; i++) {
            const b = bytes[pos + (i >> 1)];
            weights.push(i % 2 ? b & 15 : b >> 4);
        }
        pos += (count + 1) >> 1;
    }

    // Last weight is implied: it makes total power of two
    let total = 0;
    for (const w of weights) if (w) total += 1 << (w - 1);
    const maxBits = 32 - Math.clz32(total);
    const rest = (1 << maxBits) - total;
    weights.push(32 - Math.clz32(rest));

    const size = 1 << maxBits;
    const symbol = new Uint8Array(size);
    const bits = new Uint8Array(size);
    let at = 0;
    for (let w = 1; w <= maxBits; w++) {
        weights.forEach((wt, s) => {
            if (wt !== w) return;
            const len = 1 << (w - 1);
            symbol.fill(s, at, at + len);
            bits.fill(maxBits + 1 - w, at, at + len);
            at += len;
        });
    }
    return { table: { symbol, bits, maxBits }, pos };
}

function huffmanStream(
    bytes: Uint8Array,
    start: number,
    end: number,
    huf: HuffmanTable,
    out: Uint8Array,
    outPos: number,
    count: number,
): void {
    const r = backReader(bytes, start, end);
    const { symbol, bits, maxBits } = huf;
    for (let i = 0; i < count; i++) {
        const idx = r.peek(maxBits);
        out[outPos + i] = symbol[idx];
        r.skip(bits[idx]);
    }
    if (!r.done()) throw new Error('ZSTD: damaged literals');
}

// One compressed block: literals, then sequences that copy literals and earlier output
/** @param st frame state @returns new output position */
function zstdBlock(src: Uint8Array, pos: number, end: number, out: Uint8Array, op: number, st: FrameState): number {
    // --- Literals section ---
    const b0 = src[pos];
    const type = b0 & 3;
    const format = (b0 >> 2) & 3;
    let regen: number;
    let compressed = 0;
    let streams = 1;
    if (type < 2) {
        if (format === 0 || format === 2) {
            regen = b0 >> 3;
            pos += 1;
        } else if (format === 1) {
            regen = (b0 >> 4) + (src[pos + 1] << 4);
            pos += 2;
        } else {
            regen = (b0 >> 4) + (src[pos + 1] << 4) + (src[pos + 2] << 12);
            pos += 3;
        }
    } else {
        const b1 = src[pos + 1];
        const b2 = src[pos + 2];
        if (format < 2) {
            streams = format === 0 ? 1 : 4;
            regen = (b0 >> 4) | ((b1 & 0x3f) << 4);
            compressed = (b1 >> 6) | (b2 << 2);
            pos += 3;
        } else if (format === 2) {
            streams = 4;
            regen = (b0 >> 4) | (b1 << 4) | ((b2 & 3) << 12);
            compressed = (b2 >> 2) | (src[pos + 3] << 6);
            pos += 4;
        } else {
            streams = 4;
            regen = (b0 >> 4) | (b1 << 4) | ((b2 & 0x3f) << 12);
            compressed = (b2 >> 6) | (src[pos + 3] << 2) | (src[pos + 4] << 10);
            pos += 5;
        }
    }

    let literals: Uint8Array;
    if (type === 0) {
        literals = src.subarray(pos, pos + regen);
        pos += regen;
    } else if (type === 1) {
        literals = new Uint8Array(regen).fill(src[pos]);
        pos += 1;
    } else {
        const litEnd = pos + compressed;
        if (type === 2) {
            const t = readHuffmanTable(src, pos);
            st.huf = t.table;
            pos = t.pos;
        } else if (!st.huf) {
            throw new Error('ZSTD: missing Huffman table');
        }
        literals = new Uint8Array(regen);
        if (streams === 1) {
            huffmanStream(src, pos, litEnd, st.huf, literals, 0, regen);
        } else {
            const sizes = [
                src[pos] | (src[pos + 1] << 8),
                src[pos + 2] | (src[pos + 3] << 8),
                src[pos + 4] | (src[pos + 5] << 8),
            ];
            const seg = Math.ceil(regen / 4);
            let at = pos + 6;
            for (let i = 0; i < 4; i++) {
                const size = i < 3 ? sizes[i] : litEnd - at;
                huffmanStream(src, at, at + size, st.huf, literals, i * seg, i < 3 ? seg : regen - 3 * seg);
                at += size;
            }
        }
        pos = litEnd;
    }

    // --- Sequences section ---
    let nbSeq = src[pos++];
    if (nbSeq >= 128) {
        if (nbSeq === 255) {
            nbSeq = src[pos] + (src[pos + 1] << 8) + 0x7f00;
            pos += 2;
        } else {
            nbSeq = ((nbSeq - 128) << 8) + src[pos++];
        }
    }
    let lit = 0;
    if (nbSeq) {
        const modes = src[pos++];

        const table = (mode: number, def: FseTable, maxSymbol: number, key: 'll' | 'of' | 'ml'): FseTable => {
            if (mode === 0) st[key] = def;
            else if (mode === 1) {
                // RLE: every sequence uses same code
                st[key] = Object.assign([{ symbol: src[pos++], nbBits: 0, baseline: 0 }], { log: 0 });
            } else if (mode === 2) {
                const { counts, log, pos: at } = readFseCounts(src, pos, maxSymbol);
                st[key] = buildFseTable(counts, log);
                pos = at;
            }
            const t = st[key];
            if (!t) throw new Error('ZSTD: missing sequence table');
            return t;
        };
        const llT = table(modes >> 6, LL_DEFAULT, 35, 'll');
        const ofT = table((modes >> 4) & 3, OF_DEFAULT, 31, 'of');
        const mlT = table((modes >> 2) & 3, ML_DEFAULT, 52, 'ml');

        const r = backReader(src, pos, end);
        let ll = r.read(llT.log);
        let of = r.read(ofT.log);
        let ml = r.read(mlT.log);
        const rep = st.rep;
        for (let i = 0; i < nbSeq; i++) {
            const ofCode = ofT[of].symbol;
            const [mlBase, mlBits] = ML_CODES[mlT[ml].symbol];
            const [llBase, llBits] = LL_CODES[llT[ll].symbol];
            const ofValue = 2 ** ofCode + r.read(ofCode);
            const matchLen = mlBase + r.read(mlBits);
            const litLen = llBase + r.read(llBits);

            let offset: number;
            if (ofValue > 3) {
                offset = ofValue - 3;
                rep[2] = rep[1];
                rep[1] = rep[0];
                rep[0] = offset;
            } else {
                const idx = ofValue - 1 + (litLen === 0 ? 1 : 0);
                if (idx === 0) {
                    offset = rep[0];
                } else {
                    offset = idx === 3 ? rep[0] - 1 : rep[idx];
                    if (idx !== 1) rep[2] = rep[1];
                    rep[1] = rep[0];
                    rep[0] = offset;
                }
            }

            out.set(literals.subarray(lit, lit + litLen), op);
            op += litLen;
            lit += litLen;
            if (offset > op) throw new Error('ZSTD: damaged match offset');
            for (let k = 0; k < matchLen; k++, op++) out[op] = out[op - offset];

            if (i < nbSeq - 1) {
                ll = llT[ll].baseline + r.read(llT[ll].nbBits);
                ml = mlT[ml].baseline + r.read(mlT[ml].nbBits);
                of = ofT[of].baseline + r.read(ofT[of].nbBits);
            }
        }
    }
    out.set(literals.subarray(lit), op);
    return op + literals.length - lit;
}

export function unzstd(src: Uint8Array, outLen: number): Uint8Array {
    const out = new Uint8Array(outLen);
    let pos = 0;
    let op = 0;
    while (pos < src.length) {
        const magic = u32(src, pos);
        pos += 4;
        if ((magic & 0xfffffff0) === 0x184d2a50) {
            pos += 4 + u32(src, pos); // skippable frame
            continue;
        }
        if (magic !== 0xfd2fb528) throw new Error('ZSTD: not a ZSTD frame');
        const fhd = src[pos++];
        const single = (fhd >> 5) & 1;
        const fcsFlag = fhd >> 6;
        const dictFlag = fhd & 3;
        if (!single) pos++; // window descriptor
        pos += [0, 1, 2, 4][dictFlag];
        pos += [single ? 1 : 0, 2, 4, 8][fcsFlag];
        const st: FrameState = { rep: [1, 4, 8] };
        for (let last = 0; !last; ) {
            const h = src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16);
            pos += 3;
            last = h & 1;
            const type = (h >> 1) & 3;
            const size = h >> 3;
            if (type === 0) {
                out.set(src.subarray(pos, pos + size), op);
                op += size;
                pos += size;
            } else if (type === 1) {
                out.fill(src[pos], op, op + size);
                op += size;
                pos += 1;
            } else if (type === 2) {
                op = zstdBlock(src, pos, pos + size, out, op, st);
                pos += size;
            } else {
                throw new Error('ZSTD: damaged block');
            }
        }
        if ((fhd >> 2) & 1) pos += 4; // checksum (not verified)
    }
    return op === out.length ? out : out.subarray(0, op);
}
