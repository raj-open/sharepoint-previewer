import { OUTSIDE, responseDates, sameOrigin } from './request.js';
/** @typedef {import('../_core/types.js').RangeFile} RangeFile */
/** @typedef {import('../_core/types.js').ByteReader} ByteReader */

// ---------------------------------------------------------------------------
// Files by byte range (Parquet, spreadsheets): only the parts needed are fetched
// ---------------------------------------------------------------------------

// Parts of file by range; whole file at once if SharePoint ignores ranges. Same origin only.
/**
 * @param {string} url @param {() => AbortSignal} getSignal @param {boolean} reload
 * @param {(loaded: number, total: number) => void} onProgress
 * @returns {Promise<RangeFile|{ error: string }>}
 */
export async function openRanges(url, getSignal, reload, onProgress) {
  if (!sameOrigin(url)) return { error: OUTSIDE };
  /** @type {Uint8Array|null} */
  let whole = null; // whole file, if SharePoint ignores partial requests
  let size = 0;
  let fetched = 0;
  /** @param {string} range */
  const request = (range) =>
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
  /** @type {Uint8Array} */
  let head = new Uint8Array(await res.arrayBuffer());
  fetched = head.length;
  if (res.status === 206) size = Number((res.headers.get('content-range') || '').split('/')[1]) || 0;
  else {
    whole = head;
    size = whole.length;
    head = whole.subarray(0, 8);
  }
  onProgress(fetched, size);

  // Bytes [from, to) of file
  /** @type {ByteReader} */
  const read = async (from, to) => {
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
