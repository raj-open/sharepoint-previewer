import { concatBytes, dataView, utf16le } from '../bytes.js';
/** @typedef {import('../../_core/types.js').ByteReader} ByteReader */

// --- Excel 97–2003 (.xls): BIFF8 (also BIFF5) records in a compound file ---

// Compound file: directory at once; streams read sector by sector, only where needed
/** @typedef {{ name: string, type: number, start: number, size: number }} CfbEntry directory entry (type 1 storage, 2 stream, 5 root) */
/** @typedef {{ size: number, bytes: ByteReader }} CfbStream */
/** @typedef {{ find: (name: string) => CfbEntry|undefined, stream: (e: CfbEntry) => Promise<CfbStream> }} CompoundFile */
/** @param {ByteReader} read @param {number} size @returns {Promise<CompoundFile>} */
export async function compoundFile(read, size) {
  const h = await read(0, 512);
  const dv = dataView(h);
  if (h.length < 512 || dv.getUint32(0, true) !== 0xe011cfd0 || dv.getUint32(4, true) !== 0xe11ab1a1) {
    throw new Error('not an Office file');
  }
  const ss = 2 ** dv.getUint16(30, true); // sector size: 512 or 4096
  const mss = 2 ** dv.getUint16(32, true); // mini sector size: 64
  const cutoff = dv.getUint32(56, true); // smaller streams live in the mini stream
  const SPECIAL = 0xfffffffa; // ids from here on: end of chain, free, …
  /** @param {number} s */
  const off = (s) => (s + 1) * ss; // header takes the first sector's place

  // Sectors -> bytes (consecutive ones in one request)
  /** @param {number[]} ids */
  const readSectors = async (ids) => {
    const parts = [];
    for (let i = 0; i < ids.length; ) {
      let j = i + 1;
      while (j < ids.length && ids[j] === ids[j - 1] + 1) j++;
      parts.push(await read(off(ids[i]), off(ids[j - 1]) + ss));
      i = j;
    }
    return concatBytes(parts.length ? parts : [new Uint8Array(0)]);
  };
  /** @param {Uint8Array} b */
  const u32s = (b) => {
    const d = dataView(b);
    return Uint32Array.from({ length: b.length >> 2 }, (_, i) => d.getUint32(4 * i, true));
  };

  // Allocation table: sector ids of its parts in header (first 109), more in DIFAT chain
  const nFat = dv.getUint32(44, true);
  const fatIds = [];
  for (let i = 0; i < 109 && fatIds.length < nFat; i++) fatIds.push(dv.getUint32(76 + 4 * i, true));
  for (let s = dv.getUint32(68, true), k = 0; s < SPECIAL && fatIds.length < nFat && k < size / ss; k++) {
    const d = dataView(await read(off(s), off(s) + ss));
    for (let i = 0; i < ss / 4 - 1 && fatIds.length < nFat; i++) fatIds.push(d.getUint32(4 * i, true));
    s = d.getUint32(ss - 4, true);
  }
  const fat = u32s(await readSectors(fatIds));
  /** @param {number} start @param {Uint32Array} [table] */
  const chain = (start, table = fat) => {
    const ids = [];
    for (let s = start; s < SPECIAL && s < table.length && ids.length < table.length; s = table[s]) ids.push(s);
    return ids;
  };

  // Directory: 128 bytes per entry (name, type, first sector, size)
  const dir = await readSectors(chain(dv.getUint32(48, true)));
  const dd = dataView(dir);
  /** @type {CfbEntry[]} */
  const entries = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const type = dir[at + 66];
    if (!type) continue;
    const len = Math.min(64, dd.getUint16(at + 64, true));
    entries.push({
      name: utf16le.decode(dir.subarray(at, at + Math.max(0, len - 2))),
      type, // 1 storage, 2 stream, 5 root
      start: dd.getUint32(at + 116, true),
      size: dd.getUint32(at + 120, true),
    });
  }
  const root = entries.find((e) => e.type === 5);

  // Big stream: sectors fetched when a range of it is asked for, kept for later
  /** @param {number} start @param {number} length @returns {CfbStream} */
  const bigStream = (start, length) => {
    const ids = chain(start);
    const buf = new Uint8Array(Math.min(length, ids.length * ss));
    const have = new Uint8Array(ids.length);
    return {
      size: buf.length,
      bytes: async (from, to) => {
        to = Math.min(to, buf.length);
        for (let i = Math.floor(from / ss), last = Math.ceil(to / ss); i < last; ) {
          if (have[i]) {
            i++;
            continue;
          }
          let j = i + 1;
          while (j < last && !have[j] && ids[j] === ids[j - 1] + 1) j++;
          const part = await read(off(ids[i]), off(ids[i]) + (j - i) * ss);
          buf.set(part.subarray(0, buf.length - i * ss), i * ss);
          have.fill(1, i, j);
          i = j;
        }
        return buf.subarray(from, to);
      },
    };
  };

  // Small stream: in the mini stream (root's stream), read whole
  /** @type {{ table: Uint32Array, data: Uint8Array }|null} */
  let mini = null;
  /** @param {number} start @param {number} length @returns {Promise<CfbStream>} */
  const smallStream = async (start, length) => {
    if (!mini) {
      const table = u32s(await readSectors(chain(dv.getUint32(60, true))));
      const data = root ? await bigStream(root.start, root.size).bytes(0, root.size) : new Uint8Array(0);
      mini = { table, data };
    }
    const out = new Uint8Array(length);
    let at = 0;
    for (const s of chain(start, mini.table)) {
      if (at >= length) break;
      out.set(mini.data.subarray(s * mss, s * mss + Math.min(mss, length - at)), at);
      at += mss;
    }
    return { size: length, bytes: async (from, to) => out.subarray(from, Math.min(to, length)) };
  };

  return {
    find: (name) => entries.find((e) => e.type === 2 && e.name.toLowerCase() === name.toLowerCase()),
    stream: async (e) => (e.size < cutoff ? smallStream(e.start, e.size) : bigStream(e.start, e.size)),
  };
}
