// Site of the Zen list: title and document libraries (system ones left out, by title), read once per site
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { setLocation } from '../helpers.ts';

const { loadSite, toLibraries } = await load('zen/site.ts');

const SITE = '/sites/A';
const LISTS = [
    {
        Title: 'Reports',
        DefaultViewUrl: `${SITE}/Reports/Forms/Board.aspx`,
        RootFolder: { ServerRelativeUrl: `${SITE}/Reports` },
    },
    { Title: 'Documents', RootFolder: { ServerRelativeUrl: `${SITE}/Shared Documents` } },
    { Title: 'Site Assets', RootFolder: { ServerRelativeUrl: `${SITE}/SiteAssets` } },
    { Title: 'Style Library', RootFolder: { ServerRelativeUrl: `${SITE}/Style Library` } },
    { Title: 'Formularvorlagen', RootFolder: { ServerRelativeUrl: `${SITE}/FormServerTemplates` } },
    { Title: 'Broken' },
];

describe('zen/site', () => {
    it("libraries: by title, Sharepoint's own left out (by root folder, any title); default view, else AllItems", () => {
        assert.deepEqual(toLibraries(LISTS), [
            {
                title: 'Documents',
                url: `${SITE}/Shared Documents/Forms/AllItems.aspx`,
                folder: `${SITE}/Shared Documents`,
            },
            { title: 'Reports', url: `${SITE}/Reports/Forms/Board.aspx`, folder: `${SITE}/Reports` },
        ]);
    });

    it('site: title and libraries, read once; refusal said and read again next time', async () => {
        setLocation(`${SITE}/Reports/Forms/AllItems.aspx`);
        const urls: string[] = [];
        let refuse = true;
        globalThis.fetch = (async (url: string | URL) => {
            const u = decodeURIComponent(String(url));
            urls.push(u);
            if (refuse) return new Response('', { status: 403 });
            if (u.includes('/_api/web/lists?')) return Response.json({ value: LISTS });
            return Response.json({ Title: 'Team A' });
        }) as typeof fetch;
        assert.match(await loadSite(SITE), /^libraries: HTTP 403/);
        refuse = false;
        const site = await loadSite(SITE);
        assert.equal(site.title, 'Team A');
        assert.equal(site.url, `${SITE}/_layouts/15/viewlsts.aspx`);
        assert.deepEqual(
            site.libraries.map((lib: { title: string }) => lib.title),
            ['Documents', 'Reports'],
        );
        assert.ok(
            urls.some((u) => u.includes(`${SITE}/_api/web/lists?$filter=BaseTemplate eq 101 and Hidden eq false`)),
        );
        const n = urls.length;
        assert.equal(await loadSite(SITE), site);
        assert.equal(urls.length, n, 'read once');
    });
});
