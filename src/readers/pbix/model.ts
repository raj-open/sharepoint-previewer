// Power BI data model (DataModel): XPress9-compressed Analysis Services backup (ABF) holding the model's
// metadata (SQLite): Power Query of newer files ("enhanced metadata", no DataMashup part)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { utf16le } from '../bytes.ts';
import { utf8 } from '../bytes.ts';
import { xpress9Session } from '../codecs/xpress9.ts';
import { sqliteDatabase } from '../sqlite.ts';

import type { Query } from '../../_core/types.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** files of a backup */
export type Backup = { names: string[]; file: (name: string) => Uint8Array | null };

// ===========================================================================
// CONSTANTS
// ===========================================================================

const SIGNATURE_BYTES = 102; // UTF-16 text naming the compression
const SINGLE = 'This backup was created using XPress9 compression.';
const MULTI = 'This backup was created using multithreaded XPrs9.';
const STORAGE = 'STREAM_STORAGE_SIGNATURE_)!@#$%^&*('; // uncompressed backup
const PAGE = 0x1000; // backup header: one page

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------
// Queries
// ---------------------------------------------------------------

/**
 * Power Query of the model: shared queries and parameters (expressions), then the M partitions of its tables
 * @param bytes the DataModel part
 */
export async function modelQueries(bytes: Uint8Array, pause?: () => Promise<void>): Promise<Query[]> {
    const meta = backupFiles(await modelBackup(bytes, pause)).file('metadata.sqlitedb');
    if (!meta) throw new Error('no metadata in the data model');
    const db = sqliteDatabase(meta);
    const tables = new Map((db.rows('Table') || []).map((t) => [t.ID, String(t.Name)]));
    const queries: Query[] = (db.rows('Expression') || [])
        .filter((e) => !e.Kind && typeof e.Expression === 'string') // kind 0: M
        .map((e) => ({ name: String(e.Name), body: e.Expression as string }));
    const partitions = (db.rows('Partition') || []).filter(
        (p) => p.Type === 4 && typeof p.QueryDefinition === 'string',
    );
    const perTable = new Map<unknown, number>();
    for (const p of partitions) perTable.set(p.TableID, (perTable.get(p.TableID) || 0) + 1);
    for (const p of partitions) {
        const table = tables.get(p.TableID) ?? String(p.Name);
        const name = (perTable.get(p.TableID) || 0) > 1 ? `${table} (${p.Name})` : table; // several: by partition
        queries.push({ name, body: p.QueryDefinition as string });
    }
    return queries;
}

// ---------------------------------------------------------------
// Decompression
// ---------------------------------------------------------------

/**
 * Backup inside the DataModel part (decompressed if needed)
 * @param pause called between chunks (e.g. to let the page breathe); a rejection stops
 */
export async function modelBackup(bytes: Uint8Array, pause: () => Promise<void> = async () => {}): Promise<Uint8Array> {
    const signature = utf16le.decode(bytes.subarray(0, SIGNATURE_BYTES));
    if (signature.includes(STORAGE)) return bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u32 = (at: number) => view.getUint32(at, true);
    const u64 = (at: number) => Number(view.getBigUint64(at, true));

    // Chunks: size decompressed, size compressed, data; a group of them shares one history (session)
    let at = SIGNATURE_BYTES;
    const group = async (chunks: number, capacity: number): Promise<Uint8Array> => {
        const session = xpress9Session(capacity);
        for (let i = 0; i < chunks && at + 8 <= bytes.length; i++) {
            const size = u32(at);
            const packed = u32(at + 4);
            at += 8;
            if (at + packed > bytes.length) throw new Error('data model cut off');
            if (session.decode(bytes.subarray(at, at + packed)).length !== size) {
                throw new Error('data model: chunk of unexpected size');
            }
            at += packed;
            await pause();
        }
        return session.output();
    };

    if (signature.startsWith(SINGLE)) return await group(Number.POSITIVE_INFINITY, bytes.length * 2);
    if (!signature.startsWith(MULTI)) throw new Error('data model: unknown compression');

    // Multithreaded: prefix groups, then main groups (each its own session), in this order
    const mainChunks = u64(at);
    const prefixChunks = u64(at + 8);
    const prefixGroups = u64(at + 16);
    const mainGroups = u64(at + 24);
    const chunkSize = u64(at + 32);
    at += 40;
    const parts: Uint8Array[] = [];
    for (let g = 0; g < prefixGroups; g++) parts.push(await group(prefixChunks, prefixChunks * chunkSize));
    for (let g = 0; g < mainGroups; g++) parts.push(await group(mainChunks, mainChunks * chunkSize));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let to = 0;
    for (const p of parts) {
        out.set(p, to);
        to += p.length;
    }
    return out;
}

// ---------------------------------------------------------------
// Backup (ABF)
// ---------------------------------------------------------------

/** Files of a backup: header (XML, first page) -> directory (XML) -> log (XML, names of the files) */
export function backupFiles(abf: Uint8Array): Backup {
    const header = utf16le.decode(abf.subarray(STORAGE.length * 2 + 2, PAGE)).replace(/\0+$/, '');
    const offset = Number(tag(header, 'm_cbOffsetHeader'));
    const size = Number(tag(header, 'DataSize'));
    const trimmed = tag(header, 'ErrorCode') === 'true'; // then each file ends with 4 more bytes
    if (tag(header, 'ApplyCompression') === 'true') throw new Error('data model: compressed backup files');
    if (!(offset > 0 && size > 0 && offset + size <= abf.length)) throw new Error('data model: no backup directory');

    // directory: where each stored file is
    const stored = new Map<string, { offset: number; size: number }>();
    for (const block of blocks(text(abf.subarray(offset, offset + size)), 'BackupFile')) {
        stored.set(tag(block, 'Path'), {
            offset: Number(tag(block, 'm_cbOffsetHeader')),
            size: Number(tag(block, 'Size')),
        });
    }
    const slice = (s: { offset: number; size: number } | undefined) =>
        s && s.offset + s.size <= abf.length ? abf.subarray(s.offset, s.offset + s.size - (trimmed ? 4 : 0)) : null;

    // log (last file of the directory): names of the files
    const log = slice([...stored.values()].at(-1));
    const byName = new Map<string, string>(); // file name -> path in the directory
    for (const block of log ? blocks(utf16le.decode(log), 'BackupFile') : []) {
        const path = tag(block, 'Path');
        const name = path.slice(path.lastIndexOf('\\') + 1);
        if (!byName.has(name)) byName.set(name, tag(block, 'StoragePath'));
    }
    return {
        names: [...byName.keys()],
        file: (name: string) => slice(stored.get(byName.get(name) ?? '')),
    };
}

// XML of the backup: UTF-16 (with or without BOM) or UTF-8
function text(bytes: Uint8Array): string {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16le.decode(bytes.subarray(2));
    return bytes[1] === 0 ? utf16le.decode(bytes) : utf8.decode(bytes);
}

/** @returns text of the first <name> element (entities decoded), '' if none */
function tag(xml: string, name: string): string {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
    return m ? entities(m[1]) : '';
}

function blocks(xml: string, name: string): string[] {
    return xml.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'g')) || [];
}

const entities = (s: string): string =>
    s.replace(
        /&(lt|gt|amp|quot|apos);/g,
        (_, e: string) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e] as string,
    );
