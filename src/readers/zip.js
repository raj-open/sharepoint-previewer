import { MAX_BYTES } from '../_core/settings.js';
import { formatBytes } from '../_core/util.js';
import { concatBytes, dataView, utf8 } from './bytes.js';
import { OUTSIDE, responseDates, sameOrigin } from './request.js';
import { sniffText } from './text.js';
/** @typedef {import('../_core/types.js').Source} Source */
/** @typedef {import('../_core/types.js').ByteReader} ByteReader */
/** @typedef {import('../_core/types.js').ZipEntry} ZipEntry */
/** @typedef {import('../_core/types.js').Deferred} Deferred */

// ---------------------------------------------------------------------------
// ZIP archives (.ifczip, spreadsheets): directory and single entries, read by range
// ---------------------------------------------------------------------------

// Entries of ZIP archive from its central directory (at its end)
/** @param {ByteReader} read @param {number} size @returns {Promise<ZipEntry[]>} */
export async function zipEntries(read, size) {
  // End record: in last 22 bytes, unless archive has a comment (then up to 64 KB before)
  let base = 0;
  /** @type {Uint8Array} */
  let tail = new Uint8Array(0);
  let end = -1;
  for (const span of [4096, 65557]) {
    base = Math.max(0, size - span);
    tail = await read(base, size);
    const dv = dataView(tail);
    for (let i = tail.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end >= 0 || base === 0) break;
  }
  if (end < 0) throw new Error('not a ZIP archive');
  const dv = dataView(tail);
  const count = dv.getUint16(end + 10, true);
  const length = dv.getUint32(end + 12, true);
  const at = dv.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  const dir = at >= base ? tail.subarray(at - base, at - base + length) : await read(at, at + length);
  const d = dataView(dir);
  const entries = [];
  let p = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > dir.length || d.getUint32(p, true) !== 0x02014b50) throw new Error('damaged ZIP directory');
    const nameLen = d.getUint16(p + 28, true);
    const extraLen = d.getUint16(p + 30, true);
    const commentLen = d.getUint16(p + 32, true);
    entries.push({
      name: utf8.decode(dir.subarray(p + 46, p + 46 + nameLen)),
      method: d.getUint16(p + 10, true),
      packed: d.getUint32(p + 20, true),
      size: d.getUint32(p + 24, true),
      offset: d.getUint32(p + 42, true),
      head: 30 + nameLen + extraLen, // local header: usually as long as this one
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Bytes of one entry: stored (0) or deflated (8)
/** @param {ByteReader} read @param {ZipEntry} entry @returns {Promise<Uint8Array>} */
export async function zipEntryBytes(read, entry) {
  const at = entry.offset;
  let bytes = await read(at, at + entry.head + entry.packed);
  const dv = dataView(bytes);
  if (bytes.length < 30 || dv.getUint32(0, true) !== 0x04034b50) throw new Error('damaged ZIP entry');
  const start = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  if (start + entry.packed > bytes.length) {
    bytes = concatBytes([bytes, await read(at + bytes.length, at + start + entry.packed)]); // longer local header
  }
  const packed = bytes.subarray(start, start + entry.packed);
  if (entry.method === 0) return packed;
  if (entry.method !== 8) throw new Error(`ZIP compression ${entry.method} is not supported`);
  const blob = new Blob([/** @type {BlobPart} */ (packed)]);
  return new Uint8Array(
    await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer(),
  );
}

// .ifczip: ZIP with one IFC file, unpacked by browser (read only)
export const ZIP_RE = /\.ifczip$/i;
const MAX_ZIP_BYTES = 256 * 1024 * 1024; // archive size limit

/** @param {string} url @param {() => AbortSignal} getSignal @param {boolean} reload @param {(loaded: number, total: number) => void} onProgress @param {boolean} [force] @returns {Promise<Source|Deferred|{ error: string }|{ binary: true }>} */
export async function openZipSource(url, getSignal, reload, onProgress, force = false) {
  if (!sameOrigin(url)) return { error: OUTSIDE };
  const res = await fetch(url, {
    credentials: 'same-origin',
    cache: reload ? 'reload' : 'default',
    signal: getSignal(),
  });
  if (!res.ok) return { error: `Error ${res.status} on caching` };
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > MAX_ZIP_BYTES) return { error: `Archive larger than ${formatBytes(MAX_ZIP_BYTES)}: not opened` };
  if (total > MAX_BYTES && !force) {
    res.body?.cancel(); // asks first
    return {
      deferred: 'IFCZIP',
      size: total,
      dates: responseDates(res, res.headers.get('content-disposition') || ''),
    };
  }
  const parts = [];
  let loaded = 0;
  const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader(); // ok response: has a body
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const bytes = concatBytes(parts.length ? parts : [new Uint8Array(0)]);
  /** @type {ByteReader} */
  const read = async (from, to) => bytes.subarray(from, to);
  let entries;
  try {
    entries = await zipEntries(read, bytes.length);
  } catch (err) {
    return { error: `Not a valid .ifczip (${/** @type {Error} */ (err).message})` };
  }
  const entry = entries.find((e) => /\.ifc$/i.test(e.name));
  if (!entry) return { error: 'No .ifc file inside this archive' };
  const raw = await zipEntryBytes(read, entry);
  const encoding = sniffText(raw);
  if (!encoding) return { binary: true };
  const text = new TextDecoder(encoding).decode(raw);
  return {
    total: loaded,
    loaded,
    done: true,
    isZip: true,
    zipBytes: bytes, // kept for 3D view
    ifcBytes: raw,
    encoding: encoding.toUpperCase(),
    dates: responseDates(res, res.headers.get('content-disposition') || ''),
    info: [['archive', `ZIP, ${entry.name} (${formatBytes(raw.length)} unpacked)`]],
    text,
    more: async () => {},
    loadAll: async () => {},
  };
}
