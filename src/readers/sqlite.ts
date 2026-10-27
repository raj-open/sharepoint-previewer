// SQLite database file (read only): rows of its tables, by name (format: sqlite.org/fileformat.html)

// ===========================================================================
// TYPES
// ===========================================================================

/** value of a cell: NULL, integer or real, text, blob */
export type SqlValue = null | number | string | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

// ===========================================================================
// CONSTANTS
// ===========================================================================

const SQLITE_HEADER = 'SQLite format 3\0';
const LEAF = 0x0d; // table b-tree pages
const INTERIOR = 0x05;

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns rows of a table of the database (columns named as created), null if there is no such table */
export function sqliteDatabase(db: Uint8Array) {
    if (new TextDecoder().decode(db.subarray(0, 16)) !== SQLITE_HEADER) throw new Error('not an SQLite database');
    const view = new DataView(db.buffer, db.byteOffset, db.byteLength);
    const pageSize = view.getUint16(16) === 1 ? 65536 : view.getUint16(16);
    const usable = pageSize - db[20];
    const encoding = view.getUint32(56);
    const decoder = new TextDecoder(encoding === 2 ? 'utf-16le' : encoding === 3 ? 'utf-16be' : 'utf-8');

    // ---------------------------------------------------------------
    // B-tree of a table: records in rowid order
    // ---------------------------------------------------------------

    const records = (root: number): [number, SqlValue[]][] => {
        const out: [number, SqlValue[]][] = [];
        const seen = new Set<number>();
        const visit = (page: number) => {
            if (page < 1 || seen.has(page) || page * pageSize > db.length) throw new Error('SQLite: bad page');
            seen.add(page);
            const base = (page - 1) * pageSize;
            const at = page === 1 ? 100 : 0; // page 1 starts with the file header
            const type = db[base + at];
            const cells = view.getUint16(base + at + 3);
            const pointers = base + at + (type === INTERIOR ? 12 : 8);
            for (let i = 0; i < cells; i++) {
                const cell = base + view.getUint16(pointers + i * 2);
                if (type === INTERIOR) visit(view.getUint32(cell));
                else if (type === LEAF) out.push(leafCell(cell));
                else throw new Error('SQLite: not a table page');
            }
            if (type === INTERIOR) visit(view.getUint32(base + at + 8)); // right-most child
        };
        visit(root);
        return out;
    };

    // Leaf cell: payload size, rowid, payload (rest in overflow pages)
    const leafCell = (at: number): [number, SqlValue[]] => {
        const [size, a] = varint(at);
        const [rowid, b] = varint(a);
        const max = usable - 35;
        let local = size;
        if (size > max) {
            const min = Math.floor(((usable - 12) * 32) / 255) - 23;
            const k = min + ((size - min) % (usable - 4));
            local = k <= max ? k : min;
        }
        let payload = db.subarray(b, b + local);
        if (local < size) {
            const parts = [payload];
            let got = local;
            for (let page = view.getUint32(b + local); page && got < size; ) {
                const base = (page - 1) * pageSize;
                const n = Math.min(usable - 4, size - got);
                parts.push(db.subarray(base + 4, base + 4 + n));
                got += n;
                page = view.getUint32(base);
            }
            payload = new Uint8Array(size);
            let to = 0;
            for (const p of parts) {
                payload.set(p, to);
                to += p.length;
            }
        }
        return [rowid, record(payload)];
    };

    // Record: header (its size, serial types), then the values
    const record = (p: Uint8Array): SqlValue[] => {
        const pv = new DataView(p.buffer, p.byteOffset, p.byteLength);
        const [headerSize, h] = varintIn(p, 0);
        const types: number[] = [];
        for (let at = h; at < headerSize; ) {
            const [t, next] = varintIn(p, at);
            types.push(t);
            at = next;
        }
        const values: SqlValue[] = [];
        let at = headerSize;
        for (const t of types) {
            if (t === 0) values.push(null);
            else if (t <= 6) {
                const n = [0, 1, 2, 3, 4, 6, 8][t]; // integer of n bytes
                values.push(signed(p, at, n));
                at += n;
            } else if (t === 7) {
                values.push(pv.getFloat64(at));
                at += 8;
            } else if (t === 8 || t === 9) values.push(t - 8);
            else if (t >= 12) {
                const n = (t - 12) >> 1;
                values.push(t % 2 ? decoder.decode(p.subarray(at, at + n)) : p.slice(at, at + n));
                at += n;
            } else throw new Error('SQLite: bad record');
        }
        return values;
    };

    const varint = (at: number): [number, number] => varintIn(db, at);

    // ---------------------------------------------------------------
    // Schema (sqlite_master, page 1)
    // ---------------------------------------------------------------

    const tables = new Map<string, { root: number; columns: string[]; rowid: number }>();
    for (const [, [type, name, , root, sql]] of records(1)) {
        if (type !== 'table' || typeof name !== 'string' || typeof sql !== 'string') continue;
        const { columns, rowid } = columnsOf(sql);
        tables.set(name.toLowerCase(), { root: Number(root), columns, rowid });
    }

    return {
        tables: () => [...tables.keys()],
        rows(name: string): SqlRow[] | null {
            const t = tables.get(name.toLowerCase());
            if (!t) return null;
            return records(t.root).map(([rowid, values]) => {
                const row: SqlRow = {};
                t.columns.forEach((c, i) => {
                    row[c] = i === t.rowid ? rowid : (values[i] ?? null);
                });
                return row;
            });
        },
    };
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/** @returns [value, position after it] of the varint (1-9 bytes, big-endian, 7 bits each but the 9th) */
function varintIn(b: Uint8Array, at: number): [number, number] {
    let v = 0;
    for (let i = 0; i < 8; i++) {
        const byte = b[at + i];
        v = v * 128 + (byte & 0x7f);
        if (!(byte & 0x80)) return [v, at + i + 1];
    }
    return [v * 256 + b[at + 8], at + 9];
}

/** big-endian two's complement integer of n bytes (beyond 2^53: rounded) */
function signed(b: Uint8Array, at: number, n: number): number {
    const negative = n > 0 && b[at] & 0x80;
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + (negative ? 255 - b[at + i] : b[at + i]); // negative: by its complement
    return negative ? -v - 1 : v;
}

/** Columns of CREATE TABLE (names unquoted); rowid: index of an INTEGER PRIMARY KEY column (alias of the rowid), else -1 */
export function columnsOf(sql: string): { columns: string[]; rowid: number } {
    const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
    const defs: string[] = [];
    let depth = 0;
    let quote = '';
    let start = 0;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (quote) {
            if (c === quote) quote = '';
        } else if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '[') quote = ']';
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) {
            defs.push(body.slice(start, i));
            start = i + 1;
        }
    }
    defs.push(body.slice(start));
    const columns: string[] = [];
    const types: string[] = [];
    let rowid = -1;
    let key: string | null = null; // PRIMARY KEY (one column) as a table constraint
    for (const def of defs.map((d) => d.trim())) {
        const pk =
            /^(?:constraint\s+\S+\s+)?primary\s+key\s*\(\s*(?:"([^"]+)"|\[([^\]]+)\]|`([^`]+)`|(\w+))\s*(asc)?\s*\)/i.exec(
                def,
            );
        if (pk) key = pk[1] ?? pk[2] ?? pk[3] ?? pk[4];
        if (/^(constraint|primary|unique|check|foreign)\b/i.test(def)) continue; // table constraints
        const m = /^(?:"((?:[^"]|"")*)"|\[([^\]]*)\]|`([^`]*)`|(\S+))\s*(.*)$/s.exec(def);
        if (!m) continue;
        const name = m[1]?.replace(/""/g, '"') ?? m[2] ?? m[3] ?? m[4];
        if (/^integer\s+primary\s+key\b/i.test(m[5]) && !/\bdesc\b/i.test(m[5])) rowid = columns.length;
        columns.push(name);
        types.push((/^(\w+)/.exec(m[5]) || ['', ''])[1].toLowerCase());
    }
    // INTEGER column as the only key column: alias of the rowid as well
    const k = key === null ? -1 : columns.findIndex((c) => c.toLowerCase() === key.toLowerCase());
    if (rowid < 0 && k >= 0 && types[k] === 'integer') rowid = k;
    return { columns, rowid };
}
