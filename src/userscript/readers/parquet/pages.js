import { unlz4 } from '../codecs/lz4.js';
import { unsnappy } from '../codecs/snappy.js';
import { unzstd } from '../codecs/zstd.js';
import { CODEC_NAMES, u32 } from './meta.js';

/** @param {number} codec @param {Uint8Array} data @param {number} outLen @returns {Promise<Uint8Array>} */
export async function decompress(codec, data, outLen) {
  if (codec === 0) return data;
  if (codec === 1) return unsnappy(data);
  if (codec === 2) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (codec === 7) return unlz4(data, outLen);
  if (codec === 6) return unzstd(data, outLen);
  throw new Error(`compression ${CODEC_NAMES[codec] || codec} is not supported by this viewer`);
}

// --- Values ---

// RLE / bit-packed hybrid (levels, dictionary indices, booleans)
/** @param {Uint8Array} bytes @param {number} pos @param {number} end @param {number} width @param {number} count @param {number[]} out @returns {number[]} */
export function readHybrid(bytes, pos, end, width, count, out) {
  const byteWidth = (width + 7) >> 3;
  let n = 0;
  while (n < count && pos < end) {
    let header = 0;
    let shift = 0;
    let b;
    do {
      b = bytes[pos++];
      header += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    if (header % 2) {
      const groups = Math.floor(header / 2);
      const start = pos;
      let bit = 0;
      for (let i = 0; i < groups * 8; i++, bit += width) {
        let v = 0;
        for (let k = 0; k < width; k++) {
          const at = bit + k;
          v |= ((bytes[start + (at >> 3)] >> (at & 7)) & 1) << k;
        }
        if (n < count) out[n++] = v;
      }
      pos = start + groups * width;
    } else {
      const run = Math.floor(header / 2);
      let v = 0;
      for (let k = 0; k < byteWidth; k++) v |= bytes[pos++] << (8 * k);
      for (let i = 0; i < run && n < count; i++) out[n++] = v;
    }
  }
  return out;
}

// DELTA_BINARY_PACKED; returns values and position after them
/** @param {Uint8Array} bytes @param {number} pos @param {boolean} big @returns {{ values: Array<number|bigint>, pos: number }} */
function readDelta(bytes, pos, big) {
  const uvar = () => {
    let r = 0n;
    let s = 0n;
    let b;
    do {
      b = bytes[pos++];
      r |= BigInt(b & 0x7f) << s;
      s += 7n;
    } while (b & 0x80);
    return r;
  };
  const zigzag = (n) => (n >> 1n) ^ -(n & 1n);
  const blockSize = Number(uvar());
  const minis = Number(uvar());
  const total = Number(uvar());
  let value = zigzag(uvar());
  const perMini = blockSize / minis;
  if (!(perMini > 0 && perMini % 8 === 0) || total < 0) throw new Error('damaged delta-encoded values');
  const values = total ? [value] : [];
  while (values.length < total) {
    const minDelta = zigzag(uvar());
    const widths = bytes.subarray(pos, pos + minis);
    pos += minis;
    for (let m = 0; m < minis && values.length < total; m++) {
      const w = widths[m];
      const start = pos;
      for (let i = 0, bit = 0; i < perMini; i++, bit += w) {
        let d = 0n;
        for (let k = 0; k < w; k++) {
          const at = bit + k;
          if ((bytes[start + (at >> 3)] >> (at & 7)) & 1) d |= 1n << BigInt(k);
        }
        if (values.length < total) {
          value += minDelta + d;
          values.push(value);
        }
      }
      pos = start + (perMini * w) / 8;
    }
  }
  return {
    values: values.map((v) => (big ? BigInt.asIntN(64, v) : Number(BigInt.asIntN(32, v)))),
    pos,
  };
}

// INT96 (old timestamp format): nanoseconds of day + Julian day
/** @param {DataView} dv @param {number} pos @returns {Date} */
function int96Date(dv, pos) {
  const nanos = dv.getBigInt64(pos, true);
  const day = dv.getInt32(pos + 8, true);
  return new Date((day - 2440588) * 86400000 + Number(nanos / 1000000n));
}

/** @param {number} type @param {Uint8Array} bytes @param {number} pos @param {number} n @param {number} typeLength @returns {{ values: Array<*>, pos: number }} */
export function readPlain(type, bytes, pos, n, typeLength) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    switch (type) {
      case 0:
        out[i] = ((bytes[pos + (i >> 3)] >> (i & 7)) & 1) === 1;
        break;
      case 1:
        out[i] = dv.getInt32(pos, true);
        pos += 4;
        break;
      case 2:
        out[i] = dv.getBigInt64(pos, true);
        pos += 8;
        break;
      case 3:
        out[i] = int96Date(dv, pos);
        pos += 12;
        break;
      case 4:
        out[i] = dv.getFloat32(pos, true);
        pos += 4;
        break;
      case 5:
        out[i] = dv.getFloat64(pos, true);
        pos += 8;
        break;
      case 6: {
        const len = dv.getInt32(pos, true);
        out[i] = bytes.subarray(pos + 4, pos + 4 + len);
        pos += 4 + len;
        break;
      }
      default:
        out[i] = bytes.subarray(pos, pos + typeLength);
        pos += typeLength;
    }
  }
  if (type === 0) pos += Math.ceil(n / 8);
  return { values: out, pos };
}

const TYPE_WIDTH = { 1: 4, 2: 8, 4: 4, 5: 8 };

/** @param {Object} st column state @param {number} encoding @param {Uint8Array} data @param {number} pos @param {number} n @returns {Array<*>} */
export function decodeValues(st, encoding, data, pos, n) {
  const { type, typeLength } = st.col;
  switch (encoding) {
    case 0:
      return readPlain(type, data, pos, n, typeLength).values;
    case 2:
    case 8: {
      if (!st.dict) throw new Error('dictionary page missing');
      const idx = readHybrid(data, pos + 1, data.length, data[pos], n, new Array(n));
      return idx.map((i) => st.dict[i]);
    }
    case 3: {
      const len = u32(data, pos);
      return readHybrid(data, pos + 4, pos + 4 + len, 1, n, new Array(n)).map((v) => v === 1);
    }
    case 5:
      return readDelta(data, pos, type === 2).values;
    case 6: {
      const lens = readDelta(data, pos, false);
      let at = lens.pos;
      return lens.values.slice(0, n).map((len) => {
        const part = data.subarray(at, at + len);
        at += len;
        return part;
      });
    }
    case 7: {
      const prefixes = readDelta(data, pos, false);
      const suffixes = readDelta(data, prefixes.pos, false);
      let at = suffixes.pos;
      let prev = new Uint8Array(0);
      return suffixes.values.slice(0, n).map((len, i) => {
        const value = new Uint8Array(prefixes.values[i] + len);
        value.set(prev.subarray(0, prefixes.values[i]));
        value.set(data.subarray(at, at + len), prefixes.values[i]);
        at += len;
        prev = value;
        return value;
      });
    }
    case 9: {
      const w = TYPE_WIDTH[type] || typeLength;
      const joined = new Uint8Array(n * w);
      for (let i = 0; i < n; i++) for (let k = 0; k < w; k++) joined[i * w + k] = data[pos + k * n + i];
      return readPlain(type, joined, 0, n, typeLength).values;
    }
    default:
      throw new Error(`Parquet encoding ${encoding} is not supported by this viewer`);
  }
}
