// Snappy raw format: hand-made streams (literal, copies with 1- and 2-byte offsets)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../../helpers.ts';

const { unsnappy } = await load('readers/codecs/snappy.ts');
const text = (b) => new TextDecoder().decode(b);

describe('readers/codecs/snappy', () => {
    it('literal only', () => {
        assert.equal(text(unsnappy(new Uint8Array([5, (5 - 1) << 2, ...new TextEncoder().encode('hello')]))), 'hello');
    });
    it('copy with 1-byte offset (overlapping)', () => {
        // "abc" + copy(offset 3, length 6) = "abcabcabc"
        const src = new Uint8Array([9, (3 - 1) << 2, 97, 98, 99, ((6 - 4) << 2) | 1, 3]);
        assert.equal(text(unsnappy(src)), 'abcabcabc');
    });
    it('copy with 2-byte offset', () => {
        // "xy" + copy(offset 2, length 4) = "xyxyxy"
        const src = new Uint8Array([6, (2 - 1) << 2, 120, 121, ((4 - 1) << 2) | 2, 2, 0]);
        assert.equal(text(unsnappy(src)), 'xyxyxy');
    });
});
