// .url shortcut files: target inside this Sharepoint is followed, others only shown; clean URLs
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { setLocation } from '../helpers.ts';

const { linkTarget } = await load('readers/links.ts');
const { cleanUrl } = await load('readers/links.ts');
setLocation('https://acme.sharepoint.com/sites/Test/Shared%20Documents/Forms/AllItems.aspx');
const url = (target) => `[InternetShortcut]\nURL=${target}\n`;

describe('readers/links', () => {
    it('viewer page with id parameter', () => {
        const t = linkTarget(
            'x.url',
            url(
                'https://acme.sharepoint.com/sites/Test/Shared%20Documents/Forms/AllItems.aspx?id=/sites/Test/Shared%20Documents/a%20b.txt',
            ),
        );
        assert.equal(t.name, 'a b.txt');
        assert.equal(t.fetchUrl, '/sites/Test/Shared%20Documents/a%20b.txt');
    });
    it('direct link /:t:/r/…', () => {
        const t = linkTarget('x.url', url('https://acme.sharepoint.com/:t:/r/sites/Test/Docs/n.txt?web=1'));
        assert.equal(t.fetchUrl, '/sites/Test/Docs/n.txt');
        assert.equal(t.name, 'n.txt');
    });
    it('share link: raw file asked for', () => {
        const t = linkTarget('x.url', url('https://acme.sharepoint.com/:t:/s/Test/AbC?web=1'));
        assert.match(t.fetchUrl, /download=1/);
        assert.doesNotMatch(t.fetchUrl, /web=1/);
    });
    it('other sites: named, fetch refused later', () => {
        assert.equal(linkTarget('x.url', url('https://example.com/f.txt')).fetchUrl, 'https://example.com/f.txt');
    });
    it('not a link file', () => {
        assert.equal(linkTarget('notes.txt', 'plain text'), null);
        assert.equal(linkTarget('x.url', '[InternetShortcut]\n'), null);
    });
    it('clean URL of a path: origin added, not encoded, no trailing "/"', () => {
        assert.equal(cleanUrl('/sites/Test/Docs/a b%.txt'), 'https://acme.sharepoint.com/sites/Test/Docs/a b%.txt');
        assert.equal(cleanUrl('/sites/Test/Docs/'), 'https://acme.sharepoint.com/sites/Test/Docs');
    });
    it('clean URL of a viewer page or direct link: the file it stands for, no query', () => {
        const base = 'https://acme.sharepoint.com';
        assert.equal(
            cleanUrl(`${base}/sites/Test/Docs/Forms/AllItems.aspx?id=%2Fsites%2FTest%2FDocs%2Fa%20b.txt&parent=%2F`),
            `${base}/sites/Test/Docs/a b.txt`,
        );
        assert.equal(cleanUrl(`${base}/:t:/r/sites/Test/Docs/n%C3%A4.txt?web=1#x`), `${base}/sites/Test/Docs/nä.txt`);
    });
    it('clean URL elsewhere: path decoded, query dropped', () => {
        assert.equal(cleanUrl('https://example.com/a%20b/f.txt?x=1'), 'https://example.com/a b/f.txt');
    });
});
