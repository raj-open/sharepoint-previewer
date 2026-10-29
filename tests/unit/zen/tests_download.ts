// Zen list download: paths inside the folder shown; folders with all below them (depth first); limits
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { collect, relativePath } = await load('zen/download.ts');

const LIB = '/sites/A/Docs';
const item = (name: string, folder = false) => ({ id: 1, name, path: `${LIB}/${name}`, folder, text: {}, raw: {} });

describe('zen/download', () => {
    it('paths inside the folder shown (any case); elsewhere: the name', () => {
        assert.equal(relativePath(LIB, `${LIB}/Sub/a.txt`), 'Sub/a.txt');
        assert.equal(relativePath(`${LIB}/`, `/sites/a/docs/x`), 'x');
        assert.equal(relativePath(`${LIB}/Sub`, '/elsewhere/b.txt'), 'b.txt');
    });

    it('folders with all below them, each before its contents; files of the selection as they are', async () => {
        const tree: Record<string, { name: string; path: string; folder: boolean }[]> = {
            [`${LIB}/Sub`]: [
                { name: 'z.txt', path: `${LIB}/Sub/z.txt`, folder: false },
                { name: 'Deep', path: `${LIB}/Sub/Deep`, folder: true },
            ],
            [`${LIB}/Sub/Deep`]: [{ name: 'd.txt', path: `${LIB}/Sub/Deep/d.txt`, folder: false }],
        };
        globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
            if (String(url).endsWith('/_api/contextinfo')) return Response.json({ FormDigestValue: 'D' });
            const folder = JSON.parse(String(init.body)).query.FolderServerRelativeUrl;
            const value = (tree[folder] ?? []).map((e, i) => ({
                Id: i + 1,
                FileLeafRef: e.name,
                FileRef: e.path,
                FSObjType: e.folder ? 1 : 0,
            }));
            return Response.json({ value });
        }) as typeof fetch;
        const said: string[] = [];
        const out = await collect(
            LIB,
            LIB,
            [item('Sub', true), item('a.txt')],
            new AbortController().signal,
            (t: string) => said.push(t),
        );
        assert.deepEqual(
            out.map((e: { path: string }) => relativePath(LIB, e.path)),
            ['Sub', 'Sub/Deep', 'Sub/Deep/d.txt', 'Sub/z.txt', 'a.txt'],
        );
        assert.deepEqual(said, ['Listing Sub …', 'Listing Sub/Deep …']);
    });

    it('stopped: no more listing; a folder that cannot be read: said', async () => {
        const stop = new AbortController();
        stop.abort();
        assert.equal(await collect(LIB, LIB, [item('Sub', true)], stop.signal, () => {}), 'stopped');
        globalThis.fetch = (async (url: string | URL) =>
            String(url).endsWith('/_api/contextinfo')
                ? Response.json({ FormDigestValue: 'D' })
                : new Response('', { status: 404 })) as typeof fetch;
        assert.equal(
            await collect(LIB, LIB, [item('Sub', true)], new AbortController().signal, () => {}),
            'Sub: HTTP 404',
        );
    });
});
