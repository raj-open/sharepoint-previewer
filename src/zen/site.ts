// Site of the Zen list: its title and document libraries (Sharepoint API, read once per site)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { getJson } from '../readers/api.ts';

import type { ZenLibrary } from '../_core/types.ts';
import type { ZenSite } from '../_core/types.ts';

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

// Sites read (or being read), by server-relative URL
const sites: Map<string, Promise<ZenSite | string>> = new Map();

// ===========================================================================
// METHODS
// ===========================================================================

/** @param site server-relative ('' = root site) @returns its title and document libraries, or why not */
export function loadSite(site: string): Promise<ZenSite | string> {
    const kept = sites.get(site);
    if (kept) return kept;
    const read = readSite(site).then((data) => {
        if (typeof data === 'string') sites.delete(site); // read again next time
        return data;
    });
    sites.set(site, read);
    return read;
}

async function readSite(site: string): Promise<ZenSite | string> {
    const listsUrl =
        `${site}/_api/web/lists?$filter=BaseTemplate eq 101 and Hidden eq false` +
        '&$select=Title,DefaultViewUrl,RootFolder/ServerRelativeUrl&$expand=RootFolder';
    const [web, lists] = await Promise.all([
        getJson<{ Title?: string }>(`${site}/_api/web?$select=Title`),
        getJson<{ value?: ListJson[] }>(listsUrl),
    ]);
    if (typeof lists === 'string') return `libraries: ${lists}`;
    const title = (typeof web === 'string' ? '' : web?.Title) || site.split('/').pop() || 'Site';
    return { title, url: `${site}/_layouts/15/viewlsts.aspx`, libraries: toLibraries(lists?.value ?? []) };
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
