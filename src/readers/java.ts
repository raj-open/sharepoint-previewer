// Java serialisation streams (`java.io.ObjectOutputStream`): object graph read in full, as plain values (read only)
// Grammar: https://docs.oracle.com/javase/8/docs/platform/serialization/spec/protocol.html

// ===========================================================================
// IMPORTS
// ===========================================================================

import { dataView } from './bytes.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** class description: name, flags (SC_*), fields (type code, name), its superclass */
type JavaClass = { name: string; flags: number; fields: [string, string][]; parent: JavaClass | null };
/** object or array; fields: (class declaring it, name, value); `data`: what the class wrote itself
 * (writeObject, Externalizable; byte[]: its bytes); refs: times referred to */
export type JavaNode = {
    cls: string;
    fields: [string, string, JavaValue][];
    items: JavaValue[] | null;
    data: JavaValue[];
    refs: number;
};
export type JavaValue =
    | null
    | boolean
    | number
    | bigint
    | string
    | JavaNode
    | { enum: string; cls: string }
    | { classOf: string }
    | { block: Uint8Array };
/** top-level values, and per class the number of objects */
export type JavaStream = { roots: JavaValue[]; classes: Map<string, number>; strings: string[] };

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const JAVA_MAGIC = [0xac, 0xed, 0x00, 0x05]; // STREAM_MAGIC, STREAM_VERSION
const BASE_HANDLE = 0x7e0000;
const SC_WRITE_METHOD = 0x01;
const SC_SERIALIZABLE = 0x02;
const SC_EXTERNALIZABLE = 0x04;
const SC_BLOCK_DATA = 0x08;
const MAX_JAVA_DEPTH = 2000; // nesting (deeper graphs: refused, not a stack overflow)
const SHOWN_BLOCK = 16; // bytes of a block shown (as hex), larger: size only
// Collections of Java itself: data written as key, value, key, value, … (maps), or the elements (others);
// sorted sets: their comparator first
const MAP_RE = /^java\.util\.(?:concurrent\.)?\w*(?:Map|Hashtable|Properties)$/;
const LIST_RE = /^java\.util\.(?:concurrent\.)?\w*(?:List|Set|Vector|Stack|Queue|Deque)$/;
const SORTED_RE = /(?:TreeSet|SkipListSet)$/;
const BOXED_RE = /^java\.lang\.(?:Integer|Long|Short|Byte|Double|Float|Boolean|Character)$/; // shown as the value

// Type codes of fields and arrays: primitive reads (size, read)
const PRIMITIVES: Record<string, [number, (d: DataView, at: number) => JavaValue]> = {
    B: [1, (d, at) => d.getInt8(at)],
    C: [2, (d, at) => String.fromCharCode(d.getUint16(at))],
    D: [8, (d, at) => d.getFloat64(at)],
    F: [4, (d, at) => d.getFloat32(at)],
    I: [4, (d, at) => d.getInt32(at)],
    J: [8, (d, at) => d.getBigInt64(at)],
    S: [2, (d, at) => d.getInt16(at)],
    Z: [1, (d, at) => d.getUint8(at) !== 0],
};

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const isJava = (b: Uint8Array): boolean => JAVA_MAGIC.every((x, i) => b[i] === x);

// Whole stream: all top-level values (one per writeObject); throws with the position on damaged or unknown data
export function readJava(bytes: Uint8Array): JavaStream {
    if (!isJava(bytes)) throw new Error('not a Java serialisation stream');
    const d = dataView(bytes);
    let at = 4;
    let handles: unknown[] = [];
    let depth = 0;
    const classes = new Map<string, number>();
    const strings: string[] = [];

    const need = (n: number) => {
        if (at + n > bytes.length) throw new Error(`stream ends early (byte ${at})`);
    };
    const u8 = () => {
        need(1);
        return d.getUint8(at++);
    };
    const u16 = () => {
        need(2);
        at += 2;
        return d.getUint16(at - 2);
    };
    const i32 = () => {
        need(4);
        at += 4;
        return d.getInt32(at - 4);
    };
    const text = (n: number) => {
        need(n);
        at += n;
        return modifiedUtf8(bytes, at - n, at);
    };
    const handle = (x: unknown) => handles.push(x) - 1;
    const ref = () => {
        const x = handles[i32() - BASE_HANDLE];
        if (x === undefined) throw new Error(`unknown reference (byte ${at - 4})`);
        if (typeof x === 'object' && x && 'refs' in x) (x as JavaNode).refs++;
        return x;
    };

    // Any content: object, string, array, enum, class, block of data; 'end' for TC_ENDBLOCKDATA
    const content = (): JavaValue | 'end' => {
        if (++depth > MAX_JAVA_DEPTH) throw new Error('objects nested too deep');
        try {
            const tag = u8();
            switch (tag) {
                case 0x70: // TC_NULL
                    return null;

                case 0x71: // TC_REFERENCE
                    return ref() as JavaValue;

                case 0x72: // TC_CLASSDESC
                case 0x7d: // TC_PROXYCLASSDESC
                    at--;
                    classDesc();
                    return content(); // description alone (in annotations): skipped

                case 0x73: // TC_OBJECT
                    return object();

                case 0x74: // TC_STRING
                case 0x7c: {
                    // TC_LONGSTRING: 64-bit length
                    if (tag === 0x7c && i32() !== 0) throw new Error(`string too long (byte ${at - 4})`);
                    const s = text(tag === 0x7c ? i32() : u16());
                    handle(s);
                    strings.push(s);
                    return s;
                }

                case 0x75: // TC_ARRAY
                    return array();

                case 0x76: {
                    // TC_CLASS
                    const c = classDesc();
                    const x = { classOf: c?.name ?? '?' };
                    handle(x);
                    return x;
                }

                case 0x7e: {
                    // TC_ENUM
                    const c = classDesc();
                    const at0 = handle(null);
                    const name = content();
                    const x = { enum: String(name), cls: c?.name ?? '?' };
                    handles[at0] = x;
                    return x;
                }

                case 0x77: // TC_BLOCKDATA
                    return block(u8());

                case 0x7a: // TC_BLOCKDATALONG
                    return block(i32());

                case 0x78: // TC_ENDBLOCKDATA
                    return 'end';

                case 0x79: // TC_RESET
                    handles = [];
                    return content();

                case 0x7b: // TC_EXCEPTION
                    throw new Error(`stream holds an exception (byte ${at - 1})`);

                default:
                    throw new Error(`unknown tag 0x${tag.toString(16)} (byte ${at - 1})`);
            }
        } finally {
            depth--;
        }
    };

    const block = (n: number) => {
        need(n);
        at += n;
        return { block: bytes.subarray(at - n, at) };
    };

    // Class description (new, proxy, reference or null); annotations skipped
    const classDesc = (): JavaClass | null => {
        const tag = u8();
        if (tag === 0x70) return null;
        if (tag === 0x71) return ref() as JavaClass;
        if (tag === 0x7d) {
            const c: JavaClass = { name: '', flags: SC_SERIALIZABLE, fields: [], parent: null };
            handle(c);
            const names = [];
            for (let n = i32(); n > 0; n--) names.push(text(u16()));
            c.name = `Proxy(${names.join(', ')})`;
            annotations();
            c.parent = classDesc();
            return c;
        }
        if (tag !== 0x72) throw new Error(`class description expected (byte ${at - 1})`);
        const name = text(u16());
        need(8);
        at += 8; // serialVersionUID
        const c: JavaClass = { name, flags: 0, fields: [], parent: null };
        handle(c);
        c.flags = u8();
        for (let n = u16(); n > 0; n--) {
            const type = String.fromCharCode(u8());
            const field = text(u16());
            if (type === 'L' || type === '[') content(); // type name as string: not needed
            c.fields.push([type, field]);
        }
        annotations();
        c.parent = classDesc();
        return c;
    };

    // Annotations and data written by the class itself, up to TC_ENDBLOCKDATA
    const annotations = (): JavaValue[] => {
        const out = [];
        for (;;) {
            const x = content();
            if (x === 'end') return out;
            out.push(x);
        }
    };

    const value = (type: string): JavaValue => {
        const p = PRIMITIVES[type];
        if (!p) return content() as JavaValue;
        need(p[0]);
        at += p[0];
        return p[1](d, at - p[0]);
    };

    const object = (): JavaNode => {
        const c = classDesc();
        if (!c) throw new Error(`object without class (byte ${at})`);
        const node: JavaNode = { cls: c.name, fields: [], items: null, data: [], refs: 0 };
        handle(node);
        classes.set(c.name, (classes.get(c.name) || 0) + 1);
        const chain = [];
        for (let k: JavaClass | null = c; k; k = k.parent) chain.unshift(k); // superclasses first
        for (const k of chain) {
            if (k.flags & SC_EXTERNALIZABLE) {
                if (!(k.flags & SC_BLOCK_DATA))
                    throw new Error(`data of ${k.name} cannot be read (old protocol, written by the class itself)`);
                node.data.push(...annotations());
                continue;
            }
            for (const [type, field] of k.fields) node.fields.push([k.name, field, value(type)]);
            if (k.flags & SC_WRITE_METHOD) node.data.push(...annotations());
        }
        return node;
    };

    const array = (): JavaNode => {
        const c = classDesc();
        const cls = c?.name ?? '[?';
        const node: JavaNode = { cls, fields: [], items: [], data: [], refs: 0 };
        handle(node);
        const n = i32();
        if (n < 0) throw new Error(`negative array length (byte ${at - 4})`);
        const type = cls[1];
        if (type === 'B') {
            node.items = null;
            node.data.push(block(n)); // byte[]: kept as bytes
            return node;
        }
        const items = node.items as JavaValue[];
        for (let k = 0; k < n; k++) items.push(value(type));
        return node;
    };

    const roots: JavaValue[] = [];
    while (at < bytes.length) {
        const x = content();
        if (x !== 'end') roots.push(x);
    }
    return { roots, classes, strings };
}

// Modified UTF-8 (Java's DataOutput): NUL as C0 80, characters beyond U+FFFF as two surrogates of 3 bytes each
export function modifiedUtf8(b: Uint8Array, from: number, to: number): string {
    let out = '';
    const codes: number[] = [];
    for (let i = from; i < to; ) {
        const c = b[i++];
        if (c < 0x80) codes.push(c);
        else if ((c & 0xe0) === 0xc0) codes.push(((c & 0x1f) << 6) | (b[i++] & 0x3f));
        else codes.push(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
        if (codes.length >= 8192) out += String.fromCharCode(...codes.splice(0));
    }
    return out + String.fromCharCode(...codes);
}

// ---------------------------------------------------------------------------
// Plain values
// ---------------------------------------------------------------------------

// Values as JSON-ready data: objects with "@class" (and "@id" if referred to again: later as { "@ref": id }),
// enums as `Class.NAME`, byte[] and blocks of data as hex (or their size), primitive arrays as lists,
// boxed numbers as numbers, maps as "@entries", lists and sets as "@items", other own data as "@data";
// fields hidden by a subclass field of the same name as `Superclass.field`
export function javaPlain(roots: JavaValue[]): unknown[] {
    const ids = new Map<JavaNode, number>();
    const plain = (x: JavaValue): unknown => {
        if (x === null || typeof x !== 'object') {
            if (typeof x === 'bigint') return Number.isSafeInteger(Number(x)) ? Number(x) : String(x);
            if (typeof x === 'number' && !Number.isFinite(x)) return String(x);
            return x;
        }
        if ('enum' in x) return `${simpleName(x.cls)}.${x.enum}`;
        if ('classOf' in x) return `class ${x.classOf}`;
        if ('block' in x) return blockText(x.block);
        if (ids.has(x)) return { '@ref': ids.get(x) };
        if (x.cls === '[B' && !x.refs) return plain(x.data[0]);
        if (BOXED_RE.test(x.cls) && x.fields.length === 1) return plain(x.fields[0][2]);
        const out: Record<string, unknown> = { '@class': x.cls };
        if (x.refs) {
            ids.set(x, ids.size + 1);
            out['@id'] = ids.size;
        }
        if (x.items) {
            out['@items'] = x.items.map(plain);
            return x.cls[1] === 'L' || x.cls[1] === '[' || x.refs ? out : out['@items']; // primitives: values only
        }
        const left = new Map<string, number>(); // fields of a name still to come: the last one (subclass) keeps it
        for (const [, k] of x.fields) left.set(k, (left.get(k) || 0) + 1);
        for (const [cls, k, v] of x.fields) {
            const n = left.get(k) as number;
            left.set(k, n - 1);
            out[n > 1 ? `${simpleName(cls)}.${k}` : k] = plain(v);
        }
        const own = x.data.filter((v) => !(v && typeof v === 'object' && 'block' in v));
        if (MAP_RE.test(x.cls) && own.length % 2 === 0) {
            const entries = [];
            for (let k = 0; k < own.length; k += 2) entries.push({ key: plain(own[k]), value: plain(own[k + 1]) });
            out['@entries'] = entries;
        } else if (LIST_RE.test(x.cls)) {
            out['@items'] = own.slice(SORTED_RE.test(x.cls) ? 1 : 0).map(plain);
        } else if (x.data.length) {
            out['@data'] = x.data.map(plain);
        }
        return out;
    };
    return roots.map(plain);
}

// Raw bytes: hex if few, else their number
function blockText(b: Uint8Array): string {
    if (b.length > SHOWN_BLOCK) return `<${b.length} bytes>`;
    return `<${[...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')}>`;
}

export const simpleName = (cls: string): string => cls.slice(cls.lastIndexOf('.') + 1);
