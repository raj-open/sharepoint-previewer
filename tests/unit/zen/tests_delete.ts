// Zen list delete: the question (number, names, folders warned of), the keys, each item to the recycle bin (purge: for good)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { deleteItems, deleteQuestion, isDeleteKey, isPurgeKey, removeItem } = await load('zen/delete.ts');

const LIB = '/sites/A/Docs';
const item = (id: number, name: string, folder = false) => ({
    id,
    name,
    path: `${LIB}/${name}`,
    folder,
    text: {},
    raw: {},
});

/** fetch of the API: form digest, then recycle() answered by `answer` per item id; requests recorded */
function serve(answer: (id: number) => Response): { url: string; method: string }[] {
    const seen: { url: string; method: string }[] = [];
    globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
        seen.push({ url: String(url), method: init.method ?? 'GET' });
        if (String(url).endsWith('/_api/contextinfo')) return Response.json({ FormDigestValue: 'D' });
        return answer(Number(/items\((\d+)\)/.exec(String(url))?.[1]));
    }) as typeof fetch;
    return seen;
}

describe('zen/delete', () => {
    it('question: number and names; folders marked and warned of (all in them); the recycle bin named', () => {
        const one = deleteQuestion([item(1, 'a.txt')]);
        assert.match(one, /^Delete 1 item\?/);
        assert.match(one, /• a\.txt\n/);
        assert.doesNotMatch(one, /everything in them/);
        assert.match(one, /recycle bin/);
        const two = deleteQuestion([item(1, 'a.txt'), item(2, 'Sub', true)]);
        assert.match(two, /^Delete 2 items\?/);
        assert.match(two, /• Sub \(folder\)/);
        assert.match(two, /The folder is deleted with everything in them/);
        const folders = deleteQuestion([item(1, 'X', true), item(2, 'Y', true)]);
        assert.match(folders, /The 2 folders are deleted/);
    });

    it('question: at most 20 names, the others counted', () => {
        const many = Array.from({ length: 25 }, (_, i) => item(i + 1, `f${i + 1}.txt`));
        const q = deleteQuestion(many);
        assert.match(q, /^Delete 25 items\?/);
        assert.match(q, /• f20\.txt/);
        assert.doesNotMatch(q, /• f21\.txt/);
        assert.match(q, /… and 5 more/);
    });

    it('question of a purge: said so (for good), warned it cannot be restored; folders: purged with all in them', () => {
        const q = deleteQuestion([item(1, 'a.txt'), item(2, 'Sub', true)], true);
        assert.match(q, /^PURGE 2 items for good\?/);
        assert.match(q, /• Sub \(folder\)/);
        assert.match(q, /The folder is purged with everything in them/);
        assert.match(q, /do NOT go to the site's recycle bin: they cannot be restored/);
        assert.doesNotMatch(deleteQuestion([item(1, 'a.txt')]), /PURGE|cannot be restored/);
    });

    it('purge keys: Shift + Delete, Cmd + Alt + Backspace; not the delete keys', () => {
        const key = (key: string, more = {}) => ({ key, metaKey: false, shiftKey: false, altKey: false, ...more });
        assert.equal(isPurgeKey(key('Delete', { shiftKey: true })), true);
        assert.equal(isPurgeKey(key('Backspace', { metaKey: true, altKey: true })), true);
        assert.equal(isPurgeKey(key('Delete')), false);
        assert.equal(isPurgeKey(key('Backspace', { metaKey: true })), false);
        assert.equal(isPurgeKey(key('Backspace', { shiftKey: true })), false);
        assert.equal(isDeleteKey(key('Delete', { shiftKey: true })), false, 'a purge is no delete');
    });

    it('keys: Delete, Cmd + Backspace; not Backspace alone, nor with Shift or Alt', () => {
        const key = (key: string, more = {}) => ({ key, metaKey: false, shiftKey: false, altKey: false, ...more });
        assert.equal(isDeleteKey(key('Delete')), true);
        assert.equal(isDeleteKey(key('Backspace', { metaKey: true })), true);
        assert.equal(isDeleteKey(key('Backspace')), false);
        assert.equal(isDeleteKey(key('Delete', { shiftKey: true })), false);
        assert.equal(isDeleteKey(key('Delete', { altKey: true })), false);
        assert.equal(isDeleteKey(key('d')), false);
    });

    it("recycle(): POST of the list item (by id, the library as @list), with the site's form digest", async () => {
        const seen = serve(() => Response.json({ value: '00000000-0000-4000-8000-000000000007' }));
        assert.equal(await removeItem(LIB, 7), '');
        const last = seen[seen.length - 1];
        assert.equal(last.method, 'POST');
        const url = new URL(last.url, 'https://acme.sharepoint.com');
        assert.equal(url.pathname, '/sites/A/_api/web/GetList(@list)/items(7)/recycle()');
        assert.equal(url.searchParams.get('@list'), `'${LIB}'`);
    });

    it('purge: deleteObject() of the list item; an empty answer is done', async () => {
        const seen = serve(() => new Response('', { status: 200 }));
        assert.equal(await removeItem(LIB, 7, true), '');
        const url = new URL(seen[seen.length - 1].url, 'https://acme.sharepoint.com');
        assert.equal(url.pathname, '/sites/A/_api/web/GetList(@list)/items(7)/deleteObject()');
        const said: string[] = [];
        assert.deepEqual(await deleteItems(LIB, [item(1, 'a.txt')], (t: string) => said.push(t), true), []);
        assert.deepEqual(said, ['Purging 1 / 1 …']);
    });

    it('items one by one, progress said; refused ones returned with why (the others deleted)', async () => {
        serve((id) =>
            id === 2
                ? Response.json({ 'odata.error': { message: { value: 'Access denied.' } } }, { status: 403 })
                : Response.json({ value: 'x' }),
        );
        const said: string[] = [];
        const items = [item(1, 'a.txt'), item(2, 'b.txt'), item(3, 'Sub', true)];
        const failed = await deleteItems(LIB, items, (t: string) => said.push(t));
        assert.deepEqual(said, ['Deleting 1 / 3 …', 'Deleting 2 / 3 …', 'Deleting 3 / 3 …']);
        assert.equal(failed.length, 1);
        assert.equal(failed[0].item.name, 'b.txt');
        assert.equal(failed[0].why, 'HTTP 403: Access denied.');
    });
});
