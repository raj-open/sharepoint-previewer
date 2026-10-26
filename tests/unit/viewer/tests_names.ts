// File names: checks, where an edit goes, title
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { element } from '../helpers.ts';
import { fakeViewer } from '../helpers.ts';
import { load } from '../helpers.ts';
import { setLocation } from '../helpers.ts';

const { nameProblem, target, nameFree, showName, uploadQuestion, askName } = await load('viewer/names.ts');
setLocation('https://acme.sharepoint.com/sites/Test/Shared%20Documents/Forms/AllItems.aspx');

const FILE = { name: 'notes.txt', url: '/sites/Test/Shared Documents/notes.txt' };

describe('viewer/names', () => {
    it('names SharePoint refuses', () => {
        assert.equal(nameProblem('copy of notes.txt'), '');
        assert.equal(nameProblem('#1 50%.txt'), '');
        for (const bad of [
            '',
            '  ',
            ' a.txt',
            'a.txt ',
            'a:b.txt',
            'a/b.txt',
            'a|b',
            'a.',
            'CON',
            '~$a.txt',
            'x_vti_y',
        ])
            assert.notEqual(nameProblem(bad), '', bad);
    });
    it('target: own name, or a new file beside it (case ignored)', () => {
        const v = fakeViewer({ file: FILE });
        assert.deepEqual(target(v), { ...FILE, isNew: false });
        assert.deepEqual(target(v, 'NOTES.TXT').isNew, false);
        assert.deepEqual(target(v, 'b.txt'), { name: 'b.txt', url: '/sites/Test/Shared Documents/b.txt', isNew: true });
        v.newName = 'c.txt';
        assert.equal(target(v).name, 'c.txt');
    });
    it('name free: no question if no such file; else asks', async () => {
        const t = { name: 'b.txt', url: '/sites/Test/Shared Documents/b.txt', isNew: true };
        let asked = 0;
        globalThis.confirm = () => {
            asked++;
            return false;
        };
        globalThis.fetch = async () => new Response(null, { status: 404 });
        assert.equal(await nameFree(t), true);
        globalThis.fetch = async () => new Response(null, { headers: { etag: '"1"' } });
        assert.equal(await nameFree(t), false);
        assert.equal(asked, 1);
    });
    it('title: name the edit goes to; marked when new; clickable in write mode', () => {
        const v = fakeViewer({ file: FILE, titleName: element() });
        showName(v);
        assert.equal(v.titleName.textContent, 'notes.txt');
        assert.equal(v.titleName.classList.contains('tp-renamable'), false);
        v.writeMode = true;
        v.newName = 'b.txt';
        showName(v);
        assert.equal(v.titleName.textContent, 'b.txt');
        assert.equal(v.titleName.classList.contains('tp-new-name'), true);
        assert.equal(v.titleName.classList.contains('tp-renamable'), true);
        assert.match(v.titleName.title, /"notes\.txt" stays unchanged/);
    });
    it('title: files reached through a link keep their path', () => {
        const v = fakeViewer({ file: FILE, titleName: element(), linked: true });
        v.titleName.textContent = 'link.url → notes.txt';
        showName(v);
        assert.equal(v.titleName.textContent, 'link.url → notes.txt');
    });
    it('question before upload: new or replaced, original stays', () => {
        const v = fakeViewer({ file: FILE });
        const t = target(v, 'b.txt');
        assert.match(uploadQuestion(v, t, false), /new file "b\.txt"[\s\S]*"notes\.txt" stays unchanged/);
        assert.match(uploadQuestion(v, t, true), /already exists/);
    });
    it('new file: always a new target; no original named before upload', () => {
        const v = fakeViewer({ file: FILE, source: { text: '', fresh: true } });
        assert.equal(target(v).isNew, true);
        assert.doesNotMatch(uploadQuestion(v, target(v), false), /stays unchanged/);
    });
    it('asking for a name: trimmed, refused ones asked again, cancel gives null', async () => {
        const answers = ['a|b.txt', '  todo.md  '];
        const alerts: string[] = [];
        globalThis.prompt = () => answers.shift() ?? null;
        globalThis.alert = (m: string) => void alerts.push(m);
        globalThis.fetch = async () => new Response(null, { status: 404 });
        assert.equal(await askName('/sites/Test/Shared Documents'), 'todo.md');
        assert.equal(alerts.length, 1);
        assert.equal(await askName('/sites/Test/Shared Documents'), null);
    });
});
