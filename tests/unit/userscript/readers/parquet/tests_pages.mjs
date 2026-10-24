// Parquet pages: RLE / bit-packed hybrid, plain values, decompression
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { load } from '../../../helpers.mjs';

const { readHybrid, readPlain, decompress } = await load('readers/parquet/pages.js');

describe('readers/parquet/pages', () => {
  it('hybrid: RLE run', () => {
    const bytes = new Uint8Array([5 << 1, 1]); // 5 × value 1, width 1
    assert.deepEqual(readHybrid(bytes, 0, bytes.length, 1, 5, []), [1, 1, 1, 1, 1]);
  });
  it('hybrid: bit-packed group of 8', () => {
    // width 2: values 0,1,2,3,0,1,2,3 -> bytes 0b11100100 twice
    const bytes = new Uint8Array([(1 << 1) | 1, 0b11100100, 0b11100100]);
    assert.deepEqual(readHybrid(bytes, 0, bytes.length, 2, 8, []), [0, 1, 2, 3, 0, 1, 2, 3]);
  });
  it('plain: INT32, DOUBLE, BYTE_ARRAY, BOOLEAN', () => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setInt32(0, -7, true);
    new DataView(b.buffer).setInt32(4, 42, true);
    assert.deepEqual(readPlain(1, b, 0, 2).values, [-7, 42]);
    const d = new Uint8Array(8);
    new DataView(d.buffer).setFloat64(0, 1.5, true);
    assert.deepEqual(readPlain(5, d, 0, 1).values, [1.5]);
    const s = new Uint8Array([2, 0, 0, 0, 104, 105]);
    assert.equal(new TextDecoder().decode(readPlain(6, s, 0, 1).values[0]), 'hi');
    assert.deepEqual(readPlain(0, new Uint8Array([0b101]), 0, 3).values, [true, false, true]);
  });
  it('decompress: none and GZIP', async () => {
    const data = new TextEncoder().encode('page data '.repeat(20));
    assert.equal(await decompress(0, data, data.length), data);
    const gz = new Uint8Array(zlib.gzipSync(data));
    assert.deepEqual([...(await decompress(2, gz, data.length))], [...data]);
  });
});
