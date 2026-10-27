// Mock Sharepoint Online: one site with document libraries, each served from a local folder
// (default: libraries "Mock Library" from ./library and "Mock Artefacts" from ./artefacts). Read only: files are read from disk per request.
// Uploads (optional, simulated): kept apart in a session folder under ./__uploads__ that mirrors the site's
// paths (<library>/<path>); they are listed and served over the originals (which stay untouched) until the session ends.
//
//   /sites/Test/<library>/Forms/AllItems.aspx[?id=<folder>][&q=<term>]   list view (client-side app); q: search
//   /sites/Test/<library>/<path>                                         file (GET / HEAD, byte ranges)
//   /sites/Test/SitePages/Home.aspx                                      page outside any library
//   /sites/Test/Mock Artefacts/previewer/<file>                          3D files of the release (if built),
//                                                                        listed as folder "previewer" in "Mock Artefacts"
//   /sites/Test/<library>/_api/upload?folder=<f>&name=<n>                upload (POST, body: the file; simulated)
//   /sites/Test/<library>/_api/tree                                      folders and files (JSON; list refresh)
//   /sites/Test/_api/web/GetList(@list)/items?$filter=FileLeafRef eq '<name>'&@list='<library>'
//                                                                        files of that name in a library (as Sharepoint)
//   /sites/Test/_api/search/query?querytext='(filename:"<name>" …) path:"<url of folder>"'
//                                                                        search index (as Sharepoint; Parquet: a form as Path)
//
// The list view mimics what the userscript reads: ARIA grid rows (selection column first), name fields,
// folder icons, the scroll card and Sharepoint's `display: contents` wrapper;
// plus, for the eye only: file and folder icons, "Modified By" (made-up people), sizes (folders: items).
// Navigation between folders happens in place (history API) and recycles row elements,
// as Sharepoint does. Search (box in the middle of the suite bar) lists files and folders below the folder open
// whose names contain the term; file rows carry no path (as in Sharepoint), folder rows link to the folder.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

export const ORIGIN = 'https://acme.sharepoint.com';
export const SITE = '/sites/Test';

/** @param library server-relative @returns its list view */
export const listPageOf = (library: string): string => `${library}/Forms/AllItems.aspx`;

/** @param p server-relative path on the site @returns its library (first part after the site) */
export const libraryOf = (p: string): string => p.split('/').slice(0, 4).join('/');

// Library of the test fixtures (behavioural tests, demos)
export const LIBRARY = `${SITE}/Mock Library`;
export const LIST_PAGE = listPageOf(LIBRARY);
export const PATH_FILES = path.join(HERE, 'library');
// Library of the artefacts: 3D files of the release (cf. RELEASE_FOLDER), plus a readme, a text file and an example model
export const ARTEFACTS = `${SITE}/Mock Artefacts`;
export const PATH_ARTEFACTS = path.join(HERE, 'artefacts');

export const VERSION = fs.readFileSync(path.join(ROOT, 'dist/VERSION'), 'utf8').trim();
export const PATH_RELEASE = path.join(ROOT, 'dist', `v${VERSION}`);
// 3D files of the release, as a folder of the artefacts library (as deployed); setting `viewer-3d-folder`: site-relative
export const RELEASE_FOLDER = `${ARTEFACTS}/previewer`;
export const RELEASE_SETTING = RELEASE_FOLDER.slice(SITE.length + 1);
const FILES_3D = ['ifc-lite-3d.js', 'ifc-lite_bg.wasm'];
// Simulated uploads, one folder per session (never synchronised: cf. /.gitignore; removed by `just clean`)
export const PATH_UPLOADS = path.join(HERE, '__uploads__');

const MODIFIED = new Date('2026-10-01T12:00:00Z');

// Name of the mock tenant (title, suite bar) and its icon: plain shapes, no real logo
const TENANT = 'Mock Sharepoint';
const ICON =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
            '<rect width="32" height="32" rx="7" fill="#0f6c74"/>' +
            '<circle cx="12" cy="13" r="6" fill="#7fd1d8"/><circle cx="20" cy="20" r="7" fill="#fff" opacity=".85"/></svg>',
    );

const TYPES: Record<string, string> = {
    '.csv': 'text/csv',
    '.ifc': 'application/octet-stream',
    '.js': 'application/javascript',
    '.md': 'application/octet-stream',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.parquet': 'application/octet-stream',
    '.png': 'image/png',
    '.txt': 'text/plain',
    '.wasm': 'application/wasm',
    '.xls': 'application/vnd.ms-excel',
    '.xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xml': 'text/xml',
};

// Files the search index does not read: their Path is a form (DispForm.aspx?ID=…), as in Sharepoint
const UNINDEXED = /\.parquet$/i;

// "Modified By" of the list: made-up people (one per entry, the same each time); simulated uploads: the test user
const AUTHORS = ['Ada Lindqvist', 'Bruno Keller', 'Chiara Rossi', 'Dev Patel', 'Emma Novak'];
const UPLOADER = 'Test User';

// Icons of the list (file type column): folder, any file; plain shapes
const ICONS: Record<string, string> = {
    'itemtypefolder.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
        '<path d="M1.5 4.5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" fill="#ffc83d" stroke="#c19c00"/></svg>',
    'itemtypegeneric.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
        '<path d="M4.5 1.5h7l4 4v13h-11z" fill="#fff" stroke="#8a8886"/><path d="M11.5 1.5v4h4" fill="none" stroke="#8a8886"/></svg>',
};

// Entry of a folder listing (uploaded: simulated upload)
type Entry = { name: string; folder: boolean; size: number; author?: string; uploaded?: boolean };
// Answer to a request
export type Reply = { status: number; headers: Record<string, string>; body: Buffer | string };
// Libraries of the site: name (also its URL part) -> local folder
export type Libraries = Record<string, string>;

// Default: the test fixtures and the artefacts
export const LIBRARIES: Libraries = {
    [LIBRARY.slice(SITE.length + 1)]: PATH_FILES,
    [ARTEFACTS.slice(SITE.length + 1)]: PATH_ARTEFACTS,
};

// ----------------------------------------------------------------
// Local paths
// ----------------------------------------------------------------

/** @returns local path, never outside root (no "..") */
function within(root: string, rel: string): string | null {
    const local = path.join(root, rel);
    return local === root || local.startsWith(root + path.sep) ? local : null;
}

/** @returns name of the library of a server-relative path, if the site has it */
function libraryName(libs: Libraries, p: string): string | null {
    if (!p.startsWith(`${SITE}/`)) return null;
    const name = libraryOf(p).slice(SITE.length + 1);
    return Object.hasOwn(libs, name) ? name : null;
}

/** @param p server-relative @returns local path */
function localPath(libs: Libraries, p: string): string | null {
    const name = libraryName(libs, p);
    return name == null ? null : within(libs[name], p.slice(libraryOf(p).length));
}

/** @param p server-relative @returns place among the uploads (null: outside the site) */
function uploadPath(uploads: string, p: string): string | null {
    return p.startsWith(`${SITE}/`) ? within(uploads, p.slice(SITE.length + 1)) : null;
}

/** @returns folder for the uploads of a session, empty (left-overs of an earlier run removed) */
export function startUploads(session: string): string {
    const dir = path.join(PATH_UPLOADS, session);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Removes the uploads of a session (and the uploads folder once no session is left) */
export function endUploads(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
        fs.rmdirSync(PATH_UPLOADS); // only if empty
    } catch {}
}

/** @returns with absolute paths; folders not there left out */
export function resolveLibraries(libs: Libraries): Libraries {
    const found = Object.entries(libs)
        .map(([name, dir]) => [name, path.resolve(dir)] as const)
        .filter(([, dir]) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
    return Object.fromEntries(found);
}

// ----------------------------------------------------------------
// Listings
// ----------------------------------------------------------------

/** @returns folders first, then files; hidden entries left out */
function listing(dir: string): Entry[] {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.'))
        .map((d) => ({
            name: d.name,
            folder: d.isDirectory(),
            size: d.isDirectory() ? 0 : fs.statSync(path.join(dir, d.name)).size,
        }))
        .sort(byName);
}

/** @returns 3D files of this version are built (`just build`) */
export const has3dRelease = (): boolean => FILES_3D.every((name) => fs.existsSync(path.join(PATH_RELEASE, name)));

const byName = (a: Entry, b: Entry): number => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name);

/** @param p server-relative @returns one of the made-up authors, always the same for that path */
function authorOf(p: string): string {
    let h = 0;
    for (const c of p) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
    return AUTHORS[h % AUTHORS.length];
}

/** @param library server-relative @returns its folders (server-relative) -> entries (uploads over the originals) */
function tree(libs: Libraries, library: string, uploads?: string): Record<string, Entry[]> {
    const out: Record<string, Entry[]> = {};
    const walk = (folder: string) => {
        const local = localPath(libs, folder);
        if (!local) return;
        out[folder] = listing(local);
        for (const e of out[folder]) if (e.folder) walk(`${folder}/${e.name}`);
    };
    walk(library);
    if (!out[library]) return out;
    if (library === ARTEFACTS && has3dRelease() && !out[RELEASE_FOLDER]) {
        out[ARTEFACTS].push({ name: 'previewer', folder: true, size: 0 });
        out[ARTEFACTS].sort(byName);
        out[RELEASE_FOLDER] = listing(PATH_RELEASE).filter((e) => FILES_3D.includes(e.name));
    }
    for (const [folder, entries] of Object.entries(out)) {
        const dir = uploads && uploadPath(uploads, folder);
        if (!dir || !fs.existsSync(dir)) continue;
        for (const e of listing(dir).filter((x) => !x.folder)) {
            const i = entries.findIndex((x) => x.name.toLowerCase() === e.name.toLowerCase()); // Sharepoint ignores case
            entries.splice(i < 0 ? entries.length : i, i < 0 ? 0 : 1, { ...e, uploaded: true });
        }
        entries.sort(byName);
    }
    for (const [folder, entries] of Object.entries(out)) {
        for (const e of entries) e.author = e.uploaded ? UPLOADER : authorOf(`${folder}/${e.name}`);
    }
    return out;
}

/** @returns server-relative paths of all files of a library */
function filesOf(libs: Libraries, library: string, uploads?: string): string[] {
    return Object.entries(tree(libs, library, uploads)).flatMap(([folder, entries]) =>
        entries.filter((e) => !e.folder).map((e) => `${folder}/${e.name}`),
    );
}

// ----------------------------------------------------------------
// Replies
// ----------------------------------------------------------------

const html = (body: string): Reply => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body });

const json = (data: unknown): Reply => ({
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
});

const fail = (status: number): Reply => ({
    status,
    headers: { 'content-type': 'text/plain' },
    body: `Error ${status}`,
});

/** @returns text for HTML */
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** @param library server-relative */
function listPage(libs: Libraries, library: string, uploads?: string): Reply {
    const name = library.slice(SITE.length + 1);
    const nav = Object.keys(libs)
        .map((lib) => {
            const current = lib === name ? ' class="current"' : '';
            return `<a href="${esc(encodeURI(listPageOf(`${SITE}/${lib}`)))}"${current}>${esc(lib)}</a>`;
        })
        .join('');
    return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(name)} - ${TENANT}</title>
<link rel="icon" href="${ICON}">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font: 14px "Segoe UI", sans-serif; color: #323130; }
  body { display: flex; flex-direction: column; overflow: hidden; }
  .suite-bar { flex: none; height: 48px; background: #0078d4; color: #fff; padding: 0 16px; display: grid; grid-template-columns: 1fr minmax(0, 560px) 1fr; align-items: center; gap: 16px; }
  .suite-bar input[type="search"] { width: 100%; height: 32px; padding: 4px 12px; border: none; border-radius: 4px; background: #fff; color: #323130; font: inherit; }
  .app { flex: 1; min-height: 0; display: flex; }
  .nav { flex: none; width: 200px; padding: 12px; background: #faf9f8; display: flex; flex-direction: column; gap: 6px; }
  .nav a { color: inherit; text-decoration: none; padding-left: 8px; }
  .nav a:hover { text-decoration: underline; }
  .nav a.current { font-weight: 600; border-left: 3px solid #0078d4; padding-left: 5px; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .command-bar { flex: none; height: 44px; padding: 8px 16px; border-bottom: 1px solid #edebe9; display: flex; align-items: center; gap: 12px; }
  .breadcrumb { flex: none; padding: 8px 16px; font-size: 18px; }
  .breadcrumb a { color: inherit; text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; }
  .list-host { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 16px 16px; }
  /* height not from flex alone: the list keeps reaching the bottom when the viewer sets flex: none */
  .card { flex: 1; height: 100%; min-height: 0; border: 1px solid #e1dfdd; border-radius: 8px; }
  .scroller { height: 100%; overflow-y: auto; }
  [role="row"] { display: flex; align-items: center; height: 42px; border-bottom: 1px solid #f3f2f1; }
  [role="row"][hidden] { display: none; }
  [role="row"]:not(.header):hover { background: #f8f8f8; }
  [role="row"].header { background: #e1dfdd; color: #201f1e; font-weight: 600; border-bottom: 1px solid #c8c6c4; }
  [role="columnheader"], [role="gridcell"], [role="rowheader"] { padding: 0 8px; display: flex; align-items: center; gap: 8px; }
  .c-select { flex: none; width: 48px; } /* selection column (as Sharepoint's): the userscript puts its eye here */
  .c-icon { flex: none; width: 40px; }
  .c-name { flex: 1; min-width: 0; }
  .c-author { width: 160px; color: #605e5c; }
  .c-size { width: 160px; color: #605e5c; justify-content: flex-end; white-space: nowrap; }
  .header .c-author, .header .c-size { color: inherit; }
  .c-name button, .c-name a { all: unset; cursor: pointer; }
  .c-name button:hover, .c-name a:hover { text-decoration: underline; }
  .c-icon img { width: 20px; height: 20px; }
  .upload { cursor: pointer; }
  .uploaded { color: #8a6d00; font-style: italic; }
</style>
</head>
<body>
  <div class="suite-bar">
    <span>${TENANT}</span>
    <input type="search" id="search" placeholder="Search this library" aria-label="Search this library">
  </div>
  <div class="app">
    <div class="nav">Home${nav}</div>
    <div class="main">
      <div class="command-bar">
        <span>+ New</span>
        <label class="upload">Upload<input type="file" id="upload" multiple hidden></label>
        <span>Sync</span>
      </div>
      <div class="breadcrumb" id="breadcrumb"></div>
      <div class="list-host">
        <div role="" style="display: contents;">
          <div class="card">
            <div class="scroller">
              <div role="grid" aria-label="${esc(name)}" id="grid">
                <div role="row" class="header">
                  <div role="columnheader" class="c-select" aria-label="Selection"></div>
                  <div role="columnheader" class="c-icon" aria-label="File type"></div>
                  <div role="columnheader" class="c-name">Name</div>
                  <div role="columnheader" class="c-author">Modified By</div>
                  <div role="columnheader" class="c-size">File size</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
<script>
  let TREE = ${JSON.stringify(tree(libs, library, uploads))};
  const LIBRARY = ${JSON.stringify(library)};
  const NAME = ${JSON.stringify(name)};
  const API = ${JSON.stringify(`${library}/_api`)};
  const LIST_PAGE = ${JSON.stringify(listPageOf(library))};
  const grid = document.getElementById('grid');
  const search = document.getElementById('search');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const icon = (e) => e.folder ? '/_layouts/15/images/itemtypefolder.svg' : '/_layouts/15/images/itemtypegeneric.svg';
  const bytes = (n) => n < 1024 ? n + ' bytes' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const items = (path) => {
    const n = (TREE[path] || []).length;
    return n + (n === 1 ? ' item' : ' items');
  };
  const size = (e) => e.folder ? items(e.path) : bytes(e.size) + (e.uploaded ? ' <span class="uploaded">· uploaded</span>' : '');
  const folderLink = (folder, text) =>
    '<a href="' + LIST_PAGE + '?id=' + encodeURIComponent(folder) + '" data-folder>' + esc(text) + '</a>';

  // Path from the library down: every part but the last leads back to its folder
  function breadcrumb(folder) {
    const parts = folder.slice(LIBRARY.length).split('/').filter(Boolean);
    const names = [NAME, ...parts];
    return names
      .map((name, i) => {
        const path = [LIBRARY, ...parts.slice(0, i)].join('/');
        return i < names.length - 1 ? folderLink(path, name) : '<span>' + esc(name) + '</span>';
      })
      .join(' › ');
  }

  function folderOfUrl() {
    const id = new URLSearchParams(location.search).get('id');
    return id ? id.replace(/\\/+$/, '') : LIBRARY;
  }
  const termOfUrl = () => (new URLSearchParams(location.search).get('q') || '').trim();

  // Search: files and folders below the folder whose names contain the term (any case), at any depth
  function found(folder, term) {
    const out = [];
    const t = term.toLowerCase();
    const walk = (f) => {
      for (const e of TREE[f] || []) {
        const path = f + '/' + e.name;
        if (e.name.toLowerCase().includes(t)) out.push({ ...e, path });
        if (e.folder) walk(path);
      }
    };
    walk(folder);
    return out;
  }

  // Rows are reused across folders (as Sharepoint's virtualised list does)
  function render() {
    const folder = folderOfUrl();
    const term = termOfUrl();
    const entries = term ? found(folder, term) : (TREE[folder] || []).map((e) => ({ ...e, path: folder + '/' + e.name }));
    const scope = folder === LIBRARY ? NAME : folder.split('/').pop();
    document.getElementById('breadcrumb').innerHTML = term
      ? 'Search results for "' + esc(term) + '" in ' + folderLink(folder, scope)
      : breadcrumb(folder);
    search.value = term;
    const rows = [...grid.querySelectorAll('[role="row"]:not(.header)')];
    while (rows.length < entries.length) {
      const row = document.createElement('div');
      row.setAttribute('role', 'row');
      grid.append(row);
      rows.push(row);
    }
    rows.forEach((row, i) => {
      const e = entries[i];
      row.hidden = !e;
      if (!e) return void (row.innerHTML = '');
      // Same row element, new cells contents: like Sharepoint after navigation; files: name only, no path
      const nameField = e.folder ? folderLink(e.path, e.name) : '<button type="button">' + esc(e.name) + '</button>';
      row.innerHTML =
        '<div role="gridcell" class="c-select"></div>' +
        '<div role="gridcell" class="c-icon"><img alt="" src="' + icon(e) + '"></div>' +
        '<div role="gridcell" class="c-name" data-automationid="field-LinkFilename">' + nameField + '</div>' +
        '<div role="gridcell" class="c-author">' + esc(e.author || '') + '</div>' +
        '<div role="gridcell" class="c-size">' + size(e) + '</div>';
    });
  }

  document.addEventListener('click', (ev) => {
    const link = ev.target.closest('a[data-folder]');
    if (!link) return;
    ev.preventDefault();
    history.pushState(null, '', link.href);
    render();
  });
  window.addEventListener('popstate', render);

  // Search: Enter shows the results below the folder open; empty: the folder again
  search.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const term = search.value.trim();
    const query = '?id=' + encodeURIComponent(folderOfUrl()) + (term ? '&q=' + encodeURIComponent(term) : '');
    history.pushState(null, '', LIST_PAGE + query);
    render();
  });

  // Uploads (simulated by the server, apart from the library): drop on the list, or "Upload"; then the list anew
  async function upload(files) {
    const folder = folderOfUrl();
    for (const file of files) {
      const query = '?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(file.name);
      const r = await fetch(API + '/upload' + query, { method: 'POST', body: file });
      if (!r.ok) return void alert('Upload failed (error ' + r.status + '): ' + file.name);
    }
    TREE = await (await fetch(API + '/tree')).json();
    render();
  }
  const onList = (ev) => ev.target instanceof Element && !!ev.target.closest('.card');
  document.addEventListener('dragover', (ev) => onList(ev) && ev.preventDefault());
  document.addEventListener('drop', (ev) => {
    if (!onList(ev)) return;
    ev.preventDefault();
    upload([...ev.dataTransfer.files]);
  });
  const input = document.getElementById('upload');
  input.addEventListener('change', () => {
    upload([...input.files]);
    input.value = '';
  });
  render();
</script>
</body>
</html>`);
}

// ----------------------------------------------------------------
// Files, uploads, REST
// ----------------------------------------------------------------

/** @param file local path @param uploaded simulated upload: date and ETag change with each upload */
function serveFile(file: string, method: string, range: string | undefined, uploaded = false): Reply {
    const data = fs.readFileSync(file);
    const modified = uploaded ? fs.statSync(file).mtime : MODIFIED;
    const headers = {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'accept-ranges': 'bytes',
        'last-modified': modified.toUTCString(),
        'etag': `"{${data.length}},${uploaded ? modified.getTime() : 1}"`,
    };
    const m = range && /^bytes=(\d+)-(\d*)$/.exec(range);
    if (m) {
        const from = Number(m[1]);
        if (from >= data.length) {
            return { status: 416, headers: { ...headers, 'content-range': `bytes */${data.length}` }, body: '' };
        }
        const to = Math.min(m[2] ? Number(m[2]) : data.length - 1, data.length - 1);
        const part = data.subarray(from, to + 1);
        return {
            status: 206,
            headers: {
                ...headers,
                'content-range': `bytes ${from}-${to}/${data.length}`,
                'content-length': String(part.length),
            },
            body: method === 'HEAD' ? '' : part,
        };
    }
    return {
        status: 200,
        headers: { ...headers, 'content-length': String(data.length) },
        body: method === 'HEAD' ? '' : data,
    };
}

// Simulated upload: written to the session's uploads, at the site path of the folder
function upload(
    libs: Libraries,
    library: string,
    uploads: string | undefined,
    params: URLSearchParams,
    method: string,
    body?: Buffer,
): Reply {
    if (!uploads || method !== 'POST') return fail(405); // uploads not simulated here
    const folder = (params.get('folder') ?? '').replace(/\/+$/, '');
    const name = params.get('name') ?? '';
    const dir = uploadPath(uploads, folder);
    if (!dir || !name || /[\\/]/.test(name) || !(folder in tree(libs, library, uploads))) return fail(400);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body ?? Buffer.alloc(0));
    return json({ folder, name });
}

/** @returns OData string literal ('it''s') as text */
const unquote = (s: string): string => s.replace(/^'|'$/g, '').replace(/''/g, "'");

// Library items by file name (FileLeafRef, any case), as Sharepoint's list REST API
function listItems(libs: Libraries, params: URLSearchParams, uploads?: string): Reply {
    const list = unquote(params.get('@list') ?? '').replace(/\/+$/, '');
    const m = /FileLeafRef eq ('(?:[^']|'')*')/.exec(params.get('$filter') ?? '');
    if (!m || libraryName(libs, list) == null || libraryOf(list) !== list) return fail(400);
    const name = unquote(m[1]).toLowerCase();
    const paths = filesOf(libs, list, uploads).filter((p) => p.split('/').pop()?.toLowerCase() === name);
    return json({ value: paths.map((p) => ({ FileRef: p })) });
}

// Search index: files of that name below the path given, over all libraries (as Sharepoint's search REST API);
// files the index does not read have a form as Path (the file: ParentLink + Filename)
function searchQuery(libs: Libraries, params: URLSearchParams, origin: string, uploads?: string): Reply {
    const text = unquote(params.get('querytext') ?? '');
    const name = (/filename:"([^"]*)"/.exec(text)?.[1] ?? '').toLowerCase();
    let below = '';
    try {
        below = decodeURIComponent(new URL(/path:"([^"]*)"/.exec(text)?.[1] ?? '').pathname).replace(/\/+$/, '');
    } catch {
        return fail(400);
    }
    const paths = Object.keys(libs)
        .flatMap((lib) => filesOf(libs, `${SITE}/${lib}`, uploads))
        .filter((p) => p.split('/').pop()?.toLowerCase() === name)
        .filter((p) => p.toLowerCase().startsWith(`${below.toLowerCase()}/`));
    const rows = paths.map((p, i) => {
        const parent = p.slice(0, p.lastIndexOf('/'));
        const file = p.slice(parent.length + 1);
        const form = `${libraryOf(p)}/Forms/DispForm.aspx?ID=${i + 1}`;
        const cells = {
            Path: origin + encodeURI(UNINDEXED.test(file) ? form : p),
            ParentLink: origin + encodeURI(parent),
            Filename: file,
        };
        return { Cells: Object.entries(cells).map(([Key, Value]) => ({ Key, Value })) };
    });
    return json({ PrimaryQueryResult: { RelevantResults: { Table: { Rows: rows } } } });
}

/**
 * Answers one request to the mock Sharepoint.
 *
 * @param opts libraries of the site (default: LIBRARIES);
 *   folder of the session's uploads (none: uploads refused)
 */
export function handle(
    { url, method, headers, body }: { url: string; method: string; headers: Record<string, string>; body?: Buffer },
    { libraries = LIBRARIES, uploads }: { libraries?: Libraries; uploads?: string } = {},
): Reply {
    const u = new URL(url);
    const pathname = decodeURIComponent(u.pathname);
    const libs = resolveLibraries(libraries);
    const library = libraryName(libs, pathname) == null ? null : libraryOf(pathname);

    if (pathname === `${SITE}/_api/web/GetList(@list)/items`) return listItems(libs, u.searchParams, uploads);
    if (pathname === `${SITE}/_api/search/query`) return searchQuery(libs, u.searchParams, u.origin, uploads);
    if (library && pathname === listPageOf(library)) return listPage(libs, library, uploads);
    if (library && pathname === `${library}/_api/tree`) return json(tree(libs, library, uploads));
    if (library && pathname === `${library}/_api/upload`) {
        return upload(libs, library, uploads, u.searchParams, method, body);
    }
    const uploaded = uploads ? uploadPath(uploads, pathname) : null;
    if (library && uploaded && fs.existsSync(uploaded) && fs.statSync(uploaded).isFile()) {
        return serveFile(uploaded, method, headers.range, true);
    }
    if (pathname === `${SITE}/SitePages/Home.aspx`) {
        return html(
            `<!doctype html><title>Home - ${TENANT}</title><link rel="icon" href="${ICON}">` +
                '<h1>Home</h1><div role="grid"><div role="row">notes.txt</div></div>',
        );
    }
    if (pathname.startsWith('/_layouts/')) {
        return {
            status: 200,
            headers: { 'content-type': 'image/svg+xml' },
            body: ICONS[path.basename(pathname)] ?? '<svg xmlns="http://www.w3.org/2000/svg"/>',
        };
    }
    if (pathname.startsWith(`${RELEASE_FOLDER}/`)) {
        const file = path.join(PATH_RELEASE, path.basename(pathname));
        return fs.existsSync(file) ? serveFile(file, method, headers.range) : fail(404);
    }
    const file = localPath(libs, pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return fail(404);
    return serveFile(file, method, headers.range);
}
