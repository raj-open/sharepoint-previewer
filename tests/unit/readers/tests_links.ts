// .url shortcut files: target inside this SharePoint is followed, others only shown
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { setLocation } from '../helpers.ts';

const { linkTarget } = await load('readers/links.ts');
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
});
