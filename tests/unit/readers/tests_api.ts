// Sharepoint REST API: site and library of a path, JSON reads, POSTs with a form digest (fetched once)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { setLocation } from '../helpers.ts';

const { apiAllowed, getJson, libraryOfPage, postJson, quote, siteOf } = await load('readers/api.ts');

/** fetch() answering by path; records method, path and headers */
function answer(
    replies: Record<string, { status?: number; body: unknown }>,
): { method: string; path: string; headers: Record<string, string> }[] {
    const calls: { method: string; path: string; headers: Record<string, string> }[] = [];
    globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
        const path = new URL(url, location.href).pathname;
        calls.push({ method: init.method ?? 'GET', path, headers: (init.headers ?? {}) as Record<string, string> });
        const r = replies[path] ?? { status: 404, body: {} };
        return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as typeof fetch;
    return calls;
}

describe('readers/api', () => {
    it('allowed by default (setting)', () => assert.equal(apiAllowed(), true));

    it('site of a path; library of the list view; OData strings', () => {
        assert.equal(siteOf('/sites/A/Shared Documents/x.txt'), '/sites/A');
        assert.equal(siteOf('/teams/B/Docs'), '/teams/B');
        assert.equal(siteOf('/Shared Documents/x.txt'), '');
        setLocation('/sites/A/Shared%20Documents/Forms/AllItems.aspx?id=x');
        assert.equal(libraryOfPage(), '/sites/A/Shared Documents');
        setLocation('/sites/A/SitePages/Home.aspx');
        assert.equal(libraryOfPage(), null);
        assert.equal(quote("it's"), "'it''s'");
    });

    it("reads: JSON, else why not (status with Sharepoint's message, other origin)", async () => {
        answer({
            '/sites/A/_api/ok': { body: { value: [1] } },
            '/sites/A/_api/no': { status: 500, body: { 'odata.error': { message: { value: 'threshold' } } } },
        });
        assert.deepEqual(await getJson('/sites/A/_api/ok'), { value: [1] });
        assert.equal(await getJson('/sites/A/_api/no'), 'HTTP 500: threshold');
        assert.equal(await getJson('https://elsewhere.example/_api/ok'), 'refused (other origin)');
    });

    it('writes: form digest of the site first (once), then the POST with it', async () => {
        const calls = answer({
            '/sites/A/_api/contextinfo': { body: { FormDigestValue: 'D1', FormDigestTimeoutSeconds: 1800 } },
            '/sites/A/_api/w': { body: { ok: true } },
        });
        assert.deepEqual(await postJson('/sites/A', '/sites/A/_api/w', { x: 1 }), { ok: true });
        assert.deepEqual(await postJson('/sites/A', '/sites/A/_api/w', { x: 2 }), { ok: true });
        assert.deepEqual(
            calls.map((c) => `${c.method} ${c.path}`),
            ['POST /sites/A/_api/contextinfo', 'POST /sites/A/_api/w', 'POST /sites/A/_api/w'],
        );
        assert.equal(calls[1].headers['X-RequestDigest'], 'D1');
    });

    it('writes: no digest, no POST', async () => {
        const calls = answer({ '/sites/B/_api/contextinfo': { status: 403, body: {} } });
        assert.match(await postJson('/sites/B', '/sites/B/_api/w', {}), /^no form digest: HTTP 403/);
        assert.equal(calls.length, 1);
    });
});
