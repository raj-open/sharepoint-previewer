// Parquet (read only, no library): footer and needed column parts by range, rows as CSV

// ===========================================================================
// IMPORTS
// ===========================================================================

import { utf8 } from '../bytes.js';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const PARQUET_RE = /\.parquet$/i;
export const CODEC_NAMES = ['none', 'SNAPPY', 'GZIP', 'LZO', 'BROTLI', 'LZ4', 'ZSTD', 'LZ4_RAW'];

// ===========================================================================
// METHODS
// ===========================================================================

// Thrift compact protocol (Parquet metadata): structs keyed by field id
/** @param {Uint8Array} bytes @param {number} [start] @returns {{ struct: () => Object<number, *>, pos: () => number }} */
export function thriftReader(bytes, start = 0) {
    let pos = start;

    const byte = () => {
        if (pos >= bytes.length) throw new RangeError('end of data');
        return bytes[pos++];
    };

    const varint = () => {
        let r = 0n;
        let shift = 0n;
        let b;
        do {
            b = byte();
            r |= BigInt(b & 0x7f) << shift;
            shift += 7n;
        } while (b & 0x80);
        return r;
    };
    /** @param {bigint} n */
    const zigzag = (n) => (n >> 1n) ^ -(n & 1n);
    /** @param {bigint} n */
    const small = (n) => (n >= -(2n ** 53n) && n <= 2n ** 53n ? Number(n) : n);

    /** @param {number} type @returns {*} */
    function value(type) {
        switch (type) {
            case 1:
                return true;
            case 2:
                return false;
            case 3: {
                const b = byte();
                return b > 127 ? b - 256 : b;
            }
            case 4:
            case 5:
            case 6:
                return small(zigzag(varint()));
            case 7: {
                if (pos + 8 > bytes.length) throw new RangeError('end of data');
                const v = new DataView(bytes.buffer, bytes.byteOffset + pos, 8).getFloat64(0, true);
                pos += 8;
                return v;
            }
            case 8: {
                const len = Number(varint());
                if (pos + len > bytes.length) throw new RangeError('end of data');
                const v = bytes.subarray(pos, pos + len);
                pos += len;
                return v;
            }
            case 9:
            case 10: {
                const h = byte();
                let size = h >> 4;
                const elem = h & 15;
                if (size === 15) size = Number(varint());
                const out = [];
                for (let i = 0; i < size; i++) out.push(elem === 1 || elem === 2 ? byte() === 1 : value(elem));
                return out;
            }
            case 11: {
                const size = Number(varint());
                const out = new Map();
                if (size) {
                    const kv = byte();
                    for (let i = 0; i < size; i++) out.set(value(kv >> 4), value(kv & 15));
                }
                return out;
            }
            case 12:
                return struct();
            default:
                throw new Error(`unknown Thrift type ${type}`);
        }
    }

    /** @returns {Object<number, *>} */
    function struct() {
        /** @type {Object<number, *>} */
        const out = {};
        let id = 0;
        for (;;) {
            const h = byte();
            if (h === 0) return out;
            const delta = h >> 4;
            id = delta ? id + delta : Number(zigzag(varint()));
            out[id] = value(h & 15);
        }
    }

    return { struct, pos: () => pos };
}

/** @param {Uint8Array} bytes @returns {{ createdBy: string, numRows: number, schema: Object<string, *>[], rowGroups: { numRows: number, columns: Object<string, *>[] }[] }} */
export function parseFooter(bytes) {
    const m = thriftReader(bytes).struct();
    /** @param {Uint8Array} [b] */
    const text = (b) => (b ? utf8.decode(b) : '');
    return {
        createdBy: m[6] ? text(m[6]) : '',
        numRows: Number(m[3] || 0),
        schema: (m[2] || []).map((/** @type {Object<number, *>} */ e) => ({
            type: e[1],
            typeLength: e[2],
            repetition: e[3],
            name: text(e[4]),
            children: e[5] || 0,
            converted: e[6],
            scale: e[7],
            logical: e[10],
        })),
        rowGroups: (m[4] || []).map((/** @type {Object<number, *>} */ rg) => ({
            numRows: Number(rg[3] || 0),
            columns: (rg[1] || []).map((/** @type {Object<number, *>} */ c) => {
                const md = c[3] || {};
                return {
                    codec: md[4] || 0,
                    numValues: Number(md[5] || 0),
                    size: Number(md[7] || 0),
                    dataOffset: Number(md[9] || 0),
                    dictOffset: md[11] != null ? Number(md[11]) : null,
                };
            }),
        })),
    };
}

// Leaf columns with their nesting depth (definition / repetition levels)
/** @param {Object<string, *>[]} schema @returns {Object<string, *>[]} leaf columns with path, maxDef, maxRep */
export function leafColumns(schema) {
    /** @type {Object<string, *>[]} */
    const leaves = [];
    let i = 1;

    /** @param {string[]} path @param {number} maxDef @param {number} maxRep @param {number} count */
    const walk = (path, maxDef, maxRep, count) => {
        for (let k = 0; k < count && i < schema.length; k++) {
            const e = schema[i++];
            const def = maxDef + (e.repetition ? 1 : 0); // OPTIONAL (1) and REPEATED (2) add level
            const rep = maxRep + (e.repetition === 2 ? 1 : 0);
            const p = [...path, e.name];
            if (e.children) walk(p, def, rep, e.children);
            else leaves.push({ ...e, path: p, maxDef: def, maxRep: rep });
        }
    };
    walk([], 0, 0, schema[0] ? schema[0].children : 0);
    return leaves;
}

/** @param {number} max @returns {number} */
export const bitWidth = (max) => 32 - Math.clz32(max);
