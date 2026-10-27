// Files by byte range (Parquet, spreadsheets): only the parts needed are fetched

// ===========================================================================
// IMPORTS
// ===========================================================================

import { OUTSIDE } from './request.ts';
import { responseDates } from './request.ts';
import { sameOrigin } from './request.ts';

import type { RangeFile } from '../_core/types.ts';
import type { ByteReader } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Least bytes per request: a request costs about as much for 8 bytes as for 64 KB,
// so neighbouring small parts (headers, directories, small entries) come along
export const READ_MIN = 64 * 1024;

// Pieces up to this size are kept for later reads (big data passes through: the readers keep it)
export const KEEP_MAX = 4 * READ_MIN;

// ===========================================================================
// METHODS
// ===========================================================================

// Parts of file by range; whole file at once if Sharepoint ignores ranges. Same origin only.
export async function openRanges(
    url: string,
    getSignal: () => AbortSignal,
    reload: boolean,
    onProgress: (loaded: number, total: number) => void,
): Promise<RangeFile | { error: string }> {
    if (!sameOrigin(url)) return { error: OUTSIDE };
    let whole: Uint8Array | null = null; // whole file, if Sharepoint ignores partial requests (or all of it is here)
    let size = 0;
    let fetched = 0;
    const pieces: { from: number; bytes: Uint8Array }[] = []; // small pieces fetched, for later reads
    const request = (from: number, to: number) =>
        fetch(url, {
            credentials: 'same-origin',
            cache: reload ? 'reload' : 'default', // 'reload': fresh copy, which also updates cache
            headers: { Range: `bytes=${from}-${to - 1}` },
            signal: getSignal(),
        });

    // Size, signature (first 8 bytes) and first READ_MIN bytes from one request (small file: all of it)
    const res = await request(0, READ_MIN);
    if (!res.ok) return { error: `Error ${res.status} on caching` };
    const dates = responseDates(res, res.headers.get('content-disposition') || '');
    const first = new Uint8Array(await res.arrayBuffer());
    fetched = first.length;
    size = res.status === 206 ? Number((res.headers.get('content-range') || '').split('/')[1]) || 0 : first.length;
    if (res.status !== 206 || first.length >= size) whole = first;
    else pieces.push({ from: 0, bytes: first });
    onProgress(fetched, size);

    // Kept piece holding all of [from, to)
    const kept = (from: number, to: number) => {
        const p = pieces.find((p) => p.from <= from && to <= p.from + p.bytes.length);
        return p ? p.bytes.subarray(from - p.from, to - p.from) : null;
    };

    // Bytes [from, to) of file
    const read: ByteReader = async (from, to) => {
        from = Math.max(0, from);
        to = Math.min(size, to);
        if (from >= to) return new Uint8Array(0);
        if (whole) return whole.subarray(from, to);
        const hit = kept(from, to);
        if (hit) return hit;

        // At least READ_MIN bytes: onwards, or backwards near the end
        let start = from;
        const end = Math.min(size, Math.max(to, from + READ_MIN));
        if (end - start < READ_MIN) start = Math.max(0, end - READ_MIN);

        const r = await request(start, end);
        if (!r.ok) throw new Error(`Error ${r.status} on caching`);
        const buf = new Uint8Array(await r.arrayBuffer());
        fetched += buf.length;
        onProgress(fetched, size);
        if (r.status !== 206 || (start === 0 && buf.length >= size)) {
            whole = buf; // all of it is here: no more requests
            pieces.length = 0;
            return whole.subarray(from, to);
        }
        if (buf.length <= KEEP_MAX) pieces.push({ from: start, bytes: buf });
        return buf.subarray(from - start, to - start);
    };
    return { size, head: (whole || first).subarray(0, 8), dates, read, fetched: () => fetched, whole: () => !!whole };
}
