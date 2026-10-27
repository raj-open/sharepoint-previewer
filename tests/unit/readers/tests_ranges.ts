// Files by byte range: one first request, small reads widened and kept, whole file if ranges are ignored
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { serve } from '../helpers.ts';

const { openRanges, READ_MIN } = await load('readers/ranges.ts');
const signal = () => new AbortController().signal;
const content = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 256);

describe('readers/ranges', () => {
    it('small file: all of it with the first request, nothing more', async () => {
        const requests = serve({ '/f.bin': content(1000) });
        const progress: [number, number][] = [];
        const file = await openRanges('/f.bin', signal, false, (a, b) => progress.push([a, b]));
        assert.equal(file.size, 1000);
        assert.deepEqual([...file.head], [0, 1, 2, 3, 4, 5, 6, 7]);
        assert.deepEqual([...(await file.read(500, 504))], [244, 245, 246, 247]);
        assert.deepEqual(
            requests.map((r) => r.range),
            [`bytes=0-${READ_MIN - 1}`],
        );
        assert.equal(file.whole(), true);
        assert.deepEqual(progress.at(-1), [1000, 1000]);
    });

    it('big file: small reads widened to READ_MIN, kept pieces read again without requests', async () => {
        const size = 5 * READ_MIN;
        const bytes = content(size);
        const requests = serve({ '/f.bin': bytes });
        const file = await openRanges('/f.bin', signal, false, () => {});
        assert.equal(file.size, size);
        assert.equal(file.whole(), false);
        assert.deepEqual([...(await file.read(100, 104))], [...bytes.subarray(100, 104)]); // first request holds it
        const at = 2 * READ_MIN + 10;
        assert.deepEqual([...(await file.read(at, at + 4))], [...bytes.subarray(at, at + 4)]);
        assert.deepEqual([...(await file.read(at + 100, at + 200))], [...bytes.subarray(at + 100, at + 200)]); // kept
        assert.deepEqual([...(await file.read(size - 22, size))], [...bytes.subarray(size - 22)]); // near the end
        assert.deepEqual(
            requests.map((r) => r.range),
            [
                `bytes=0-${READ_MIN - 1}`,
                `bytes=${at}-${at + READ_MIN - 1}`,
                `bytes=${size - READ_MIN}-${size - 1}`, // widened backwards
            ],
        );
        assert.equal(file.fetched(), 3 * READ_MIN);
    });

    it('big reads pass through, exact bytes', async () => {
        const size = 12 * READ_MIN;
        const bytes = content(size);
        serve({ '/f.bin': bytes });
        const file = await openRanges('/f.bin', signal, false, () => {});
        const part = await file.read(READ_MIN, 11 * READ_MIN);
        assert.equal(part.length, 10 * READ_MIN);
        assert.equal(part[5], bytes[READ_MIN + 5]);
    });

    it('server ignores ranges: whole file once, no more requests', async () => {
        const requests = serve({ '/f.bin': content(1000) }, { ranges: false });
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
});
