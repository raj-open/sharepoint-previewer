// Explorative tests: the fake SharePoint on http://localhost:<port>, with the userscript (/src/main.js) injected.
//
//   node tests/explore/server.mjs <port> [folder]    (cf. `just tests-explore`)
//
// - library: folders "Mock Data" (/tests/fake-sharepoint/library) and "Data" (/data, local only; if there);
//   with a folder given, that folder is the library; read afresh per request (read only)
// - userscript: read afresh per page load, so `just build-src` + reload picks up changes
// - Tampermonkey: stood in for by ./tampermonkey.js (settings in localStorage, menu commands as a panel);
//   its panel (and the console) names each library folder and the folder it serves
// - 3D files: those of the release in /dist/v<VERSION> (`just build`), listed in the library as folder "previewer";
//   the setting `viewer-3d-folder` points there unless set (filled in when empty)
// - logo: a test logo (setting `logo`), filled in when empty
// - listens on the loopback interface only; logs each request to the console

// ================================================================
// IMPORTS
// ================================================================

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as sharepoint from '../fake-sharepoint/server.mjs';
import { userscript } from '../fake-sharepoint/userscript.mjs';

// ================================================================
// CONSTANTS
// ================================================================

const HOST = '127.0.0.1';
const PREFIX = '/__explore__';
const PATH_SHIM = path.join(import.meta.dirname, 'tampermonkey.js');
const VERSION = `${sharepoint.VERSION}-explore`;

// Logo shown in the viewer (setting `logo`): a sprout in soil under a sky; base64, as the userscript takes only that
const LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#4fa3e0"/><stop offset="1" stop-color="#bfe3f7"/></linearGradient></defs>' +
    '<rect width="32" height="32" rx="7" fill="url(#sky)"/>' +
    '<circle cx="16" cy="5" r="2.6" fill="#fff3b0"/>' +
    '<path d="M16 24V14" stroke="#3f8f3a" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
    '<path d="M16 16C15 10 10 7 4 8c0 6 5 9 12 8z" fill="#5fb548"/>' +
    '<path d="M16 13c1-5 5-8 11-7 0 5-4 8-11 7z" fill="#7cc95e"/>' +
    '<path d="M0 25Q16 19 32 25A7 7 0 0 1 25 32H7A7 7 0 0 1 0 25z" fill="#6b4423"/>' +
    '<circle cx="9" cy="27.5" r="1" fill="#8a5a33"/><circle cx="22" cy="27" r="1.2" fill="#8a5a33"/></svg>';
const LOGO = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

const SCRIPT_TYPE = 'application/javascript; charset=utf-8';
const NO_CACHE = { 'cache-control': 'no-store' };

// Library root without a folder given: test fixtures and the repo's own (local) data
const ROOT = path.resolve(import.meta.dirname, '../..');
const MOUNTS = { 'Mock Data': sharepoint.PATH_FILES, 'Data': path.join(ROOT, 'data') };

// ================================================================
// METHODS
// ================================================================

// --------------------------------
// replies
// --------------------------------

/** @param {string} body @returns {import('../fake-sharepoint/server.mjs').Reply} */
const script = (body) => ({ status: 200, headers: { 'content-type': SCRIPT_TYPE, ...NO_CACHE }, body });

/** @param {string} location @returns {import('../fake-sharepoint/server.mjs').Reply} */
const redirect = (location) => ({ status: 302, headers: { location }, body: '' });

/** @param {string} dir @returns {string} relative to the working folder, if inside it */
const shortPath = (dir) => {
    const rel = path.relative(process.cwd(), dir);
    return rel && !rel.startsWith('..') ? rel : dir;
};

/** @param {import('../fake-sharepoint/server.mjs').Files} files @returns {string[]} what the library shows */
function libraryNotes(files) {
    if (typeof files === 'string') return [`Library: ${shortPath(files)}`];
    return Object.entries(files).map(([name, dir]) => `Library folder "${name}": ${shortPath(dir)}`);
}

/** @param {string} s @returns {string} text for an HTML attribute */
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Page with the Tampermonkey stand-in, which then loads the userscript (at DOMContentLoaded).
 * Settings not stored yet start with `defaults`; `notes` go into the stand-in's panel.
 * @param {import('../fake-sharepoint/server.mjs').Reply} reply html page
 * @param {import('../fake-sharepoint/server.mjs').Files} files
 * @returns {import('../fake-sharepoint/server.mjs').Reply}
 */
function inject(reply, files) {
    const built = sharepoint.has3dRelease();
    const release = shortPath(sharepoint.PATH_RELEASE);
    const defaults = JSON.stringify({ 'viewer-3d-folder': sharepoint.RELEASE_SETTING, 'logo': LOGO });
    const notes = JSON.stringify([
        ...libraryNotes(files),
        built ? `Library folder "previewer": ${release} (3D files)` : `3D files: none in ${release} (run "just build")`,
    ]);
    const data = `data-version="${VERSION}" data-defaults="${attr(defaults)}" data-notes="${attr(notes)}"`;
    const tag = `<script src="${PREFIX}/tampermonkey.js" ${data}></script>`;
    const page = String(reply.body);
    const body = page.includes('</head>') ? page.replace('</head>', `${tag}\n</head>`) : tag + page;
    return { ...reply, headers: { ...reply.headers, ...NO_CACHE }, body };
}

/**
 * @param {http.IncomingMessage} req
 * @param {import('../fake-sharepoint/server.mjs').Files} library folder, or folders by name
 * @returns {import('../fake-sharepoint/server.mjs').Reply}
 */
function answer(req, library) {
    const files = sharepoint.resolveFiles(library); // per request: folders may come and go
    const url = new URL(req.url ?? '/', sharepoint.ORIGIN);
    if (url.pathname === '/') return redirect(encodeURI(sharepoint.LIST_PAGE));
    if (url.pathname === `${PREFIX}/tampermonkey.js`) return script(fs.readFileSync(PATH_SHIM, 'utf8'));
    if (url.pathname === `${PREFIX}/userscript.js`) return script(userscript());

    const headers = /** @type {Object<string, string>} */ (req.headers);
    const reply = sharepoint.handle({ url: url.href, method: req.method ?? 'GET', headers }, { files });
    return String(reply.headers['content-type']).startsWith('text/html') ? inject(reply, files) : reply;
}

// --------------------------------
// server
// --------------------------------

/** @param {string} port @param {string} [folder] library folder (default: Mock Data and Data) */
function serve(port, folder) {
    const library = folder ? path.resolve(folder) : MOUNTS;
    if (typeof library === 'string' && !(fs.existsSync(library) && fs.statSync(library).isDirectory())) {
        console.error(`not a folder: ${library}`);
        process.exit(1);
    }
    const server = http.createServer((req, res) => {
        let reply;
        try {
            reply = answer(req, library);
        } catch (err) {
            console.error(err);
            reply = { status: 500, headers: { 'content-type': 'text/plain' }, body: 'Error 500' };
        }
        const range = req.headers.range ? ` (${req.headers.range})` : '';
        console.log(`${reply.status} ${req.method} ${decodeURIComponent(req.url ?? '')}${range}`);
        res.writeHead(reply.status, reply.headers);
        res.end(reply.body);
    });
    server.listen(Number(port), HOST, () => {
        for (const note of libraryNotes(sharepoint.resolveFiles(library))) console.log(note);
        console.log(`open:    http://localhost:${port}${encodeURI(sharepoint.LIST_PAGE)}`);
        console.log('stop:    Ctrl+C');
    });
}

// ================================================================
// START
// ================================================================

const [port = '8080', folder = ''] = process.argv.slice(2);
serve(port, folder);
