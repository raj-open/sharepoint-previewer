import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { esc, formatBytes, csvCell, nextFrame } = await load('_core/util.ts');

describe('util', () => {
    it('esc: HTML special characters', () => {
        assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    });
    it('formatBytes: units', () => {
        assert.deepEqual([512, 1536, 5 * 1024 ** 2, 3 * 1024 ** 3].map(formatBytes), [
            '512 B',
            '1.5 KB',
            '5.0 MB',
            '3.00 GB',
        ]);
    });
    it('csvCell: quotes only when needed; null is empty', () => {
        assert.equal(csvCell('plain'), 'plain');
        assert.equal(csvCell('a,b'), '"a,b"');
        assert.equal(csvCell('say "hi"'), '"say ""hi"""');
        assert.equal(csvCell('two\nlines'), '"two\nlines"');
        assert.equal(csvCell(null), '');
    });
    it('nextFrame: resolves', async () => {
        await nextFrame();
    });
});
