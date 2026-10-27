// Text files: chunks by range, encoding from the first bytes, binary files refused
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { serve } from '../helpers.ts';

const { openSource, sniffText } = await load('readers/text.ts');
const { MAX_BYTES } = await load('_core/settings.ts');
const signal = () => new AbortController().signal;
const open = (url) => openSource(url, signal, false, () => {});

describe('readers/text', () => {
    it('sniffText: BOMs, binary signatures, NUL bytes', () => {
        assert.equal(sniffText(new Uint8Array([0xff, 0xfe, 0x41, 0])), 'utf-16le');
        assert.equal(sniffText(new TextEncoder().encode('plain text')), 'utf-8');
        assert.equal(sniffText(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), null); // %PDF
        assert.equal(sniffText(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null); // ZIP
        assert.equal(sniffText(new Uint8Array([0x41, 0, 0x42])), null);
    });

    it('small file: whole, by range', async () => {
        const requests = serve({ '/f.txt': 'line 1\nline 2\n' });
        const src = await open('/f.txt');
        assert.equal(src.text, 'line 1\nline 2\n');
        assert.ok(src.done);
        assert.ok(requests.every((r) => r.range?.startsWith('bytes=')));
    });

    it('big file: chunk by chunk', async () => {
        const big = 'x'.repeat(MAX_BYTES * 2 + 10);
        serve({ '/big.txt': big });
        const src = await open('/big.txt');
        assert.equal(src.loaded, MAX_BYTES);
        assert.equal(src.done, false);
        await src.more();
        assert.equal(src.loaded, 2 * MAX_BYTES);
        await src.loadAll();
        assert.equal(src.text, big);
    });

    it('cache all: the rest in one request', async () => {
        const big = 'y'.repeat(MAX_BYTES * 5 + 3);
        const requests = serve({ '/big.txt': big });
        const src = await open('/big.txt');
        await src.loadAll();
        assert.equal(src.text, big);
        assert.ok(src.done);
        assert.deepEqual(
            requests.map((r) => r.range),
            [`bytes=0-${MAX_BYTES - 1}`, `bytes=${MAX_BYTES}-`],
        );
    });

    it('cache all: server cuts the rest short, chunks follow', async () => {
        const big = 'z'.repeat(MAX_BYTES * 4 + 7);
        const requests = serve({ '/big.txt': big }, { cap: MAX_BYTES * 2 });
        const src = await open('/big.txt');
        await src.loadAll();
        assert.equal(src.text, big);
        assert.ok(src.done);
        assert.ok(requests.length <= 4);
    });

    it('cache all: the one request fails, chunks follow', async () => {
        const big = 'w'.repeat(MAX_BYTES * 3 + 1);
        const requests = serve({ '/big.txt': big });
        const served = globalThis.fetch;
        globalThis.fetch = (async (url: string, init: { headers?: Record<string, string> }) => {
            if (init.headers?.Range?.endsWith('-')) throw new TypeError('network error');
            return served(url, init);
        }) as typeof fetch;
        const src = await open('/big.txt');
        await src.loadAll();
        assert.equal(src.text, big);
        assert.equal(requests.length, 4); // first chunk, then three more (the failed request is not served)
    });

    it('server without ranges: same text', async () => {
        serve({ '/f.txt': 'äöü' }, { ranges: false });
        assert.equal((await open('/f.txt')).text, 'äöü');
    });

    it('binary files and other origins are refused', async () => {
        serve({ '/x.pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]) });
        assert.equal((await open('/x.pdf')).binary, true);
        assert.match((await open('https://example.com/x.txt')).error, /outside this Sharepoint/);
    });
});
