// Zen list selection: items picked by their checkboxes (one; all shown; a range by Shift), rows by Ctrl / Cmd,
// all shown by Ctrl / Cmd + A (the pointer over the list); dropped by Esc or a click elsewhere

// ===========================================================================
// IMPORTS
// ===========================================================================

import { typing } from '../_core/util.ts';
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

/** All items shown picked (those the list has, as filtered: nothing more is read) */
export function pickShown(z: Zen): void {
    for (const x of itemsShown(z)) z.selected.add(x.id);
    z.anchor = null;
}

/** Selection dropped (nothing picked) @returns there was one */
export function dropSelection(z: Zen): boolean {
    if (!z.selected.size) return false;
    z.selected.clear();
    z.anchor = null;
    showPicked(z);
    return true;
}

/**
 * @returns a click (pointer released) keeps the selection: on what acts on it (download, delete / purge),
 * on a checkbox, a row by Shift or Ctrl / Cmd (they change it), or the list's scrollbars
 */
export function keepsSelection(z: Zen, e: PointerEvent): boolean {
    const t = e.target as Element;
    if (t === z.grid && onScrollbar(z.grid, e)) return true; // the list's empty space below the rows: not kept
    if (z.downloadBtn.contains(t) || z.deleteBtn.contains(t)) return true;
    if (t.closest?.('.tp-zen-pick')) return true;
    return (e.shiftKey || e.ctrlKey || e.metaKey) && !!t.closest?.('tr.tp-zen-row');
}

/** @returns the pointer on a scrollbar of `el` (right of or below its content box) */
function onScrollbar(el: HTMLElement, e: PointerEvent): boolean {
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left + el.clientLeft + el.clientWidth || e.clientY >= r.top + el.clientTop + el.clientHeight;
}

/** @returns Ctrl / Cmd + A (no Shift or Alt) */
export const isSelectAllKey = (e: KeyboardEvent): boolean =>
    !!(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a';

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
 * Ctrl / Cmd + A, the pointer over the list and the text cursor in no field (nor in the viewer, a bar or the pane):
 * all items shown. A click elsewhere (cf. keepsSelection) drops the selection (Esc too: cf. zenEscape),
 * not while a download or delete is under way.
 * @param changed selection changed
 * @returns stops listening on the page
 */
export function wireSelect(z: Zen, changed: () => void): () => void {
    const grid = z.grid;
    let over = false; // pointer over the list
    grid.addEventListener('pointerenter', () => {
        over = true;
    });
    grid.addEventListener('pointerleave', () => {
        over = false;
    });
    const onKey = (e: KeyboardEvent) => {
        if (!over || !z.data || !isSelectAllKey(e)) return;
        const focus = document.activeElement;
        if (typing(focus) || focus?.closest('.tp-viewer, .tp-bar, .tp-zen-pane, .tp-menu, .tp-settings')) return;
        e.preventDefault(); // not the page's text
        e.stopPropagation();
        pickShown(z);
        showPicked(z);
        changed();
    };
    document.addEventListener('keydown', onKey, true);
    // on release, not on press: dropping it may change the header's height (folder line), and moving the rows
    // between press and release would lose the click (e.g. on a folder to open)
    const onUp = (e: PointerEvent) => {
        if (z.fetching || z.busy || keepsSelection(z, e)) return;
        if (dropSelection(z)) changed();
    };
    document.addEventListener('pointerup', onUp, true);
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
    return () => {
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('pointerup', onUp, true);
    };
}
