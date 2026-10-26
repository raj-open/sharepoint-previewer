// Bytes and texts shared by the readers
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { concatBytes, dataView, u32, latin1, utf8, utf16le } = await load('readers/bytes.ts');

describe('readers/bytes', () => {
    it('concatBytes: in order; one part as it is', () => {
        const one = new Uint8Array([1]);
        assert.deepEqual([...concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])])], [1, 2, 3]);
        assert.equal(concatBytes([one]), one);
    });
    it('dataView of a part of a buffer', () => {
        assert.equal(dataView(new Uint8Array([9, 8, 7]).subarray(1)).getUint8(0), 8);
    });
    it('u32: little-endian, unsigned', () => {
        assert.equal(u32(new Uint8Array([0, 1, 0, 0, 0xff, 0xff, 0xff, 0xff]), 0), 256);
        assert.equal(u32(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 0), 4294967295);
    });
    it('latin1: code points up to U+00FF, also long texts', () => {
        assert.equal(latin1(new Uint8Array([0x41, 0xe9, 0xff])), 'Aéÿ');
        assert.equal(latin1(new Uint8Array(20000).fill(0x61)).length, 20000);
    });
    it('decoders', () => {
        assert.equal(utf8.decode(new Uint8Array([0xc3, 0xa4])), 'ä');
        assert.equal(utf16le.decode(new Uint8Array([0x41, 0])), 'A');
    });
});
