// Files by name below the open folder: rows of search results in a library carry no path, only the name

// ===========================================================================
// IMPORTS
// ===========================================================================

import { sameOrigin } from './request.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const SITE_RE = /^\/(?:sites|teams)\/[^/]+/i; // site of a server-relative path ('' = root site)
const JSON_HEADERS = { Accept: 'application/json;odata=nometadata' };

/** @type {Map<string, string>} path guessed from folder and name -> path found */
export const foundPaths = new Map();

/** @type {Map<string, string>} path guessed -> how the lookup went (shown when the file is not found) */
export const lookupNotes = new Map();

// ===========================================================================
// METHODS
// ===========================================================================

// File `name` in `folder` or below: library's own list first (exact, any file type),
// else search index (as the search results; large lists may refuse the filter)
// NOTE: same name in several sub-folders: the one in `folder` itself, else the first found
/** @param {string} folder server-relative @param {string} name @returns {Promise<string|null>} server-relative path */
export async function findFile(folder, name) {
    const guess = `${folder}/${name}`;
    const known = foundPaths.get(guess);
    if (known) return known;
    const site = folder.match(SITE_RE)?.[0] ?? '';
    const below = `${folder.toLowerCase()}/`;
    /** @param {string[]} paths */
    const pick = (paths) => {
        const inside = paths.filter((p) => p.split('/').pop() === name && p.toLowerCase().startsWith(below));
        return inside.find((p) => p.toLowerCase() === guess.toLowerCase()) ?? inside[0] ?? null;
    };
    const listed = await listPaths(site, name);
    let path = pick(listed.paths);
    const notes = [`library list: ${listed.note}`];
    if (!path) {
        const searched = await searchPaths(site, folder, name);
        path = pick(searched.paths);
        notes.push(`search: ${searched.note}`);
    }
    if (path) foundPaths.set(guess, path);
    lookupNotes.set(guess, `Looked up by name below ${folder}\n${notes.join('\n')}`);
    return path;
}

/** @param {string[]} paths @returns {string} */
const summary = (paths) => (paths.length ? `${paths.length} found (${paths.slice(0, 3).join(', ')})` : 'none found');

// Paths of files named `name` in the library of the open view (FileLeafRef = file name)
/** @param {string} site @param {string} name @returns {Promise<{ paths: string[], note: string }>} */
async function listPaths(site, name) {
    const path = decodeURIComponent(location.pathname);
    const i = path.toLowerCase().indexOf('/forms/');
    if (i < 0) return { paths: [], note: 'not in a list view' };
    const quote = (/** @type {string} */ s) => `'${s.replace(/'/g, "''")}'`;
    const url =
        `${site}/_api/web/GetList(@list)/items?$select=FileRef&$top=50` +
        `&$filter=FileLeafRef eq ${encodeURIComponent(quote(name))}&@list=${encodeURIComponent(quote(path.slice(0, i)))}`;
    /** @type {{ value?: { FileRef?: string }[] }|string} */
    const data = await getJson(url);
    if (typeof data === 'string') return { paths: [], note: data };
    const paths = (data?.value ?? []).flatMap((x) => (x.FileRef ? [x.FileRef] : []));
    return { paths, note: summary(paths) };
}

// Paths of files named `name` below `folder` by the search index; Path may be a form (DispForm.aspx?ID=…)
// for file types the index does not read, then the file is ParentLink + Filename
/** @param {string} site @param {string} folder @param {string} name @returns {Promise<{ paths: string[], note: string }>} */
async function searchPaths(site, folder, name) {
    const query = `(filename:"${name}" OR "${name}") path:"${location.origin}${folder}"`.replace(/'/g, "''");
    const url =
        `${site}/_api/search/query?querytext='${encodeURIComponent(query)}'` +
        "&selectproperties='Path,ParentLink,Filename'&rowlimit=50&trimduplicates=false";
    /** @type {{ PrimaryQueryResult?: { RelevantResults?: { Table?: { Rows?: { Cells: { Key: string, Value: string|null }[] }[] } } } }|string} */
    const data = await getJson(url);
    if (typeof data === 'string') return { paths: [], note: data };
    const rows = data?.PrimaryQueryResult?.RelevantResults?.Table?.Rows ?? [];
    /** @param {string|null|undefined} value @returns {string} */
    const pathOf = (value) => {
        try {
            return value ? decodeURIComponent(new URL(value, location.origin).pathname).replace(/\/+$/, '') : '';
        } catch {
            return '';
        }
    };
    const paths = rows.flatMap((r) => {
        /** @param {string} key */
        const cell = (key) => r.Cells.find((c) => c.Key === key)?.Value;
        const parent = pathOf(cell('ParentLink'));
        return [pathOf(cell('Path')), parent && cell('Filename') ? `${parent}/${cell('Filename')}` : ''];
    });
    return { paths: paths.filter(Boolean), note: summary([...new Set(paths.filter(Boolean))]) };
}

/** @param {string} url @returns {Promise<any>} parsed JSON, or why not (refused, HTTP status, failed) */
async function getJson(url) {
    if (!sameOrigin(url)) return 'refused (other origin)';
    try {
        const res = await fetch(url, { credentials: 'same-origin', headers: JSON_HEADERS });
        return res.ok ? await res.json() : `HTTP ${res.status}`;
    } catch (e) {
        return `failed (${e instanceof Error ? e.message : e})`;
    }
}
