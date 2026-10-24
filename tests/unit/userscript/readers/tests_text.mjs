// Text files: chunks by range, encoding from the first bytes, binary files refused
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load, serve } from '../../helpers.mjs';

const { openSource, sniffText, responseDates } = await load('readers/text.js');
const { MAX_BYTES } = await load('settings.js');
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

  it('responseDates: from Last-Modified, in UTC', () => {
    const res = new Response('', { headers: { 'last-modified': 'Thu, 01 Oct 2026 12:00:00 GMT' } });
    assert.equal(responseDates(res, '').modified, '2026-10-01 12:00:00 UTC');
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

  it('server without ranges: same text', async () => {
    serve({ '/f.txt': 'äöü' }, { ranges: false });
    assert.equal((await open('/f.txt')).text, 'äöü');
  });

  it('binary files and other origins are refused', async () => {
    serve({ '/x.pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]) });
    assert.equal((await open('/x.pdf')).binary, true);
    assert.match((await open('https://example.com/x.txt')).error, /outside this SharePoint/);
  });
});
