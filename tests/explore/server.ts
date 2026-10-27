// Explorative tests: the mock Sharepoint on http://localhost:<port>, with the userscript (/dist/userscript.js) injected.
//
//   node tests/explore/server.ts <port> [folder]    (cf. `just tests-explore`)
//
// - libraries: "Mock Library" (test fixtures, /tests/mocks/mock-sharepoint/library), "Mock Artefacts" (cf. 3D files) and "Local Library"
//   (your own files: /data, local only, or the folder given; if there); read afresh per request (read only)
// - userscript: read afresh per page load, so `just build-src` + reload picks up changes
// - Tampermonkey: stood in for by ./tampermonkey.js (settings in localStorage, menu commands as a panel);
//   its panel (and the console) names each library and the folder it serves
// - search: box in the middle of the suite bar (files below the folder open, found by the userscript by name)
// - 3D files: those of the release in /dist/v<VERSION> (`just build`), listed in "Mock Artefacts" as folder "previewer";
//   the setting `viewer-3d-folder` points there unless set (filled in when empty)
// - logo: a test logo (setting `logo`), filled in when empty
// - uploads (drop on the list, "Upload", the viewer's upload): simulated, kept apart in
//   /tests/mocks/mock-sharepoint/__uploads__/explore (library paths mirrored), shown over the originals;
//   removed when the server stops (and by `just clean`)
// - listens on the loopback interface only; logs each request to the console

// ================================================================
// IMPORTS
// ================================================================

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Libraries } from '../mocks/mock-sharepoint/server.ts';
import type { Reply } from '../mocks/mock-sharepoint/server.ts';
import * as sharepoint from '../mocks/mock-sharepoint/server.ts';
import { userscript } from '../mocks/mock-sharepoint/userscript.ts';

// ================================================================
// CONSTANTS
// ================================================================

const HOST = '127.0.0.1';
const PREFIX = '/__explore__';
const PATH_SHIM = path.join(import.meta.dirname, 'tampermonkey.js');
const VERSION = `${sharepoint.VERSION}-explore`;

// Logo shown in the viewer (setting `logo`): a sprout in soil, dark blue behind; base64, as the userscript takes only that
const LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#0d2547"/><stop offset="1" stop-color="#1d4f86"/></linearGradient></defs>' +
    '<rect width="32" height="32" rx="7" fill="url(#sky)"/>' +
    '<path d="M16 24V14" stroke="#3f8f3a" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
    '<path d="M16 16C15 10 10 7 4 8c0 6 5 9 12 8z" fill="#5fb548"/>' +
    '<path d="M16 13c1-5 5-8 11-7 0 5-4 8-11 7z" fill="#7cc95e"/>' +
    // flat, rough soil with black bits
    '<path d="M0 24l2-.6 2 .7 2-.9 2 .8 2-.5 2 .6 2-.8 2 .7 2-.6 2 .9 2-.7 2 .5 2-.8 2 .7 2-.5 2 .6V25A7 7 0 0 1 25 32H7A7 7 0 0 1 0 25z" fill="#3a2414"/>' +
    '<g fill="#0b0705">' +
    '<circle cx="5" cy="27" r="0.6"/><circle cx="8" cy="25.4" r="0.45"/><circle cx="10.5" cy="29.5" r="0.7"/><circle cx="12.5" cy="27.6" r="0.4"/><circle cx="14" cy="26.3" r="0.55"/><circle cx="18.5" cy="28.8" r="0.65"/><circle cx="20.5" cy="30.6" r="0.45"/><circle cx="23" cy="26.2" r="0.5"/><circle cx="25.5" cy="28" r="0.7"/><circle cx="27.5" cy="25.6" r="0.4"/><circle cx="28.5" cy="29.5" r="0.5"/><circle cx="3.5" cy="25.3" r="0.4"/><circle cx="16.5" cy="30" r="0.4"/><circle cx="7" cy="30" r="0.5"/></g></svg>';
const LOGO = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

const SCRIPT_TYPE = 'application/javascript; charset=utf-8';
const NO_CACHE = { 'cache-control': 'no-store' };

// Libraries: test fixtures, and own files (default: the repo's local /data)
const ROOT = path.resolve(import.meta.dirname, '../..');
const LOCAL = 'Local Library';
const PATH_LOCAL = path.join(ROOT, 'data');
// Simulated uploads of this server (cf. /tests/mocks/mock-sharepoint/server.ts)
const PATH_UPLOADS = path.join(sharepoint.PATH_UPLOADS, 'explore');

// ================================================================
// METHODS
// ================================================================

// --------------------------------
// replies
// --------------------------------

const script = (body: string): Reply => ({ status: 200, headers: { 'content-type': SCRIPT_TYPE, ...NO_CACHE }, body });

const redirect = (location: string): Reply => ({ status: 302, headers: { location }, body: '' });

/** @returns relative to the working folder, if inside it */
const shortPath = (dir: string): string => {
    const rel = path.relative(process.cwd(), dir);
    return rel && !rel.startsWith('..') ? rel : dir;
};

/** @returns what the libraries show */
function libraryNotes(libs: Libraries): string[] {
    const uploads = `Uploads (simulated, removed on stop): ${shortPath(PATH_UPLOADS)}`;
    return [...Object.entries(libs).map(([name, dir]) => `Library "${name}": ${shortPath(dir)}`), uploads];
}

/** @returns text for an HTML attribute */
const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Page with the Tampermonkey stand-in, which then loads the userscript (at DOMContentLoaded).
 * Settings not stored yet start with `defaults`; `notes` go into the stand-in's panel.
 * @param reply html page
 */
function inject(reply: Reply, libs: Libraries): Reply {
    const built = sharepoint.has3dRelease();
    const release = shortPath(sharepoint.PATH_RELEASE);
    const defaults = JSON.stringify({ 'viewer-3d-folder': sharepoint.RELEASE_SETTING, 'logo': LOGO });
    const notes = JSON.stringify([
        ...libraryNotes(libs),
        built ? `Folder "${sharepoint.RELEASE_SETTING}": ${release} (3D files)` : `3D files: none in ${release} (run "just build")`,
    ]);
    const data = `data-version="${VERSION}" data-defaults="${attr(defaults)}" data-notes="${attr(notes)}"`;
    const tag = `<script src="${PREFIX}/tampermonkey.js" ${data}></script>`;
    const page = String(reply.body);
    const body = page.includes('</head>') ? page.replace('</head>', `${tag}\n</head>`) : tag + page;
    return { ...reply, headers: { ...reply.headers, ...NO_CACHE }, body };
}

function answer(req: http.IncomingMessage, libraries: Libraries, body: Buffer): Reply {
    const libs = sharepoint.resolveLibraries(libraries); // per request: folders may come and go
    const url = new URL(req.url ?? '/', sharepoint.ORIGIN);
    if (url.pathname === '/') return redirect(encodeURI(sharepoint.LIST_PAGE));
    if (url.pathname === `${PREFIX}/tampermonkey.js`) return script(fs.readFileSync(PATH_SHIM, 'utf8'));
    if (url.pathname === `${PREFIX}/userscript.js`) return script(userscript());

    const headers = req.headers as Record<string, string>;
    const reply = sharepoint.handle(
        { url: url.href, method: req.method ?? 'GET', headers, body },
        { libraries: libs, uploads: PATH_UPLOADS },
    );
    return String(reply.headers['content-type']).startsWith('text/html') ? inject(reply, libs) : reply;
}

// --------------------------------
// server
// --------------------------------

/** @param folder own files, as library "Local Library" (default: /data) */
function serve(port: string, folder?: string) {
    const local = folder ? path.resolve(folder) : PATH_LOCAL;
    if (folder && !(fs.existsSync(local) && fs.statSync(local).isDirectory())) {
        console.error(`not a folder: ${local}`);
        process.exit(1);
    }
    const libraries: Libraries = { ...sharepoint.LIBRARIES, [LOCAL]: local };
    sharepoint.startUploads('explore');
    const stop = () => {
        sharepoint.endUploads(PATH_UPLOADS);
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    const server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let reply: Reply;
        try {
            reply = answer(req, libraries, Buffer.concat(chunks));
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
        for (const note of libraryNotes(sharepoint.resolveLibraries(libraries))) console.log(note);
        console.log(`open:    http://localhost:${port}${encodeURI(sharepoint.LIST_PAGE)}`);
        console.log('stop:    Ctrl+C');
    });
}

// ================================================================
// START
// ================================================================

const [port = '8080', folder = ''] = process.argv.slice(2);
serve(port, folder);
