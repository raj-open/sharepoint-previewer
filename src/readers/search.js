// Files by name below the open folder: rows of search results in a library carry no path, only the name

// ===========================================================================
// IMPORTS
// ===========================================================================

import { sameOrigin } from './request.js';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const SITE_RE = /^\/(?:sites|teams)\/[^/]+/i; // site of a server-relative path ('' = root site)
const JSON_HEADERS = { Accept: 'application/json;odata=nometadata' };

/** @type {Map<string, string>} path guessed from folder and name -> path found */
export const foundPaths = new Map();

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
    const path = pick(await listPaths(site, name)) ?? pick(await searchPaths(site, folder, name));
    if (path) foundPaths.set(guess, path);
    return path;
}

// Paths of files named `name` in the library of the open view (FileLeafRef = file name)
/** @param {string} site @param {string} name @returns {Promise<string[]>} */
async function listPaths(site, name) {
    const path = decodeURIComponent(location.pathname);
    const i = path.toLowerCase().indexOf('/forms/');
    if (i < 0) return [];
    const quote = (/** @type {string} */ s) => `'${s.replace(/'/g, "''")}'`;
    const url =
        `${site}/_api/web/GetList(@list)/items?$select=FileRef&$top=50` +
        `&$filter=FileLeafRef eq ${encodeURIComponent(quote(name))}&@list=${encodeURIComponent(quote(path.slice(0, i)))}`;
    /** @type {{ value?: { FileRef?: string }[] }|null} */
    const data = await getJson(url);
    return (data?.value ?? []).flatMap((x) => (x.FileRef ? [x.FileRef] : []));
}

// Paths of files named `name` below `folder` by the search index; Path may be a form (DispForm.aspx?ID=…)
// for file types the index does not read, then the file is ParentLink + Filename
/** @param {string} site @param {string} folder @param {string} name @returns {Promise<string[]>} */
async function searchPaths(site, folder, name) {
    const query = `filename:"${name}" path:"${location.origin}${folder}"`.replace(/'/g, "''");
    const url =
        `${site}/_api/search/query?querytext='${encodeURIComponent(query)}'` +
        "&selectproperties='Path,ParentLink,Filename'&rowlimit=50&trimduplicates=false";
    /** @type {{ PrimaryQueryResult?: { RelevantResults?: { Table?: { Rows?: { Cells: { Key: string, Value: string|null }[] }[] } } } }|null} */
    const data = await getJson(url);
    const rows = data?.PrimaryQueryResult?.RelevantResults?.Table?.Rows ?? [];
    /** @param {string|null|undefined} value @returns {string} */
    const pathOf = (value) => {
        try {
            return value ? decodeURIComponent(new URL(value, location.origin).pathname).replace(/\/+$/, '') : '';
        } catch {
            return '';
        }
    };
    return rows.flatMap((r) => {
        /** @param {string} key */
        const cell = (key) => r.Cells.find((c) => c.Key === key)?.Value;
        const parent = pathOf(cell('ParentLink'));
        return [pathOf(cell('Path')), parent && cell('Filename') ? `${parent}/${cell('Filename')}` : ''];
    });
}

/** @param {string} url @returns {Promise<any>} parsed JSON, or null (refused, failed, not JSON) */
async function getJson(url) {
    if (!sameOrigin(url)) return null;
    try {
        const res = await fetch(url, { credentials: 'same-origin', headers: JSON_HEADERS });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}
