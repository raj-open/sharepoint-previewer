// XPress9 decompression (Power BI data models): LZ77 with Huffman codes, blocks of a session sharing their history.
// Ported from Microsoft's XPress9 sources (decoder only).
// Copyright (c) Microsoft Corporation. Licensed under the MIT License.

// ===========================================================================
// TYPES
// ===========================================================================

/** Huffman decoder of one alphabet: fast table for short codes, canonical search for long ones */
type Huffman = {
    table: Int32Array; // (symbol << 5) | length, 0: longer than FAST_BITS
    counts: Uint16Array; // codes per length
    symbols: Uint16Array; // by length, then by symbol
    single: number; // the only symbol (consumes its length), else -1
    singleLength: number;
};

// ===========================================================================
// CONSTANTS
// ===========================================================================

const BLOCK_MAGIC = 0x4e86d72a; // block header
const HEADER_BYTES = 32;
const MAX_CODEWORD_LENGTH = 27;
const MAX_SHORT_LENGTH_LOG = 4;
const MAX_SHORT_LENGTH = 1 << MAX_SHORT_LENGTH_LOG; // also the fill boundary of the length tables
const MAX_WINDOW_SIZE_LOG = 24;
const MAX_MTF = 4;
const LONG_LENGTH_ALPHABET_SIZE = 1 << 8;
const MAX_LONG_LENGTH = LONG_LENGTH_ALPHABET_SIZE - MAX_WINDOW_SIZE_LOG;
const SHORT_SYMBOL_ALPHABET_SIZE = 256 + ((MAX_WINDOW_SIZE_LOG + MAX_MTF) << MAX_SHORT_LENGTH_LOG);

// Small table (lengths of the length tables): codes beyond the codeword lengths
const TABLE_FILL = MAX_CODEWORD_LENGTH + 1; // zeros up to the fill boundary
const TABLE_ZERO_REPT = MAX_CODEWORD_LENGTH + 2; // zeros, k times
const TABLE_PREV = MAX_CODEWORD_LENGTH + 3; // as the previous one
const TABLE_ROW_0 = MAX_CODEWORD_LENGTH + 4; // as one row (fill boundary) before
const TABLE_ROW_1 = MAX_CODEWORD_LENGTH + 5; // one more than one row before
const TABLE_SIZE = MAX_CODEWORD_LENGTH + 6;
const ZERO_REPT_MIN = 5;

const FAST_BITS = 12;

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------
// Session
// ---------------------------------------------------------------

/**
 * Decoder of one session: blocks decoded in order, each may refer back to the output of those before.
 * @param capacity expected total output (grows if needed)
 */
export function xpress9Session(capacity = 1 << 20) {
    let out = new Uint8Array(capacity);
    let size = 0;

    /** @returns the output of the blocks in `data` (whole blocks only) */
    function decode(data: Uint8Array): Uint8Array {
        const start = size;
        let at = 0;
        while (at + HEADER_BYTES <= data.length) {
            const view = new DataView(data.buffer, data.byteOffset + at, HEADER_BYTES);
            const word = (i: number) => view.getUint32(i * 4, true);
            if (word(0) !== BLOCK_MAGIC) throw new Error('XPress9: bad block header');
            const origSize = word(1);
            const encodedBits = word(2);
            const flags = word(3);
            if (flags >>> 20 !== 0 || word(4) !== 0) throw new Error('XPress9: bad block flags');
            const bytes = Math.ceil(encodedBits / 8);
            if (at + bytes > data.length) throw new Error('XPress9: block cut off');
            grow(size + origSize);
            decodeBlock(data.subarray(at, at + bytes), encodedBits, flags, origSize);
            at += bytes;
        }
        return out.subarray(start, size);
    }

    function grow(need: number) {
        if (need <= out.length) return;
        const next = new Uint8Array(Math.max(need, out.length * 2));
        next.set(out.subarray(0, size));
        out = next;
    }

    function decodeBlock(block: Uint8Array, encodedBits: number, flags: number, origSize: number) {
        const tableBits = flags & 0x1fff;
        const windowLog = ((flags >>> 13) & 7) + 16;
        const mtfCount = ((flags >>> 16) & 3) << 1;
        const ptrMin = ((flags >>> 18) & 1) + 3;
        const mtfMin = ((flags >>> 19) & 1) + 2;
        if (mtfCount > MAX_MTF) throw new Error('XPress9: bad MTF count');
        const bits = bitReader(block, HEADER_BYTES);

        // State: MTF offsets, then the two Huffman tables
        let lastPtr = 0;
        const mtf = [0, 0, 0, 0];
        if (mtfCount > 0) {
            lastPtr = bits.read(1);
            for (let i = 0; i < mtfCount; i++) {
                const msb = bits.read(5);
                if (msb >= windowLog) throw new Error('XPress9: bad MTF offset');
                mtf[i] = bits.read(msb) + 2 ** msb;
            }
        }
        const short = huffman(lengthTable(bits, SHORT_SYMBOL_ALPHABET_SIZE));
        const long = huffman(lengthTable(bits, LONG_LENGTH_ALPHABET_SIZE));
        if (bits.consumed() !== tableBits) throw new Error('XPress9: bad Huffman tables');

        // LZ77: literals, pointers (offset given) and MTF pointers (offset of a recent one)
        const end = size + origSize;
        let pos = size;
        while (pos < end) {
            let symbol = decodeSymbol(bits, short);
            if (symbol < 256) {
                out[pos++] = symbol;
                lastPtr = 0;
                continue;
            }
            symbol -= 256;
            let length = symbol & (MAX_SHORT_LENGTH - 1);
            symbol >>>= MAX_SHORT_LENGTH_LOG;
            if (length === MAX_SHORT_LENGTH - 1) {
                length = decodeSymbol(bits, long);
                if (length >= MAX_LONG_LENGTH) {
                    const extra = length - MAX_LONG_LENGTH;
                    length = bits.read(extra) + 2 ** extra + MAX_LONG_LENGTH - 1;
                }
                length += MAX_SHORT_LENGTH - 1;
            }
            let offset: number;
            if (symbol < mtfCount) {
                length += mtfMin;
                const k = lastPtr ? symbol + 1 : symbol; // after a pointer, its offset is not offered again
                if (k >= mtfCount) throw new Error('XPress9: bad MTF pointer');
                offset = mtf[k];
                for (let i = k; i > 0; i--) mtf[i] = mtf[i - 1]; // to the front
                mtf[0] = offset;
            } else {
                length += ptrMin;
                const msb = symbol - mtfCount;
                offset = bits.read(msb) + 2 ** msb;
                for (let i = mtfCount - 1; i > 0; i--) mtf[i] = mtf[i - 1];
                if (mtfCount) mtf[0] = offset;
            }
            lastPtr = 1;
            if (offset > pos || pos + length > end) throw new Error('XPress9: bad pointer');
            for (let from = pos - offset, stop = pos + length; pos < stop; ) out[pos++] = out[from++];
        }
        if (bits.consumed() + HEADER_BYTES * 8 !== encodedBits) throw new Error('XPress9: bad block length');
        size = end;
    }

    return { decode, output: () => out.subarray(0, size) };
}

// ---------------------------------------------------------------
// Bits and Huffman codes
// ---------------------------------------------------------------

/** least significant bit first, from `from` (bytes past the end read as 0) */
function bitReader(data: Uint8Array, from: number) {
    let at = from;
    let buffer = 0;
    let count = 0;
    const fill = () => {
        while (count <= 24) {
            buffer |= (at < data.length ? data[at] : 0) << count;
            at++;
            count += 8;
        }
    };
    return {
        peek(n: number): number {
            fill();
            return n === 32 ? buffer >>> 0 : buffer & ((1 << n) - 1);
        },
        skip(n: number) {
            buffer >>>= n;
            count -= n;
        },
        read(n: number): number {
            if (n === 0) return 0;
            if (n > 24) {
                const low = this.read(16);
                return low + this.read(n - 16) * 65536;
            }
            fill();
            const v = buffer & ((1 << n) - 1);
            buffer >>>= n;
            count -= n;
            return v;
        },
        consumed: () => (at - from) * 8 - count,
    };
}

// Codeword lengths of an alphabet: "stored" (all about equal), or coded by a small Huffman table
function lengthTable(bits: ReturnType<typeof bitReader>, alphabet: number): Uint8Array {
    const lengths = new Uint8Array(alphabet);
    const kind = bits.read(3);
    if (kind === 0) {
        const msb = 31 - Math.clz32(alphabet);
        const shorter = 2 ** (msb + 1) - alphabet;
        lengths.fill(msb, 0, shorter);
        lengths.fill(msb + 1, shorter);
        return lengths;
    }
    if (kind !== 1) throw new Error('XPress9: unknown Huffman table coding');

    // Small table: its lengths as 1 bit (same as before) or 4 bits
    const small = new Uint8Array(TABLE_SIZE);
    let prev = 4;
    for (let i = 0; i < TABLE_SIZE; i++) {
        if (bits.read(1) === 0) small[i] = prev;
        else {
            let k = bits.read(3);
            if (k >= prev) k++;
            if (k > 8) throw new Error('XPress9: bad small table');
            small[i] = prev = k;
        }
    }
    const code = huffman(small);
    prev = 8;
    for (let i = 0; i < alphabet; ) {
        const symbol = decodeSymbol(bits, code);
        switch (symbol) {
            case TABLE_FILL:
                do lengths[i++] = 0;
                while (i % MAX_SHORT_LENGTH !== 0 && i < alphabet);
                break;

            case TABLE_ZERO_REPT: {
                let k = bits.read(2);
                let n = k + ZERO_REPT_MIN;
                if (k === 3) {
                    do {
                        k = bits.read(3);
                        n += k;
                    } while (k === 7);
                }
                if (i + n > alphabet || (i ^ (i + n)) >= MAX_SHORT_LENGTH) throw new Error('XPress9: bad zero run');
                lengths.fill(0, i, i + n);
                i += n;
                break;
            }

            case TABLE_PREV:
                lengths[i++] = prev;
                break;

            case TABLE_ROW_0:
            case TABLE_ROW_1: {
                if (i < MAX_SHORT_LENGTH) throw new Error('XPress9: bad row reference');
                const length = lengths[i - MAX_SHORT_LENGTH] + (symbol === TABLE_ROW_1 ? 1 : 0);
                if (length === 0 || length > MAX_CODEWORD_LENGTH) throw new Error('XPress9: bad row length');
                lengths[i++] = prev = length;
                break;
            }

            default:
                if (symbol > MAX_CODEWORD_LENGTH) throw new Error('XPress9: bad codeword length');
                lengths[i++] = symbol;
                if (symbol !== 0) prev = symbol;
        }
    }
    return lengths;
}

// Canonical code: shorter codes first, by symbol within a length; read first bit first (most significant)
function huffman(lengths: Uint8Array): Huffman {
    const counts = new Uint16Array(MAX_CODEWORD_LENGTH + 1);
    let used = 0;
    let last = -1;
    for (let s = 0; s < lengths.length; s++) {
        if (lengths[s]) {
            counts[lengths[s]]++;
            used++;
            last = s;
        }
    }
    if (used === 0) throw new Error('XPress9: empty Huffman table');
    const table = new Int32Array(1 << FAST_BITS);
    if (used === 1) return { table, counts, symbols: new Uint16Array(0), single: last, singleLength: lengths[last] };

    // complete code: every node has two children
    let left = 1;
    for (let len = 1; len <= MAX_CODEWORD_LENGTH; len++) {
        left = left * 2 - counts[len];
        if (left < 0) throw new Error('XPress9: Huffman code over-subscribed');
    }
    if (left !== 0) throw new Error('XPress9: Huffman code incomplete');

    const offsets = new Uint32Array(MAX_CODEWORD_LENGTH + 2);
    for (let len = 1; len <= MAX_CODEWORD_LENGTH; len++) offsets[len + 1] = offsets[len] + counts[len];
    const symbols = new Uint16Array(used);
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offsets[lengths[s]]++] = s;

    // fast table: codes up to FAST_BITS long, indexed by their bits as read (reversed)
    let code = 0;
    let index = 0;
    for (let len = 1; len <= FAST_BITS; len++) {
        for (let k = 0; k < counts[len]; k++, code++, index++) {
            let reversed = 0;
            for (let b = 0; b < len; b++) reversed |= ((code >>> b) & 1) << (len - 1 - b);
            for (let fill = reversed; fill < 1 << FAST_BITS; fill += 1 << len) {
                table[fill] = (symbols[index] << 5) | len;
            }
        }
        code <<= 1;
    }
    return { table, counts, symbols, single: -1, singleLength: 0 };
}

function decodeSymbol(bits: ReturnType<typeof bitReader>, h: Huffman): number {
    if (h.single >= 0) {
        bits.skip(h.singleLength);
        return h.single;
    }
    const entry = h.table[bits.peek(FAST_BITS)];
    if (entry) {
        bits.skip(entry & 31);
        return entry >>> 5;
    }
    // longer code: one bit at a time (canonical order)
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_CODEWORD_LENGTH; len++) {
        code |= bits.read(1);
        const count = h.counts[len];
        if (code - first < count) return h.symbols[index + code - first];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
    }
    throw new Error('XPress9: bad Huffman code');
}
