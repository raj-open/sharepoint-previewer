// Zen list delete: the items selected, after asking; folders with all in them.
// Delete: as Sharepoint's own Delete does it (to the site's recycle bin; restorable there);
// purge: for good (not to the recycle bin; cannot be undone)

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

/**
 * @param purge for good (not to the recycle bin)
 * @returns question before deleting: number and names of the items, folders marked and warned of
 */
export function deleteQuestion(items: ZenItem[], purge = false): string {
    const n = items.length;
    const folders = items.filter((x) => x.folder).length;
    const names = items.slice(0, MAX_NAMES).map((x) => `    • ${x.name}${x.folder ? ' (folder)' : ''}`);
    if (n > MAX_NAMES) names.push(`    … and ${(n - MAX_NAMES).toLocaleString()} more`);
    const count = `${n.toLocaleString()} item${n === 1 ? '' : 's'}`;
    const lines = [purge ? `PURGE ${count} for good?` : `Delete ${count}?`, '', ...names, ''];
    if (folders) {
        const which = folders === 1 ? 'The folder is' : `The ${folders.toLocaleString()} folders are`;
        lines.push(
            `⚠ ${which} ${purge ? 'purged' : 'deleted'} with everything in them (all files and subfolders).`,
            '',
        );
    }
    lines.push(
        purge
            ? "⚠ They do NOT go to the site's recycle bin: they cannot be restored. This cannot be undone."
            : "Deleted items go to the site's recycle bin (restorable from there).",
    );
    return lines.join('\n');
}

/** @returns key that deletes the items selected: Delete, or Cmd + Backspace (as the Finder) */
export const isDeleteKey = (e: KeyboardEvent): boolean =>
    !e.altKey && !e.shiftKey && (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey));

/** @returns key that purges the items selected: Shift + Delete (as the Explorer), or Cmd + Alt + Backspace (as the Finder) */
export const isPurgeKey = (e: KeyboardEvent): boolean =>
    (e.key === 'Delete' && e.shiftKey && !e.altKey) || (e.key === 'Backspace' && e.metaKey && e.altKey && !e.shiftKey);

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/**
 * One item (file, or folder with all in it) to the recycle bin (`recycle()`), or for good (`deleteObject()`)
 * @returns '' when done, else why not
 */
export async function removeItem(library: string, id: number, purge = false): Promise<string> {
    const site = siteOf(library);
    const how = purge ? 'deleteObject()' : 'recycle()';
    const url = `${site}/_api/web/GetList(@list)/items(${id})/${how}?@list=${encodeURIComponent(quote(library))}`;
    const data = await postJson<unknown>(site, url, undefined);
    return typeof data === 'string' ? data : '';
}

/**
 * Deletes the items one by one (to the recycle bin; purge: for good)
 * @returns items not deleted, each with why not
 */
export async function deleteItems(
    library: string,
    items: ZenItem[],
    progress: (text: string) => void,
    purge = false,
): Promise<{ item: ZenItem; why: string }[]> {
    const failed: { item: ZenItem; why: string }[] = [];
    for (const [i, item] of items.entries()) {
        progress(`${purge ? 'Purging' : 'Deleting'} ${i + 1} / ${items.length} …`);
        const why = await removeItem(library, item.id, purge);
        if (why) failed.push({ item, why });
    }
    return failed;
}
