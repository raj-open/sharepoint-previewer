// Zen list changes kept in the view (Save) until they are uploaded: per folder, in the browser

// ===========================================================================
// IMPORTS
// ===========================================================================

import { loadPref } from '../_core/prefs.ts';
import { savePref } from '../_core/prefs.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** changes of a folder: per item id, per field the value */
export type Changes = Map<number, Record<string, string>>;

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const ZEN_CHANGES_KEY = 'tp-preview-zen-changes';
const MAX_FOLDERS = 50; // folders whose changes are kept (most recent first)

// ===========================================================================
// METHODS
// ===========================================================================

function keptChanges(): Record<string, Record<string, Record<string, string>>> {
    try {
        const all = JSON.parse(loadPref(ZEN_CHANGES_KEY, '{}'));
        return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
        return {};
    }
}

const folderKey = (folder: string): string => folder.replace(/\/+$/, '').toLowerCase();

/** @returns changes kept for a folder (none: empty) */
export function loadChanges(folder: string): Changes {
    const kept = keptChanges()[folderKey(folder)] ?? {};
    const out: Changes = new Map();
    for (const [id, values] of Object.entries(kept)) {
        if (!/^\d+$/.test(id) || !values || typeof values !== 'object') continue;
        const own = Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === 'string'));
        if (Object.keys(own).length) out.set(Number(id), own);
    }
    return out;
}

/** Keeps the changes of a folder (none: forgotten) */
export function keepChanges(folder: string, changes: Changes): void {
    const key = folderKey(folder);
    const others = Object.entries(keptChanges()).filter(([k]) => k !== key);
    const own = changes.size ? [[key, Object.fromEntries(changes)] as const] : [];
    savePref(ZEN_CHANGES_KEY, JSON.stringify(Object.fromEntries([...own, ...others].slice(0, MAX_FOLDERS))));
}
