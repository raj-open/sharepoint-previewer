// Mock SharePoint Online: one site with one document library, served from ./library (or another folder,
// or several folders shown by name in the library root). Read only: files are read from disk per request.
//
//   /sites/Test/Shared Documents/Forms/AllItems.aspx[?id=<folder>]  list view (client-side app)
//   /sites/Test/Shared Documents/<path>                             file (GET / HEAD, byte ranges)
//   /sites/Test/SitePages/Home.aspx                                 page outside any library
//   /sites/Test/Shared Documents/previewer/<file>                   3D files of the release (if built),
//                                                                   listed as folder "previewer" in the library
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

export const ORIGIN = 'https://acme.sharepoint.com';
export const SITE = '/sites/Test';
export const LIBRARY = `${SITE}/Shared Documents`;
export const LIST_PAGE = `${LIBRARY}/Forms/AllItems.aspx`;
export const PATH_FILES = path.join(HERE, 'library');

export const VERSION = fs.readFileSync(path.join(ROOT, 'dist/VERSION'), 'utf8').trim();
export const PATH_RELEASE = path.join(ROOT, 'dist', `v${VERSION}`);
// 3D files of the release, as a folder of the library (as deployed); setting `viewer-3d-folder`: site-relative
export const RELEASE_FOLDER = `${LIBRARY}/previewer`;
export const RELEASE_SETTING = RELEASE_FOLDER.slice(SITE.length + 1);
const FILES_3D = ['ifc-lite-3d.js', 'ifc-lite_bg.wasm'];

const MODIFIED = new Date('2026-10-01T12:00:00Z');

// Name of the mock tenant (title, suite bar) and its icon: plain shapes, no real logo
const TENANT = 'TestSharepoint';
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

// Entry of a folder listing
type Entry = { name: string; folder: boolean; size: number };
// Answer to a request
export type Reply = { status: number; headers: Record<string, string>; body: Buffer | string };
// Library folder, or folders shown by name in the library root
export type Files = string | Record<string, string>;

/** @returns local path, never outside root (no "..") */
function within(root: string, rel: string): string | null {
    const local = path.join(root, rel);
    return local === root || local.startsWith(root + path.sep) ? local : null;
}

/** @param folder server-relative @returns local path */
function localPath(files: Files, folder: string): string | null {
    if (folder !== LIBRARY && !folder.startsWith(`${LIBRARY}/`)) return null;
    const rel = folder.slice(LIBRARY.length);
    if (typeof files === 'string') return within(files, rel);
    const [name = '', ...rest] = rel.split('/').slice(1);
    return Object.hasOwn(files, name) ? within(files[name], rest.join('/')) : null;
}

/** @returns with absolute paths; folders not there left out */
export function resolveFiles(files: Files): Files {
    if (typeof files === 'string') return path.resolve(files);
    const found = Object.entries(files)
        .map(([name, dir]) => [name, path.resolve(dir)] as const)
        .filter(([, dir]) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
    return Object.fromEntries(found);
}

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
        .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
}

/** @returns 3D files of this version are built (`just build`) */
export const has3dRelease = (): boolean => FILES_3D.every((name) => fs.existsSync(path.join(PATH_RELEASE, name)));

/** @returns server-relative folder -> entries */
function tree(files: Files): Record<string, Entry[]> {
    const out: Record<string, Entry[]> = {};
    const walk = (folder: string) => {
        const local = localPath(files, folder);
        const entries = local
            ? listing(local)
            : Object.keys(files) // library root of several folders
                  .sort((a, b) => a.localeCompare(b))
                  .map((name) => ({ name, folder: true, size: 0 }));
        out[folder] = entries;
        for (const e of entries) if (e.folder) walk(`${folder}/${e.name}`);
    };
    walk(LIBRARY);
    if (has3dRelease() && !out[RELEASE_FOLDER]) {
        out[LIBRARY].unshift({ name: 'previewer', folder: true, size: 0 });
        out[RELEASE_FOLDER] = listing(PATH_RELEASE).filter((e) => FILES_3D.includes(e.name));
    }
    return out;
}

const html = (body: string): Reply => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body });

const fail = (status: number): Reply => ({
    status,
    headers: { 'content-type': 'text/plain' },
    body: `Error ${status}`,
});

function listPage(files: Files): Reply {
    return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Documents - ${TENANT}</title>
<link rel="icon" href="${ICON}">
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
  .breadcrumb a { color: inherit; text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; }
  .list-host { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 16px 16px; }
  /* height not from flex alone: the list keeps reaching the bottom when the viewer sets flex: none */
  .card { flex: 1; height: 100%; min-height: 0; border: 1px solid #e1dfdd; border-radius: 8px; }
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
  <div class="suite-bar">${TENANT}</div>
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
  const TREE = ${JSON.stringify(tree(files))};
  const LIBRARY = ${JSON.stringify(LIBRARY)};
  const LIST_PAGE = ${JSON.stringify(LIST_PAGE)};
  const grid = document.getElementById('grid');
  const icon = (e) => e.folder ? '/_layouts/15/images/itemtypefolder.svg' : '/_layouts/15/images/itemtypegeneric.svg';
  const size = (e) => e.folder ? '' : e.size + ' bytes';
  const folderLink = (folder, text) =>
    '<a href="' + LIST_PAGE + '?id=' + encodeURIComponent(folder) + '" data-folder>' + text + '</a>';

  // Path from the library down: every part but the last leads back to its folder
  function breadcrumb(folder) {
    const parts = folder.slice(LIBRARY.length).split('/').filter(Boolean);
    const names = ['Shared Documents', ...parts];
    return names
      .map((name, i) => {
        const path = [LIBRARY, ...parts.slice(0, i)].join('/');
        return i < names.length - 1 ? folderLink(path, name) : '<span>' + name + '</span>';
      })
      .join(' › ');
  }

  function folderOfUrl() {
    const id = new URLSearchParams(location.search).get('id');
    return id ? id.replace(/\\/+$/, '') : LIBRARY;
  }

  // Rows are reused across folders (as SharePoint's virtualised list does)
  function render() {
    const folder = folderOfUrl();
    const entries = TREE[folder] || [];
    document.getElementById('breadcrumb').innerHTML = breadcrumb(folder);
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
      const nameField = e.folder ? folderLink(folder + '/' + e.name, e.name) : '<button type="button">' + e.name + '</button>';
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

/** @param file local path */
function serveFile(file: string, method: string, range: string | undefined): Reply {
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
 * Answers one request to the mock SharePoint.
 *
 * @param opts library folder (default: ./library), or folders by name in the library root
 */
export function handle(
    { url, method, headers }: { url: string; method: string; headers: Record<string, string> },
    { files = PATH_FILES }: { files?: Files } = {},
): Reply {
    const u = new URL(url);
    const pathname = decodeURIComponent(u.pathname);
    const root = resolveFiles(files);

    if (pathname === LIST_PAGE) return listPage(root);
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
            body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        };
    }
    if (pathname.startsWith(`${RELEASE_FOLDER}/`)) {
        const file = path.join(PATH_RELEASE, path.basename(pathname));
        return fs.existsSync(file) ? serveFile(file, method, headers.range) : fail(404);
    }
    const file = localPath(root, pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return fail(404);
    return serveFile(file, method, headers.range);
}
