import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load, serve } from '../../helpers.mjs';

const { openRanges, concatBytes, dataView } = await load('readers/ranges.js');
const signal = () => new AbortController().signal;
const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);

describe('readers/ranges', () => {
  it('size and signature from a small request, then parts on demand', async () => {
    const requests = serve({ '/f.bin': bytes });
    const progress = [];
    const file = await openRanges('/f.bin', signal, false, (a, b) => progress.push([a, b]));
    assert.equal(file.size, 1000);
    assert.deepEqual([...file.head], [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual([...(await file.read(500, 504))], [244, 245, 246, 247]);
    assert.deepEqual(
      requests.map((r) => r.range),
      ['bytes=0-7', 'bytes=500-503'],
    );
    assert.equal(file.fetched(), 12);
    assert.deepEqual(progress.at(-1), [12, 1000]);
    assert.equal(file.whole(), false);
  });

  it('server ignores ranges: whole file once, no more requests', async () => {
    const requests = serve({ '/f.bin': bytes }, { ranges: false });
    const file = await openRanges('/f.bin', signal, false, () => {});
    assert.equal(file.whole(), true);
    assert.deepEqual([...(await file.read(998, 2000))], [230, 231]);
    assert.equal(requests.length, 1);
  });

  it('errors and other origins', async () => {
    serve({});
    assert.match((await openRanges('/missing', signal, false, () => {})).error, /404/);
    assert.match((await openRanges('https://example.com/x', signal, false, () => {})).error, /outside/);
  });

  it('concatBytes, dataView', () => {
    const joined = concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])]);
    assert.deepEqual([...joined], [1, 2, 3]);
    assert.equal(dataView(joined.subarray(1)).getUint8(0), 2);
  });
});
