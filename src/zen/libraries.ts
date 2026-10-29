// Document libraries of the Zen list's site (Sharepoint API, read once per site)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { getJson } from '../readers/api.ts';

import type { ZenLibrary } from '../_core/types.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** list as read: title, its default view, its root folder */
export type ListJson = { Title?: string; DefaultViewUrl?: string; RootFolder?: { ServerRelativeUrl?: string } };

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Libraries Sharepoint makes for itself, by the name of their root folder (not translated): left out
const SYSTEM_LIBRARIES = new Set(['siteassets', 'style library', 'formservertemplates']);

// Libraries read (or being read), by site (server-relative)
const sites: Map<string, Promise<ZenLibrary[] | string>> = new Map();

// ===========================================================================
// METHODS
// ===========================================================================

/** @param site server-relative ('' = root site) @returns its document libraries (system ones left out), or why not */
export function loadLibraries(site: string): Promise<ZenLibrary[] | string> {
    const kept = sites.get(site);
    if (kept) return kept;
    const read = readLibraries(site).then((libraries) => {
        if (typeof libraries === 'string') sites.delete(site); // read again next time
        return libraries;
    });
    sites.set(site, read);
    return read;
}

async function readLibraries(site: string): Promise<ZenLibrary[] | string> {
    const lists = await getJson<{ value?: ListJson[] }>(
        `${site}/_api/web/lists?$filter=BaseTemplate eq 101 and Hidden eq false` +
            '&$select=Title,DefaultViewUrl,RootFolder/ServerRelativeUrl&$expand=RootFolder',
    );
    return typeof lists === 'string' ? `libraries: ${lists}` : toLibraries(lists?.value ?? []);
}

/** @returns libraries of the lists read (system ones left out), by title */
export function toLibraries(lists: ListJson[]): ZenLibrary[] {
    return lists
        .flatMap((list) => {
            const folder = (list.RootFolder?.ServerRelativeUrl ?? '').replace(/\/+$/, '');
            const name = (folder.split('/').pop() ?? '').toLowerCase();
            if (!folder || !list.Title || SYSTEM_LIBRARIES.has(name)) return [];
            return [{ title: list.Title, url: list.DefaultViewUrl || `${folder}/Forms/AllItems.aspx`, folder }];
        })
        .sort((a, b) => a.title.localeCompare(b.title));
}
