// Explorative tests: the fake SharePoint on http://localhost:<port>, with the userscript (/src/main.js) injected.
//
//   node tests/explore/server.mjs <port> [folder]    (cf. `just tests-explore`)
//
// - folder: served as the document library (default: /tests/fake-sharepoint/library); read afresh per request
// - userscript: read afresh per page load, so `just build-src` + reload picks up changes
// - Tampermonkey: stood in for by ./tampermonkey.js (settings in localStorage, menu commands as a panel)
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

const SCRIPT_TYPE = 'application/javascript; charset=utf-8';
const NO_CACHE = { 'cache-control': 'no-store' };

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

/**
 * Page with the Tampermonkey stand-in, which then loads the userscript (at DOMContentLoaded).
 * @param {import('../fake-sharepoint/server.mjs').Reply} reply html page
 * @returns {import('../fake-sharepoint/server.mjs').Reply}
 */
function inject(reply) {
    const tag = `<script src="${PREFIX}/tampermonkey.js" data-version="${VERSION}"></script>`;
    const page = String(reply.body);
    const body = page.includes('</head>') ? page.replace('</head>', `${tag}\n</head>`) : tag + page;
    return { ...reply, headers: { ...reply.headers, ...NO_CACHE }, body };
}

/**
 * @param {http.IncomingMessage} req
 * @param {string} files library folder
 * @returns {import('../fake-sharepoint/server.mjs').Reply}
 */
function answer(req, files) {
    const url = new URL(req.url ?? '/', sharepoint.ORIGIN);
    if (url.pathname === '/') return redirect(encodeURI(sharepoint.LIST_PAGE));
    if (url.pathname === `${PREFIX}/tampermonkey.js`) return script(fs.readFileSync(PATH_SHIM, 'utf8'));
    if (url.pathname === `${PREFIX}/userscript.js`) return script(userscript());

    const headers = /** @type {Object<string, string>} */ (req.headers);
    const reply = sharepoint.handle({ url: url.href, method: req.method ?? 'GET', headers }, { files });
    return String(reply.headers['content-type']).startsWith('text/html') ? inject(reply) : reply;
}

// --------------------------------
// server
// --------------------------------

/** @param {string} port @param {string} [folder] library folder */
function serve(port, folder) {
    const files = path.resolve(folder || sharepoint.PATH_FILES);
    if (!fs.existsSync(files) || !fs.statSync(files).isDirectory()) {
        console.error(`not a folder: ${files}`);
        process.exit(1);
    }
    const server = http.createServer((req, res) => {
        let reply;
        try {
            reply = answer(req, files);
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
        console.log(`library: ${files}`);
        console.log(`open:    http://localhost:${port}${encodeURI(sharepoint.LIST_PAGE)}`);
        console.log('stop:    Ctrl+C');
    });
}

// ================================================================
// START
// ================================================================

const [port = '8080', folder = ''] = process.argv.slice(2);
serve(port, folder);
