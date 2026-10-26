// Parquet (read only, no library): footer and needed column parts by range, rows as CSV

// ===========================================================================
// IMPORTS
// ===========================================================================

import { utf8 } from '../bytes.ts';

// ===========================================================================
// TYPES
// ===========================================================================

// Thrift (compact protocol): values as decoded, structs keyed by field id
export type ThriftValue =
    | boolean
    | number
    | bigint
    | Uint8Array
    | ThriftValue[]
    | Map<ThriftValue, ThriftValue>
    | ThriftStruct;
export type ThriftStruct = { [id: number]: ThriftValue };

// Parts of the Parquet metadata read here, by Thrift field id (cf. parquet.thrift of the format)
type Count = number | bigint;
type FileMetaData = { 2?: SchemaElementRaw[]; 3?: Count; 4?: RowGroupRaw[]; 6?: Uint8Array };
type SchemaElementRaw = {
    1?: number;
    2?: number;
    3?: number;
    4?: Uint8Array;
    5?: number;
    6?: number;
    7?: number;
    10?: LogicalType;
};
type RowGroupRaw = { 1?: { 3?: ColumnMetaRaw }[]; 3?: Count };
type ColumnMetaRaw = { 4?: number; 5?: Count; 7?: Count; 9?: Count; 11?: Count };
/** time unit (union): 1 ms, 2 µs, 3 ns */
export type TimeUnit = { 1?: ThriftStruct; 2?: ThriftStruct; 3?: ThriftStruct };
/**
 * logical type (union, one field set): 1 string, 4 enum, 5 decimal (1 scale), 6 date, 7 time (2 unit),
 * 8 timestamp (2 unit), 10 integer (2 signed), 12 JSON, 14 UUID
 */
export type LogicalType = {
    1?: ThriftStruct;
    4?: ThriftStruct;
    5?: { 1?: number };
    6?: ThriftStruct;
    7?: { 2?: TimeUnit };
    8?: { 2?: TimeUnit };
    10?: { 2?: boolean };
    12?: ThriftStruct;
    14?: ThriftStruct;
};
/**
 * page header: 1 type (0 data, 2 dictionary, 3 data v2), 2 uncompressed / 3 compressed size,
 * 5 data (1 values, 2 encoding), 7 dictionary (1 values),
 * 8 data v2 (1 values, 4 encoding, 5 / 6 definition / repetition levels' length, 7 compressed)
 */
export type PageHeader = {
    1: number;
    2: number;
    3: number;
    5?: DataPageHeader;
    7?: { 1: number };
    8?: DataPageHeader;
};
export type DataPageHeader = { 1: number; 2?: number; 4?: number; 5?: number; 6?: number; 7?: boolean };

// Schema element (repetition: 0 required, 1 optional, 2 repeated)
export type SchemaElement = {
    type?: number;
    typeLength?: number;
    repetition?: number;
    name: string;
    children: number;
    converted?: number;
    scale?: number;
    logical?: LogicalType;
};
// Leaf column with path and nesting depth (definition / repetition levels)
export type Column = SchemaElement & { path: string[]; maxDef: number; maxRep: number };
export type ColumnChunk = {
    codec: number;
    numValues: number;
    size: number;
    dataOffset: number;
    dictOffset: number | null;
};
// Value as decoded from a page; cell of a row: null, value, or list (repeated column)
export type ParquetValue = boolean | number | bigint | Date | Uint8Array;
export type Cell = ParquetValue | null | Cell[];
export type Footer = {
    createdBy: string;
    numRows: number;
    schema: SchemaElement[];
    rowGroups: { numRows: number; columns: ColumnChunk[] }[];
};

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const PARQUET_RE = /\.parquet$/i;
export const CODEC_NAMES = ['none', 'SNAPPY', 'GZIP', 'LZO', 'BROTLI', 'LZ4', 'ZSTD', 'LZ4_RAW'];

// ===========================================================================
// METHODS
// ===========================================================================

// Thrift compact protocol (Parquet metadata): structs keyed by field id
export function thriftReader(bytes: Uint8Array, start = 0): { struct: () => ThriftStruct; pos: () => number } {
    let pos = start;

    const byte = () => {
        if (pos >= bytes.length) throw new RangeError('end of data');
        return bytes[pos++];
    };

    const varint = () => {
        let r = 0n;
        let shift = 0n;
        let b: number;
        do {
            b = byte();
            r |= BigInt(b & 0x7f) << shift;
            shift += 7n;
        } while (b & 0x80);
        return r;
    };
    const zigzag = (n: bigint) => (n >> 1n) ^ -(n & 1n);
    const small = (n: bigint) => (n >= -(2n ** 53n) && n <= 2n ** 53n ? Number(n) : n);

    function value(type: number): ThriftValue {
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
                const out: ThriftValue[] = [];
                for (let i = 0; i < size; i++) out.push(elem === 1 || elem === 2 ? byte() === 1 : value(elem));
                return out;
            }
            case 11: {
                const size = Number(varint());
                const out = new Map<ThriftValue, ThriftValue>();
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

    function struct(): ThriftStruct {
        const out: ThriftStruct = {};
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

export function parseFooter(bytes: Uint8Array): Footer {
    const m = thriftReader(bytes).struct() as FileMetaData; // shape per the format
    const text = (b?: Uint8Array) => (b ? utf8.decode(b) : '');
    return {
        createdBy: m[6] ? text(m[6]) : '',
        numRows: Number(m[3] || 0),
        schema: (m[2] || []).map((e) => ({
            type: e[1],
            typeLength: e[2],
            repetition: e[3],
            name: text(e[4]),
            children: e[5] || 0,
            converted: e[6],
            scale: e[7],
            logical: e[10],
        })),
        rowGroups: (m[4] || []).map((rg) => ({
            numRows: Number(rg[3] || 0),
            columns: (rg[1] || []).map((c) => {
                const md: ColumnMetaRaw = c[3] || {};
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
/** @returns leaf columns with path, maxDef, maxRep */
export function leafColumns(schema: SchemaElement[]): Column[] {
    const leaves: Column[] = [];
    let i = 1;

    const walk = (path: string[], maxDef: number, maxRep: number, count: number) => {
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

export const bitWidth = (max: number): number => 32 - Math.clz32(max);
