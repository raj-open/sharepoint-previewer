// Search: path of a file below the open folder, from SharePoint's search index
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.mjs';
import { setLocation } from '../helpers.mjs';

const { findFile } = await load('readers/search.js');
const { foundPaths } = await load('readers/search.js');

const FOLDER = '/teams/T/Shared Documents/Sandbox';

/** fetch() answering a search query with the given absolute paths; records request URLs */
function answer(paths, status = 200) {
    const urls = [];
    globalThis.fetch = async (url) => {
        urls.push(String(url));
        const Rows = paths.map((p) => ({ Cells: [{ Key: 'Path', Value: p }] }));
        return new Response(JSON.stringify({ PrimaryQueryResult: { RelevantResults: { Table: { Rows } } } }), {
            status,
        });
    };
    return urls;
}

describe('readers/search', () => {
    setLocation(`${FOLDER.replace(/ /g, '%20')}/Forms/AllItems.aspx`);
    const origin = location.origin;

    it('file in a sub-folder: its path; query on the site, by name below the folder', async () => {
        foundPaths.clear();
        const urls = answer([`${origin}/teams/T/Shared%20Documents/Sandbox/Logs/debug%201632.log`]);
        assert.equal(await findFile(FOLDER, 'debug 1632.log'), `${FOLDER}/Logs/debug 1632.log`);
        assert.match(urls[0], /^\/teams\/T\/_api\/search\/query\?querytext='/);
        assert.match(decodeURIComponent(urls[0]), /filename:"debug 1632\.log" path:"/);
    });
    it('found once: no second request', async () => {
        const urls = answer([]);
        assert.equal(await findFile(FOLDER, 'debug 1632.log'), `${FOLDER}/Logs/debug 1632.log`);
        assert.equal(urls.length, 0);
    });
    it('same name in folder and below: the one in the folder', async () => {
        foundPaths.clear();
        answer([`${origin}${FOLDER}/A/x.log`, `${origin}${FOLDER}/x.log`]);
        assert.equal(await findFile(FOLDER, 'x.log'), `${FOLDER}/x.log`);
    });
    it('other names and other folders are ignored', async () => {
        foundPaths.clear();
        answer([`${origin}${FOLDER}/x.log.bak`, `${origin}/teams/T/Other/x.log`]);
        assert.equal(await findFile(FOLDER, 'x.log'), null);
    });
    it('search failing: none', async () => {
        foundPaths.clear();
        answer([], 500);
        assert.equal(await findFile(FOLDER, 'x.log'), null);
    });
});
