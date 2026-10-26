// ZSTD (RFC 8878): frames written by Node's own zlib (raw, RLE and compressed blocks)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import zlib from 'node:zlib';
import { load } from '../../helpers.ts';

const { unzstd } = await load('readers/codecs/zstd.ts');
const roundTrip = (data, level = 3) => {
    const packed = new Uint8Array(
        zlib.zstdCompressSync(data, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } }),
    );
    return Buffer.from(unzstd(packed, data.length));
};

describe('readers/codecs/zstd', { skip: !zlib.zstdCompressSync && 'Node without zstd' }, () => {
    it('text, several levels', () => {
        const data = Buffer.from('Parquet pages are compressed one by one. '.repeat(500));
        for (const level of [1, 3, 9, 19]) assert.deepEqual(roundTrip(data, level), data);
    });
    it('random bytes (raw blocks)', () => {
        let seed = 7;
        const next = () => {
            seed = (seed * 48271) % 2147483647;
            return seed & 255;
        };
        const data = Buffer.from(Array.from({ length: 50000 }, next));
        assert.deepEqual(roundTrip(data), data);
    });
    it('one byte repeated (RLE)', () => {
        const data = Buffer.alloc(100000, 0x2a);
        assert.deepEqual(roundTrip(data), data);
    });
    it('structured numbers (Huffman literals, repeat offsets)', () => {
        const data = Buffer.from(
            Array.from({ length: 20000 }, (_, i) => `${i},${(i * 7) % 13},${i % 3 ? 'a' : 'bb'}\n`).join(''),
        );
        assert.deepEqual(roundTrip(data, 12), data);
    });
});
