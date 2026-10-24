// Files by SharePoint search: rows of search results in a library carry no path, only the name

// ===========================================================================
// IMPORTS
// ===========================================================================

import { sameOrigin } from './request.js';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const SITE_RE = /^\/(?:sites|teams)\/[^/]+/i; // site of a server-relative path ('' = root site)

/** @type {Map<string, string>} path guessed from folder and name -> path found */
export const foundPaths = new Map();

// ===========================================================================
// METHODS
// ===========================================================================

// File `name` in `folder` or below, by the search index (as the search results themselves)
// NOTE: same name in several sub-folders: the one in `folder` itself, else the first found
/** @param {string} folder server-relative @param {string} name @returns {Promise<string|null>} server-relative path */
export async function findFile(folder, name) {
    const guess = `${folder}/${name}`;
    const known = foundPaths.get(guess);
    if (known) return known;
    const site = folder.match(SITE_RE)?.[0] ?? '';
    const query = `filename:"${name}" path:"${location.origin}${folder}"`.replace(/'/g, "''");
    const url =
        `${site}/_api/search/query?querytext='${encodeURIComponent(query)}'` +
        "&selectproperties='Path'&rowlimit=50&trimduplicates=false";
    if (!sameOrigin(url)) return null;
    /** @type {{ Cells: { Key: string, Value: string|null }[] }[]} */
    let rows;
    try {
        const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json;odata=nometadata' },
        });
        if (!res.ok) return null;
        rows = (await res.json())?.PrimaryQueryResult?.RelevantResults?.Table?.Rows ?? [];
    } catch {
        return null;
    }
    const below = `${folder.toLowerCase()}/`;
    const paths = rows.flatMap((r) => {
        const value = r.Cells.find((c) => c.Key === 'Path')?.Value;
        let path;
        try {
            path = value ? decodeURIComponent(new URL(value).pathname) : '';
        } catch {
            return [];
        }
        return path.split('/').pop() === name && path.toLowerCase().startsWith(below) ? [path] : [];
    });
    const path = paths.find((p) => p.toLowerCase() === guess.toLowerCase()) ?? paths[0] ?? null;
    if (path) foundPaths.set(guess, path);
    return path;
}
