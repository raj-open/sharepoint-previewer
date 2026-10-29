// Zen list selection: items picked by their checkboxes (one; all shown; a range by Shift), rows by Ctrl / Cmd

// ===========================================================================
// IMPORTS
// ===========================================================================

import { itemOf } from './grid.ts';
import { itemsShown } from './grid.ts';

import type { Zen } from '../_core/types.ts';
import type { ZenItem } from '../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * One item picked or not; with `range`: all from the last one clicked to it (as shown), alike
 * @param on picked (null: the other way round)
 */
export function pick(z: Zen, id: number, on: boolean | null, range = false): void {
    const shown = itemsShown(z).map((x) => x.id);
    const state = on ?? !z.selected.has(id);
    const from = range && z.anchor !== null ? shown.indexOf(z.anchor) : -1;
    const to = shown.indexOf(id);
    const ids = from >= 0 && to >= 0 ? shown.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
    for (const i of ids) {
        if (state) z.selected.add(i);
        else z.selected.delete(i);
    }
    z.anchor = id;
}

/** All items shown picked, or none if they are already */
export function pickAll(z: Zen): void {
    const shown = itemsShown(z);
    const all = pickState(z) === 'all';
    for (const x of shown) {
        if (all) z.selected.delete(x.id);
        else z.selected.add(x.id);
    }
    z.anchor = null;
}

/** Items no longer shown (filtered out, gone) dropped from the selection */
export function pruneSelection(z: Zen): void {
    const shown = new Set(itemsShown(z).map((x) => x.id));
    for (const id of [...z.selected]) if (!shown.has(id)) z.selected.delete(id);
    if (z.anchor !== null && !shown.has(z.anchor)) z.anchor = null;
}

/** @returns items shown: none, some or all of them picked */
export function pickState(z: Zen): 'none' | 'some' | 'all' {
    const shown = itemsShown(z);
    const n = shown.filter((x) => z.selected.has(x.id)).length;
    return !n ? 'none' : n === shown.length ? 'all' : 'some';
}

/** @returns items picked, in the order shown */
export const selectedItems = (z: Zen): ZenItem[] => itemsShown(z).filter((x) => z.selected.has(x.id));

// ---------------------------------------------------------------------------
// Drawing: rows drawn so far and the head's checkbox (rows drawn later read the selection themselves)
// ---------------------------------------------------------------------------

export function showPicked(z: Zen): void {
    for (const tr of z.grid.querySelectorAll<HTMLElement>('tr.tp-zen-row')) {
        const on = z.selected.has(Number(tr.dataset.id));
        tr.classList.toggle('tp-zen-selected', on);
        const box = tr.querySelector<HTMLInputElement>('.tp-zen-pick-one');
        if (box) box.checked = on;
    }
    const all = z.grid.querySelector<HTMLInputElement>('.tp-zen-pick-all');
    if (!all) return;
    const state = pickState(z);
    all.checked = state === 'all';
    all.indeterminate = state === 'some';
    all.title = state === 'all' ? 'Select none' : 'Select all';
}

// ---------------------------------------------------------------------------
// Events (once per Zen list)
// ---------------------------------------------------------------------------

/**
 * Checkboxes: a click picks (Shift: the range from the last one clicked); the head's: all shown or none.
 * Rows (not in edit mode): Ctrl / Cmd + click picks one more (or drops it), Shift + click the range.
 * @param changed selection changed
 */
export function wireSelect(z: Zen, changed: () => void): void {
    const grid = z.grid;
    grid.addEventListener('mousedown', (e) => {
        // Shift: a range of rows, not of text
        if (e.shiftKey && (e.target as HTMLElement).closest('tr.tp-zen-row, .tp-zen-pick')) e.preventDefault();
    });
    grid.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('th.tp-zen-pick')) {
            pickAll(z);
            showPicked(z);
            return void changed();
        }
        const box = t.closest('td.tp-zen-pick');
        const modified = e.shiftKey || e.ctrlKey || e.metaKey;
        if (!box && (!modified || z.editing)) return; // a row opened (or a cell edited)
        const item = itemOf(z, t);
        if (!item) return;
        if (!box) e.preventDefault();
        // the checkbox itself: its new state; a row by Shift: picked; else (its cell, Ctrl / Cmd): the other way round
        const on = t instanceof HTMLInputElement ? t.checked : !box && e.shiftKey ? true : null;
        pick(z, item.id, on, e.shiftKey);
        showPicked(z);
        changed();
    });
}
