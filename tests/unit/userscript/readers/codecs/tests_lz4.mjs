// LZ4 raw block: hand-made sequences (literals + match, last sequence literals only)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../../helpers.mjs';

const { unlz4 } = await load('readers/codecs/lz4.js');
const text = (b) => new TextDecoder().decode(b);

describe('readers/codecs/lz4', () => {
  it('literals, overlapping match, closing literals', () => {
    // token 0x32: 3 literals "abc", match length 2 + 4 = 6 at offset 3; token 0x10: 1 literal "d"
    const src = new Uint8Array([0x32, 97, 98, 99, 3, 0, 0x10, 100]);
    assert.equal(text(unlz4(src, 10)), 'abcabcabcd');
  });
  it('long literal run (length bytes after 15)', () => {
    const lit = 'x'.repeat(20);
    const src = new Uint8Array([0xf0, 20 - 15, ...new TextEncoder().encode(lit)]);
    assert.equal(text(unlz4(src, 20)), lit);
  });
});
