// Zen list delete: the items selected, as Sharepoint's own Delete does it
// (to the site's recycle bin, folders with all in them; restorable there), after asking

// ===========================================================================
// IMPORTS
// ===========================================================================

import { postJson } from '../readers/api.ts';
import { quote } from '../readers/api.ts';
import { siteOf } from '../readers/api.ts';

import type { ZenItem } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const MAX_NAMES = 20; // names listed in the question (the others counted)

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

/** @returns question before deleting: number and names of the items, folders marked and warned of */
export function deleteQuestion(items: ZenItem[]): string {
    const n = items.length;
    const folders = items.filter((x) => x.folder).length;
    const names = items.slice(0, MAX_NAMES).map((x) => `    • ${x.name}${x.folder ? ' (folder)' : ''}`);
    if (n > MAX_NAMES) names.push(`    … and ${(n - MAX_NAMES).toLocaleString()} more`);
    const lines = [`Delete ${n.toLocaleString()} item${n === 1 ? '' : 's'}?`, '', ...names, ''];
    if (folders) {
        const which = folders === 1 ? 'The folder is' : `The ${folders.toLocaleString()} folders are`;
        lines.push(`⚠ ${which} deleted with everything in them (all files and subfolders).`, '');
    }
    lines.push("Deleted items go to the site's recycle bin (restorable from there).");
    return lines.join('\n');
}

/** @returns key that deletes the items selected: Delete, or Cmd + Backspace (as the Finder) */
export const isDeleteKey = (e: KeyboardEvent): boolean =>
    !e.altKey && !e.shiftKey && (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey));

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/** One item (file, or folder with all in it) to the recycle bin @returns '' when done, else why not */
export async function recycleItem(library: string, id: number): Promise<string> {
    const site = siteOf(library);
    const url = `${site}/_api/web/GetList(@list)/items(${id})/recycle()?@list=${encodeURIComponent(quote(library))}`;
    const data = await postJson<unknown>(site, url, undefined);
    return typeof data === 'string' ? data : '';
}

/**
 * Deletes the items one by one (to the recycle bin)
 * @returns items not deleted, each with why not
 */
export async function deleteItems(
    library: string,
    items: ZenItem[],
    progress: (text: string) => void,
): Promise<{ item: ZenItem; why: string }[]> {
    const failed: { item: ZenItem; why: string }[] = [];
    for (const [i, item] of items.entries()) {
        progress(`Deleting ${i + 1} / ${items.length} …`);
        const why = await recycleItem(library, item.id);
        if (why) failed.push({ item, why });
    }
    return failed;
}
