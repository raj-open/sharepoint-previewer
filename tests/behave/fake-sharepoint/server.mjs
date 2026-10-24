// Fake SharePoint Online: one site with one document library, served from ./library.
//
//   /sites/Test/Shared Documents/Forms/AllItems.aspx[?id=<folder>]  list view (client-side app)
//   /sites/Test/Shared Documents/<path>                             file (GET / HEAD, byte ranges)
//   /sites/Test/SitePages/Home.aspx                                 page outside any library
//   /sites/Test/Shared Documents/previewer/<file>                   3D files of the release (if built)
//
// The list view mimics only what the userscript reads: ARIA grid rows, name fields,
// folder icons, the scroll card and SharePoint's `display: contents` wrapper.
// Navigation between folders happens in place (history API) and recycles row elements,
// as SharePoint does.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

export const ORIGIN = 'https://contoso.sharepoint.com';
export const SITE = '/sites/Test';
export const LIBRARY = `${SITE}/Shared Documents`;
export const LIST_PAGE = `${LIBRARY}/Forms/AllItems.aspx`;
export const PATH_FILES = path.join(HERE, 'library');

const VERSION = fs.readFileSync(path.join(ROOT, 'dist/VERSION'), 'utf8').trim();
export const PATH_RELEASE = path.join(ROOT, 'dist', `v${VERSION}`);
const RELEASE_FOLDER = `${LIBRARY}/previewer`;

const MODIFIED = new Date('2026-10-01T12:00:00Z');

const TYPES = {
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

/**
 * @typedef {{ name: string, folder: boolean, size: number }} Entry
 * @typedef {{ status: number, headers: Object<string, string>, body: Buffer|string }} Reply
 */

/** @param {string} folder server-relative @returns {string|null} local directory */
function localPath(folder) {
    if (folder !== LIBRARY && !folder.startsWith(`${LIBRARY}/`)) return null;
    const local = path.join(PATH_FILES, folder.slice(LIBRARY.length));
    return local.startsWith(PATH_FILES) ? local : null; // no ".." out of the library
}

/** @param {string} dir @returns {Entry[]} folders first, then files; hidden entries left out */
function listing(dir) {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.'))
        .map((d) => ({
            name: d.name,
            folder: d.isDirectory(),
            size: d.isDirectory() ? 0 : fs.statSync(path.join(dir, d.name)).size,
        }))
        .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
}

/** @returns {Object<string, Entry[]>} server-relative folder -> entries, for the whole library */
function tree() {
    /** @type {Object<string, Entry[]>} */
    const out = {};
    const walk = (folder) => {
        const entries = listing(/** @type {string} */ (localPath(folder)));
        out[folder] = entries;
        for (const e of entries) if (e.folder) walk(`${folder}/${e.name}`);
    };
    walk(LIBRARY);
    return out;
}

/** @param {string} body @returns {Reply} */
const html = (body) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body });

/** @param {number} status @returns {Reply} */
const fail = (status) => ({ status, headers: { 'content-type': 'text/plain' }, body: `Error ${status}` });

/** @returns {Reply} */
function listPage() {
    return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Documents - Test</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font: 14px "Segoe UI", sans-serif; color: #323130; }
  body { display: flex; flex-direction: column; overflow: hidden; }
  .suite-bar { flex: none; height: 48px; background: #0078d4; color: #fff; padding: 14px 16px; }
  .app { flex: 1; min-height: 0; display: flex; }
  .nav { flex: none; width: 200px; padding: 12px; background: #faf9f8; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .command-bar { flex: none; height: 44px; padding: 12px 16px; border-bottom: 1px solid #edebe9; }
  .breadcrumb { flex: none; padding: 8px 16px; font-size: 18px; }
  .list-host { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 16px 16px; }
  .card { flex: 1; min-height: 0; border: 1px solid #e1dfdd; border-radius: 8px; }
  .scroller { height: 100%; overflow-y: auto; }
  [role="row"] { display: flex; align-items: center; height: 42px; border-bottom: 1px solid #f3f2f1; }
  [role="columnheader"], [role="gridcell"], [role="rowheader"] { padding: 0 8px; display: flex; align-items: center; gap: 8px; }
  .c-icon { width: 48px; }
  .c-name { flex: 1; min-width: 0; }
  .c-size { width: 100px; }
  .c-name button, .c-name a { all: unset; cursor: pointer; }
  .c-name button:hover, .c-name a:hover { text-decoration: underline; }
  .c-icon img { width: 20px; height: 20px; }
</style>
</head>
<body>
  <div class="suite-bar">SharePoint</div>
  <div class="app">
    <div class="nav">Home<br>Documents</div>
    <div class="main">
      <div class="command-bar">+ New &nbsp; Upload &nbsp; Sync</div>
      <div class="breadcrumb" id="breadcrumb"></div>
      <div class="list-host">
        <div role="" style="display: contents;">
          <div class="card">
            <div class="scroller">
              <div role="grid" aria-label="Documents" id="grid">
                <div role="row" class="header">
                  <div role="columnheader" class="c-icon" aria-label="File type"></div>
                  <div role="columnheader" class="c-name">Name</div>
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
  const TREE = ${JSON.stringify(tree())};
  const LIBRARY = ${JSON.stringify(LIBRARY)};
  const LIST_PAGE = ${JSON.stringify(LIST_PAGE)};
  const grid = document.getElementById('grid');
  const icon = (e) => e.folder ? '/_layouts/15/images/itemtypefolder.svg' : '/_layouts/15/images/itemtypegeneric.svg';
  const size = (e) => e.folder ? '' : e.size + ' bytes';

  function folderOfUrl() {
    const id = new URLSearchParams(location.search).get('id');
    return id ? id.replace(/\\/+$/, '') : LIBRARY;
  }

  // Rows are reused across folders (as SharePoint's virtualised list does)
  function render() {
    const folder = folderOfUrl();
    const entries = TREE[folder] || [];
    document.getElementById('breadcrumb').textContent = folder.split('/').slice(3).join(' › ');
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
      // Same row element, new cells contents: like SharePoint after navigation
      const nameField = e.folder
        ? '<a href="' + LIST_PAGE + '?id=' + encodeURIComponent(folder + '/' + e.name) + '" data-folder>' + e.name + '</a>'
        : '<button type="button">' + e.name + '</button>';
      row.innerHTML =
        '<div role="gridcell" class="c-icon"><img alt="" src="' + icon(e) + '"></div>' +
        '<div role="gridcell" class="c-name" data-automationid="field-LinkFilename">' + nameField + '</div>' +
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
  render();
</script>
</body>
</html>`);
}

/** @param {string} file local path @param {string} method @param {string|undefined} range @returns {Reply} */
function serveFile(file, method, range) {
    const data = fs.readFileSync(file);
    const headers = {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'accept-ranges': 'bytes',
        'last-modified': MODIFIED.toUTCString(),
        'etag': `"{${data.length}},1"`,
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

/**
 * Answers one request to the fake SharePoint.
 * @param {{ url: string, method: string, headers: Object<string, string> }} request
 * @returns {Reply}
 */
export function handle({ url, method, headers }) {
    const u = new URL(url);
    const pathname = decodeURIComponent(u.pathname);

    if (pathname === LIST_PAGE) return listPage();
    if (pathname === `${SITE}/SitePages/Home.aspx`) {
        return html(
            '<!doctype html><title>Home</title><h1>Home</h1><div role="grid"><div role="row">notes.txt</div></div>',
        );
    }
    if (pathname.startsWith('/_layouts/')) {
        return {
            status: 200,
            headers: { 'content-type': 'image/svg+xml' },
            body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        };
    }
    if (pathname.startsWith(`${RELEASE_FOLDER}/`)) {
        const file = path.join(PATH_RELEASE, path.basename(pathname));
        return fs.existsSync(file) ? serveFile(file, method, headers.range) : fail(404);
    }
    const file = localPath(pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return fail(404);
    return serveFile(file, method, headers.range);
}
