// Search: path of a file below the open folder, from the library list or Sharepoint's search index
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { setLocation } from '../helpers.ts';

const { findFile } = await load('readers/search.ts');
const { foundPaths } = await load('readers/search.ts');
const { lookupNotes } = await load('readers/search.ts');

const FOLDER = '/teams/T/Shared Documents/Sandbox';

/**
 * fetch() answering list queries with `files` (server-relative, null = list refuses) and search queries
 * with `found` ({ Path, ParentLink?, Filename? }); records request URLs
 */
function answer({
    files = [],
    found = [],
    status = 200,
}: {
    files?: string[] | null;
    found?: Record<string, string>[];
    status?: number;
}): string[] {
    const urls: string[] = [];
    const fake = async (url: string | URL) => {
        urls.push(String(url));
        if (status !== 200) return new Response('', { status });
        if (String(url).includes('/_api/web/GetList(')) {
            if (files === null) return new Response('', { status: 500 }); // list view threshold
            return new Response(JSON.stringify({ value: files.map((FileRef) => ({ FileRef })) }));
        }
        const Rows = found.map((x) => ({ Cells: Object.entries(x).map(([Key, Value]) => ({ Key, Value })) }));
        return new Response(JSON.stringify({ PrimaryQueryResult: { RelevantResults: { Table: { Rows } } } }));
    };
    globalThis.fetch = fake as typeof fetch;
    return urls;
}

describe('readers/search', () => {
    setLocation(`${FOLDER.replace(/ /g, '%20')}/Forms/AllItems.aspx`.replace('/Sandbox', ''));
    const origin = location.origin;

    it('file in a sub-folder: from the library list, one request on the site', async () => {
        foundPaths.clear();
        const urls = answer({
            files: [`${FOLDER}/Logs/debug 1632.log`, '/teams/T/Shared Documents/Other/debug 1632.log'],
        });
        assert.equal(await findFile(FOLDER, 'debug 1632.log'), `${FOLDER}/Logs/debug 1632.log`);
        assert.equal(urls.length, 1);
        assert.match(urls[0], /^\/teams\/T\/_api\/web\/GetList\(@list\)\/items\?/);
        assert.match(
            decodeURIComponent(urls[0]),
            /FileLeafRef eq 'debug 1632\.log'.*@list='\/teams\/T\/Shared Documents'/,
        );
    });
    it('found once: no second request', async () => {
        const urls = answer({});
        assert.equal(await findFile(FOLDER, 'debug 1632.log'), `${FOLDER}/Logs/debug 1632.log`);
        assert.equal(urls.length, 0);
    });
    it('same name in folder and below: the one in the folder', async () => {
        foundPaths.clear();
        answer({ files: [`${FOLDER}/A/x.log`, `${FOLDER}/x.log`] });
        assert.equal(await findFile(FOLDER, 'x.log'), `${FOLDER}/x.log`);
    });
    it('list refuses (threshold): search index', async () => {
        foundPaths.clear();
        const urls = answer({
            files: null,
            found: [{ Path: `${origin}/teams/T/Shared%20Documents/Sandbox/Logs/x.log` }],
        });
        assert.equal(await findFile(FOLDER, 'x.log'), `${FOLDER}/Logs/x.log`);
        assert.match(
            decodeURIComponent(urls[1]),
            /\/_api\/search\/query\?querytext='\(filename:"x\.log" OR "x\.log"\) path:"/,
        );
    });
    it('search: form instead of file (Parquet): parent folder and file name', async () => {
        foundPaths.clear();
        answer({
            files: null,
            found: [
                {
                    Path: `${origin}/teams/T/Shared%20Documents/Forms/DispForm.aspx?ID=7`,
                    ParentLink: `${origin}/teams/T/Shared Documents/Sandbox/logs`,
                    Filename: 'E_1.parquet',
                },
            ],
        });
        assert.equal(await findFile(FOLDER, 'E_1.parquet'), `${FOLDER}/logs/E_1.parquet`);
    });
    it('other names and other folders are ignored', async () => {
        foundPaths.clear();
        answer({ files: [`${FOLDER}/x.log.bak`, '/teams/T/Other/x.log'] });
        assert.equal(await findFile(FOLDER, 'x.log'), null);
    });
    it('requests failing: none, and how the lookup went', async () => {
        foundPaths.clear();
        answer({ status: 500 });
        assert.equal(await findFile(FOLDER, 'x.log'), null);
        assert.match(lookupNotes.get(`${FOLDER}/x.log`) ?? '', /library list: HTTP 500\nsearch: HTTP 500/);
    });
});
