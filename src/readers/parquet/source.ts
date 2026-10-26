// Parquet source: rows as CSV, more rows on demand

// ===========================================================================
// IMPORTS
// ===========================================================================

import { MAX_BYTES } from '../../_core/settings.ts';
import { PARQUET_ROWS } from '../../_core/settings.ts';
import { csvCell } from '../../_core/util.ts';
import { concatBytes } from '../bytes.ts';
import { u32 } from '../bytes.ts';
import { utf8 } from '../bytes.ts';
import { openRanges } from '../ranges.ts';
import { bitWidth } from './meta.ts';
import { CODEC_NAMES } from './meta.ts';
import { leafColumns } from './meta.ts';
import { parseFooter } from './meta.ts';
import { thriftReader } from './meta.ts';
import { decodeValues } from './pages.ts';
import { decompress } from './pages.ts';
import { readHybrid } from './pages.ts';
import { readPlain } from './pages.ts';
import { valueText } from './values.ts';

import type { Source } from '../../_core/types.ts';
import type { Deferred } from '../../_core/types.ts';
import type { Cell } from './meta.ts';
import type { Column } from './meta.ts';
import type { PageHeader } from './meta.ts';
import type { ParquetValue } from './meta.ts';

// ===========================================================================
// METHODS
// ===========================================================================

// Parquet source like openSource(): text = rows as CSV, more() = PARQUET_ROWS more
export async function openParquetSource(
    url: string,
    getSignal: () => AbortSignal,
    reload: boolean,
    onProgress: (loaded: number, total: number) => void,
    force = false,
): Promise<Source | Deferred | { error: string }> {
    const file = await openRanges(url, getSignal, reload, onProgress);
    if ('error' in file) return file;
    const { size, dates, read } = file;
    if (size < 12) return { error: 'Not a Parquet file' };
    if (!file.whole() && size > MAX_BYTES && !force) return { deferred: 'Parquet', size, dates }; // asks first

    // Footer: last 64 KB usually hold all of it (asked for by exact position)
    let tail: Uint8Array | null = await read(Math.max(0, size - 65536), size); // small file: all of it, no more requests
    if (utf8.decode(tail.subarray(tail.length - 4)) !== 'PAR1') return { error: 'Not a Parquet file' };
    const footerLen = u32(tail, tail.length - 8);
    let footer: Uint8Array;
    if (footerLen + 8 <= tail.length) {
        footer = tail.subarray(tail.length - 8 - footerLen, tail.length - 8);
    } else {
        footer = await read(size - 8 - footerLen, size - 8);
    }
    tail = null;

    const meta = parseFooter(footer);
    const leaves = leafColumns(meta.schema);
    const names = leaves.map((c) => c.path.join('.').replace(/\.(list\.(element|item)|array|bag)$/, ''));

    // Column chunk, cached piece by piece as its pages are read
    type Chunk = { length: number; buf: Uint8Array; ensure: (n: number) => Promise<void> };
    const chunk = (start: number, stated: number): Chunk => {
        const length = Math.max(0, Math.min(stated, size - start)); // never past end of file
        const c: Chunk = { length, buf: new Uint8Array(0), ensure: async () => {} };
        c.ensure = async (n) => {
            n = Math.min(n, length);
            if (c.buf.length >= n) return;
            const want = Math.min(length, Math.max(n, c.buf.length * 2, 64 * 1024));
            const more = await read(start + c.buf.length, start + want);
            if (!more.length) throw new Error('column data ends early (damaged file?)');
            c.buf = concatBytes([c.buf, more]);
        };
        return c;
    };

    // Per column: rows decoded so far (cur: list of the row being read), and where reading stopped
    // (row group, chunk and position in it, values read of the chunk, dictionary)
    type ColumnState = {
        col: Column;
        idx: number;
        rg: number;
        rows: Cell[];
        cur: Cell[] | null;
        curNull: boolean;
        chunk: Chunk | null;
        ended: boolean;
        codec: number;
        total: number;
        read: number;
        pos: number;
        dict: ParquetValue[] | null;
    };
    const states: ColumnState[] = leaves.map((col, idx) => ({
        col,
        idx,
        rg: 0,
        rows: [],
        cur: null,
        curNull: false,
        chunk: null,
        ended: false,
        codec: 0,
        total: 0,
        read: 0,
        pos: 0,
        dict: null,
    }));

    const endRow = (st: ColumnState) => {
        if (st.cur) st.rows.push(st.cur.length || !st.curNull ? st.cur : null);
        st.cur = null;
    };

    const addValues = (
        st: ColumnState,
        reps: number[] | null,
        defs: number[] | null,
        values: ParquetValue[],
        n: number,
    ) => {
        const { maxDef, maxRep, repetition } = st.col;
        let vi = 0;
        for (let i = 0; i < n; i++) {
            const def = defs ? defs[i] : maxDef;
            const v = def === maxDef ? values[vi++] : null;
            if (!maxRep) {
                st.rows.push(v);
                continue;
            }
            if ((reps ? reps[i] : 0) === 0) {
                endRow(st);
                st.cur = [];
                st.curNull = def === 0;
            }
            if (!st.cur) throw new Error(`column "${st.col.name}": list goes on before it began (damaged file?)`);
            if (def === maxDef) st.cur.push(v);
            else if (def === maxDef - 1 && repetition === 1) st.cur.push(null);
        }
    };

    const readPage = async (st: ColumnState, c: Chunk) => {
        let header: PageHeader;
        let at: number;
        for (let want = 2048; ; want *= 4) {
            await c.ensure(st.pos + want);
            try {
                const t = thriftReader(c.buf, st.pos);
                header = t.struct() as PageHeader; // shape per the format
                at = t.pos();
                break;
            } catch (err) {
                if (!(err instanceof RangeError)) throw err;
                if (c.buf.length >= c.length) {
                    st.pos = c.length; // nothing readable left in this column part
                    return;
                }
            }
        }
        const size = header[3] || 0;
        await c.ensure(at + size);
        const raw = c.buf.subarray(at, at + size);
        st.pos = at + size;
        const { col } = st;

        if (header[1] === 2) {
            const data = await decompress(st.codec, raw, header[2]);
            const dictHeader = header[7];
            if (!dictHeader) throw new Error(`column "${col.name}": dictionary page without header (damaged file?)`);
            st.dict = readPlain(col.type, data, 0, dictHeader[1], col.typeLength).values;
            return;
        }
        if (header[1] !== 0 && header[1] !== 3) return; // index pages: nothing to show

        const v2 = header[1] === 3;
        const h = v2 ? header[8] : header[5];
        if (!h) throw new Error(`column "${col.name}": data page without header (damaged file?)`);
        const n = h[1];
        let reps = null;
        let defs = null;
        let data: Uint8Array;
        let pos = 0;
        if (v2) {
            const repLen = h[6] || 0;
            const defLen = h[5] || 0;
            if (col.maxRep) reps = readHybrid(raw, 0, repLen, bitWidth(col.maxRep), n, new Array(n));
            if (col.maxDef) defs = readHybrid(raw, repLen, repLen + defLen, bitWidth(col.maxDef), n, new Array(n));
            const rest = raw.subarray(repLen + defLen);
            data = h[7] === false ? rest : await decompress(st.codec, rest, header[2] - repLen - defLen);
        } else {
            data = await decompress(st.codec, raw, header[2]);
            if (col.maxRep) {
                const len = u32(data, pos);
                reps = readHybrid(data, pos + 4, pos + 4 + len, bitWidth(col.maxRep), n, new Array(n));
                pos += 4 + len;
            }
            if (col.maxDef) {
                const len = u32(data, pos);
                defs = readHybrid(data, pos + 4, pos + 4 + len, bitWidth(col.maxDef), n, new Array(n));
                pos += 4 + len;
            }
        }
        const present = defs ? defs.filter((d) => d === col.maxDef).length : n;
        const values = decodeValues(st, v2 ? h[4] : h[2], data, pos, present);
        addValues(st, reps, defs, values, n);
        st.read += n;
    };

    // Read pages of one column until it has `target` rows (or file ends)
    const fillColumn = async (st: ColumnState, target: number) => {
        while (st.rows.length < target && !st.ended) {
            if (!st.chunk) {
                const rg = meta.rowGroups[st.rg];
                if (!rg) {
                    endRow(st);
                    st.ended = true;
                    break;
                }
                const cc = rg.columns[st.idx];
                const dict = cc.dictOffset;
                const start = dict !== null && dict > 0 && dict < cc.dataOffset ? dict : cc.dataOffset;
                st.chunk = chunk(start, cc.size);
                st.codec = cc.codec;
                st.total = cc.numValues;
                st.read = 0;
                st.pos = 0;
                st.dict = null;
            }
            if (st.read >= st.total || st.pos >= st.chunk.length) {
                endRow(st);
                st.chunk = null;
                st.rg++;
                continue;
            }
            const before = st.pos;
            await readPage(st, st.chunk);
            if (st.pos <= before) throw new Error(`column "${st.col.name}" could not be read (damaged file?)`);
        }
    };

    const codecs = [...new Set(meta.rowGroups.flatMap((rg) => rg.columns.map((c) => CODEC_NAMES[c.codec] || c.codec)))];
    const src: Source = {
        total: size,
        loaded: file.fetched(),
        done: false,
        isParquet: true,
        format: 'Parquet',
        wholeLines: true,
        dates,
        info: [
            ['shape', `${meta.numRows.toLocaleString()} rows × ${leaves.length} columns`],
            ['row groups', meta.rowGroups.length],
            ['compression', codecs.join(', ')],
            ['written by', meta.createdBy],
        ],
        text: '',
        rows: 0,
        label: () =>
            `${(src.rows ?? 0).toLocaleString()} of ${meta.numRows.toLocaleString()} rows · ${leaves.length} columns`,
        nextLabel: `Show next ${PARQUET_ROWS} rows`,
        more: () => fill(target + PARQUET_ROWS),
        loadAll: () => fill(meta.numRows),
    };
    const lines = [names.map(csvCell).join(',')];
    let target = 0;

    const fill = async (n: number) => {
        target = Math.min(n, meta.numRows);
        await Promise.all(states.map((st) => fillColumn(st, target)));
        const count = Math.min(target, ...states.map((st) => st.rows.length));
        for (let r = lines.length - 1; r < count; r++) {
            lines.push(states.map((st) => csvCell(valueText(st.col, st.rows[r]))).join(','));
        }
        src.rows = count;
        src.text = lines.join('\n');
        src.loaded = file.fetched();
        src.done = count >= meta.numRows || states.every((st) => st.ended);
    };

    if (!leaves.length) return { error: 'Parquet file without columns' };
    await fill(PARQUET_ROWS);
    return src;
}
