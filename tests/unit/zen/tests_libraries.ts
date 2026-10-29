// Document libraries of the Zen list's site: system ones left out, by title, read once per site
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { setLocation } from '../helpers.ts';

const { loadLibraries, toLibraries } = await load('zen/libraries.ts');

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

describe('zen/libraries', () => {
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

    it('read once per site; refusal said and read again next time', async () => {
        setLocation(`${SITE}/Reports/Forms/AllItems.aspx`);
        const urls: string[] = [];
        let refuse = true;
        globalThis.fetch = (async (url: string | URL) => {
            urls.push(decodeURIComponent(String(url)));
            return refuse ? new Response('', { status: 403 }) : Response.json({ value: LISTS });
        }) as typeof fetch;
        assert.match(await loadLibraries(SITE), /^libraries: HTTP 403/);
        refuse = false;
        const libraries = await loadLibraries(SITE);
        assert.deepEqual(
            libraries.map((lib: { title: string }) => lib.title),
            ['Documents', 'Reports'],
        );
        assert.ok(
            urls.every((u) => u.startsWith(`${SITE}/_api/web/lists?$filter=BaseTemplate eq 101 and Hidden eq false`)),
        );
        const n = urls.length;
        assert.equal(await loadLibraries(SITE), libraries);
        assert.equal(urls.length, n, 'read once');
    });
});
