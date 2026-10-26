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
    let whole: Uint8Array | null = null; // whole file, if Sharepoint ignores partial requests
    let size = 0;
    let fetched = 0;
    const request = (range: string) =>
        fetch(url, {
            credentials: 'same-origin',
            cache: reload ? 'reload' : 'default', // 'reload': fresh copy, which also updates cache
            headers: { Range: `bytes=${range}` },
            signal: getSignal(),
        });

    // Size and signature (first 8 bytes) from small request, or whole file
    const res = await request('0-7');
    if (!res.ok) return { error: `Error ${res.status} on caching` };
    const dates = responseDates(res, res.headers.get('content-disposition') || '');
    let head: Uint8Array = new Uint8Array(await res.arrayBuffer());
    fetched = head.length;
    if (res.status === 206) size = Number((res.headers.get('content-range') || '').split('/')[1]) || 0;
    else {
        whole = head;
        size = whole.length;
        head = whole.subarray(0, 8);
    }
    onProgress(fetched, size);

    // Bytes [from, to) of file
    const read: ByteReader = async (from, to) => {
        from = Math.max(0, from);
        to = Math.min(size, to);
        if (from >= to) return new Uint8Array(0);
        if (whole) return whole.subarray(from, to);
        const r = await request(`${from}-${to - 1}`);
        if (!r.ok) throw new Error(`Error ${r.status} on caching`);
        const buf = new Uint8Array(await r.arrayBuffer());
        fetched += buf.length;
        onProgress(fetched, size);
        if (r.status !== 206 || (from === 0 && buf.length >= size)) {
            whole = buf; // all of it is here: no more requests
            return whole.subarray(from, to);
        }
        return buf;
    };
    return { size, head, dates, read, fetched: () => fetched, whole: () => !!whole };
}
