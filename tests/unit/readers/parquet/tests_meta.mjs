// Parquet metadata: Thrift compact protocol, footer, leaf columns
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixture, load } from '../../helpers.mjs';

const { thriftReader, parseFooter, leafColumns, bitWidth, PARQUET_RE, CODEC_NAMES } =
  await load('readers/parquet/meta.js');
const { u32 } = await load('readers/bytes.js');

const footerOf = (bytes) => {
  const len = u32(bytes, bytes.length - 8);
  return bytes.subarray(bytes.length - 8 - len, bytes.length - 8);
};

describe('readers/parquet/meta', () => {
  it('thrift: struct with i32, string, list, bool', () => {
    // field 1: i32 (zigzag 150 -> 300), field 2: binary "ab", field 3: list<i32> [1, 2], field 4: true
    const bytes = new Uint8Array([0x15, 0xac, 0x02, 0x18, 2, 97, 98, 0x19, 0x25, 2, 4, 0x11, 0]);
    const s = thriftReader(bytes).struct();
    assert.equal(s[1], 150);
    assert.equal(new TextDecoder().decode(s[2]), 'ab');
    assert.deepEqual(s[3], [1, 2]);
    assert.equal(s[4], true);
  });

  it('footer of a real file: rows, schema, row groups', () => {
    const meta = parseFooter(footerOf(fixture('Data/people.parquet')));
    assert.ok(meta.numRows > 0);
    assert.ok(meta.rowGroups.length >= 1);
    const leaves = leafColumns(meta.schema);
    assert.ok(leaves.some((c) => c.name === 'name'));
    assert.ok(leaves.every((c) => c.maxDef >= 0 && c.maxRep >= 0));
  });

  it('helpers', () => {
    assert.deepEqual([0, 1, 2, 3, 255].map(bitWidth), [0, 1, 2, 2, 8]);
    assert.ok(PARQUET_RE.test('a.PARQUET'));
    assert.equal(CODEC_NAMES[1], 'SNAPPY');
  });
});
