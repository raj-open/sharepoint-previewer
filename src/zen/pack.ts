// ZIP archives written in the browser: files stored or deflated (whichever is smaller), folders, UTF-8 names
// (format: PKWARE APPNOTE.TXT, https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT; no ZIP64)

// ===========================================================================
// TYPES
// ===========================================================================

/** entry of an archive: path inside it ('/' between folders), bytes (none: a folder), date (local time) */
export type PackEntry = { path: string; bytes: Uint8Array | null; date: Date };

// ===========================================================================
// CONSTANTS
// ===========================================================================

/** limits of a ZIP without ZIP64: entries, bytes of the archive */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

const VERSION = 20; // 2.0: folders, deflate
const UTF8_NAMES = 0x0800; // general purpose flag, bit 11
const STORED = 0;
const DEFLATED = 8;
const DIR_ATTR = 0x10; // MS-DOS attribute of a folder
const NAMES = new TextEncoder(); // names in UTF-8

// CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320): one entry per byte value
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/** @returns CRC-32 of the bytes */
export function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** @returns MS-DOS time and date (local time, 2 s steps; before 1980: 1980-01-01) */
export function dosDate(d: Date): { time: number; date: number } {
    if (d.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}

/** @returns bytes deflated (raw), or null if the browser cannot */
async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
    try {
        const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

/**
 * Writes a ZIP archive (entries in the order given).
 * @returns the archive, or why not (too many entries, too large)
 */
export async function packZip(entries: PackEntry[]): Promise<Blob | string> {
    if (entries.length > ZIP_MAX_ENTRIES) return `more than ${ZIP_MAX_ENTRIES.toLocaleString()} entries`;
    const parts: BlobPart[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const e of entries) {
        const folder = e.bytes === null;
        const name = NAMES.encode(folder && !e.path.endsWith('/') ? `${e.path}/` : e.path);
        const data = e.bytes ?? new Uint8Array(0);
        const crc = crc32(data);
        const deflated = data.length ? await deflate(data) : null;
        const packed = deflated && deflated.length < data.length ? deflated : data;
        const method = packed === data ? STORED : DEFLATED;
        const { time, date } = dosDate(e.date);
        if (offset + 30 + name.length + packed.length > ZIP_MAX_BYTES) return 'larger than 4 GB';

        const local = new Uint8Array(30 + name.length);
        const l = new DataView(local.buffer);
        l.setUint32(0, 0x04034b50, true);
        l.setUint16(4, VERSION, true);
        l.setUint16(6, UTF8_NAMES, true);
        l.setUint16(8, method, true);
        l.setUint16(10, time, true);
        l.setUint16(12, date, true);
        l.setUint32(14, crc, true);
        l.setUint32(18, packed.length, true);
        l.setUint32(22, data.length, true);
        l.setUint16(26, name.length, true);
        local.set(name, 30);

        const head = new Uint8Array(46 + name.length);
        const c = new DataView(head.buffer);
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, VERSION, true);
        c.setUint16(6, VERSION, true);
        c.setUint16(8, UTF8_NAMES, true);
        c.setUint16(10, method, true);
        c.setUint16(12, time, true);
        c.setUint16(14, date, true);
        c.setUint32(16, crc, true);
        c.setUint32(20, packed.length, true);
        c.setUint32(24, data.length, true);
        c.setUint16(28, name.length, true);
        c.setUint32(38, folder ? DIR_ATTR : 0, true);
        c.setUint32(42, offset, true);
        head.set(name, 46);

        parts.push(local as BlobPart, packed as BlobPart);
        central.push(head);
        offset += local.length + packed.length;
    }
    const size = central.reduce((sum, h) => sum + h.length, 0);
    if (offset + size + 22 > ZIP_MAX_BYTES) return 'larger than 4 GB';
    const end = new Uint8Array(22);
    const d = new DataView(end.buffer);
    d.setUint32(0, 0x06054b50, true);
    d.setUint16(8, entries.length, true);
    d.setUint16(10, entries.length, true);
    d.setUint32(12, size, true);
    d.setUint32(16, offset, true);
    return new Blob([...parts, ...(central as BlobPart[]), end as BlobPart], { type: 'application/zip' });
}
