// Zen list columns: order, hidden ones and widths per library (kept in the browser), layout mode, columns menu;
// widths are changed in any mode and kept at once (they never go to Sharepoint)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { loadPref } from '../_core/prefs.ts';
import { savePref } from '../_core/prefs.ts';
import { esc } from '../_core/util.ts';
import { placeBelow } from '../ui/bar.ts';
import { wireReorder } from '../view/reorder.ts';
import { NAME } from './data.ts';

import type { Zen } from '../_core/types.ts';
import type { ZenColumns } from '../_core/types.ts';
import type { ZenData } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const ZEN_COLUMNS_KEY = 'tp-preview-zen-columns';
const MAX_LIBRARIES = 100; // libraries whose columns are kept (most recent first)

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Kept per library
// ---------------------------------------------------------------------------

function keptColumns(): Record<string, ZenColumns> {
    try {
        const all = JSON.parse(loadPref(ZEN_COLUMNS_KEY, '{}'));
        return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
        return {};
    }
}

/** @returns columns kept for the library (empty: none yet) */
export function loadColumns(library: string): ZenColumns {
    const c = keptColumns()[library.toLowerCase()];
    return {
        order: Array.isArray(c?.order) ? c.order.filter((x) => typeof x === 'string') : [],
        hidden: Array.isArray(c?.hidden) ? c.hidden.filter((x) => typeof x === 'string') : [],
        widths: c?.widths && typeof c.widths === 'object' ? c.widths : {},
    };
}

export function saveColumns(library: string, columns: ZenColumns): void {
    const all = keptColumns();
    const key = library.toLowerCase();
    delete all[key];
    const kept = Object.entries(all).slice(0, MAX_LIBRARIES - 1);
    savePref(ZEN_COLUMNS_KEY, JSON.stringify(Object.fromEntries([[key, columns], ...kept])));
}

/**
 * Columns in order: those kept first (still there), then the others; the view's columns shown at first,
 * the rest hidden until shown. The name is not among them (always first).
 */
export function columnOrder(data: ZenData, columns: ZenColumns): { order: string[]; hidden: Set<string> } {
    const known = new Set(data.fields.map((f) => f.name));
    known.delete(NAME);
    const order = columns.order.filter((n) => known.has(n));
    const rest = [...data.view, ...data.fields.map((f) => f.name)].filter((n) => known.has(n) && !order.includes(n));
    for (const n of rest) if (!order.includes(n)) order.push(n);
    const fresh = !columns.order.length;
    const hidden = new Set(
        fresh ? order.filter((n) => !data.view.includes(n)) : columns.hidden.filter((n) => known.has(n)),
    );
    // columns new since the order was kept: hidden unless in the view
    if (!fresh) for (const n of rest) if (!data.view.includes(n)) hidden.add(n);
    return { order, hidden };
}

/** @returns columns shown, in order */
export function shownColumns(z: Zen): string[] {
    if (!z.data) return [];
    const { order, hidden } = columnOrder(z.data, z.columns);
    return order.filter((n) => !hidden.has(n));
}

/** Order and hidden columns of the list (all columns written out; layout mode: a draft until saved) */
export function setColumns(z: Zen, order: string[], hidden: Set<string>): void {
    if (!z.data) return;
    z.columns = { order, hidden: order.filter((n) => hidden.has(n)), widths: z.columns.widths };
}

/** @returns order with `col` moved before `to` (null: to the end) */
export function moveColumn(order: string[], col: string, to: string | null): string[] {
    if (col === to) return order;
    const out = order.filter((n) => n !== col);
    const i = to == null ? -1 : out.indexOf(to);
    out.splice(i < 0 ? out.length : i, 0, col);
    return out;
}

/** Widths kept for the library at once (in layout mode: not part of the draft) */
export function saveWidths(z: Zen): void {
    if (!z.data) return;
    const widths = { ...z.columns.widths };
    saveColumns(z.data.library, { ...loadColumns(z.data.library), widths });
    if (z.layout) z.layout.widths = { ...widths };
}

// ---------------------------------------------------------------------------
// Layout mode: order and shown columns changed as a draft (shown at once); Save keeps them, Cancel drops them
// ---------------------------------------------------------------------------

const copyColumns = (c: ZenColumns): ZenColumns => ({
    order: [...c.order],
    hidden: [...c.hidden],
    widths: { ...c.widths },
});

// Same columns shown, in the same order (however written out; widths are kept apart)
function sameColumns(data: ZenData, a: ZenColumns, b: ZenColumns): boolean {
    const key = (c: ZenColumns) => {
        const { order, hidden } = columnOrder(data, c);
        return JSON.stringify([order, order.filter((n) => hidden.has(n))]);
    };
    return key(a) === key(b);
}

/** @returns layout mode on with columns changed since the last save */
export function layoutDirty(z: Zen): boolean {
    return !!z.layout && !!z.data && !sameColumns(z.data, z.layout, z.columns);
}

/** Layout mode on: the columns as saved remembered (changes from now on: a draft) */
export function beginLayout(z: Zen): void {
    z.layout = copyColumns(z.columns);
}

/** Save: the draft kept for the library (layout mode stays on) */
export function saveLayout(z: Zen): void {
    if (!z.layout || !z.data) return;
    saveColumns(z.data.library, z.columns);
    z.layout = copyColumns(z.columns);
}

/** Layout mode off: changes not saved dropped (the columns as saved again), menu closed */
export function endLayout(z: Zen): void {
    if (z.layout) z.columns = z.layout;
    z.layout = null;
    z.el.querySelector('.tp-zen-columns')?.remove();
}

// ---------------------------------------------------------------------------
// Columns menu (layout mode, open throughout): a checkbox per column (shown / hidden), drag to change the order;
// back to the view's columns
// ---------------------------------------------------------------------------

/** Opens the columns menu below its button; `changed`: columns to be drawn anew */
export function openColumnsMenu(z: Zen, changed: () => void): void {
    if (z.el.querySelector('.tp-zen-columns')) return;
    const menu = document.createElement('div');
    menu.className = 'tp-menu tp-zen-columns';
    menu.addEventListener('change', (e) => {
        const label = (e.target as HTMLElement).closest('[data-col]') as HTMLElement | null;
        if (!label || !z.data) return;
        const { order, hidden } = columnOrder(z.data, z.columns);
        const col = label.dataset.col as string;
        if ((e.target as HTMLInputElement).checked) hidden.delete(col);
        else hidden.add(col);
        setColumns(z, order, hidden);
        changed();
    });
    menu.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('[data-reset]')) return;
        z.columns = { order: [], hidden: [], widths: z.columns.widths }; // widths: kept apart
        changed();
    });
    wireReorder(menu, {
        item: 'label[data-col]',
        axis: 'y',
        drop: (col, target, after) => {
            if (!z.data) return;
            const { order, hidden } = columnOrder(z.data, z.columns);
            const i = order.indexOf(target) + (after ? 1 : 0);
            setColumns(z, moveColumn(order, col, order[i] ?? null), hidden);
            changed();
        },
    });
    z.el.append(menu);
    placeBelow(menu, z.moreBtn.parentElement as HTMLElement, true); // from the ⋯ menu: below the bar's end, right
    drawColumnsMenu(z);
}

/** Draws the entries of the columns menu anew (if open; its scroll position kept) */
export function drawColumnsMenu(z: Zen): void {
    const menu = z.el.querySelector('.tp-zen-columns');
    if (!menu) return;
    const scrolled = menu.querySelector('.tp-zen-columns-list')?.scrollTop ?? 0;
    const data = z.data;
    const { order, hidden } = data ? columnOrder(data, z.columns) : { order: [], hidden: new Set<string>() };
    const titleOf = new Map((data?.fields ?? []).map((f) => [f.name, f.title]));
    menu.innerHTML =
        '<div class="tp-zen-columns-list">' +
        order
            .map(
                (n) =>
                    `<label data-col="${esc(n)}" title="Drag to change the order">` +
                    `<span class="tp-zen-grip">⠿</span><input type="checkbox"${hidden.has(n) ? '' : ' checked'}>` +
                    `<span>${esc(titleOf.get(n) ?? n)}</span></label>`,
            )
            .join('') +
        '</div><button type="button" class="tp-menu-item" data-reset>Columns of the Sharepoint view</button>';
    const list = menu.querySelector('.tp-zen-columns-list');
    if (list) list.scrollTop = scrolled;
}
