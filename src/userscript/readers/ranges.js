import { responseDates } from './text.js';

/** @typedef {import('../types.js').RangeFile} RangeFile */

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
  if (new URL(url, location.href).origin !== location.origin) {
    return { error: 'Not opened: the link points outside this SharePoint' };
  }
  let whole = null; // whole file, if SharePoint ignores partial requests
  let size = 0;
  let fetched = 0;
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

/** @param {Uint8Array[]} parts @returns {Uint8Array} */
export function concatBytes(parts) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** @param {Uint8Array} b @returns {DataView} */
export const dataView = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
