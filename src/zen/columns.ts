// Zen list columns: order, hidden ones and widths per library (kept in the browser), columns menu

// ===========================================================================
// IMPORTS
// ===========================================================================

import { loadPref } from '../_core/prefs.ts';
import { savePref } from '../_core/prefs.ts';
import { esc } from '../_core/util.ts';
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

/** Keeps order and hidden columns of the list (all columns written out) */
export function setColumns(z: Zen, order: string[], hidden: Set<string>): void {
    if (!z.data) return;
    z.columns = { order, hidden: order.filter((n) => hidden.has(n)), widths: z.columns.widths };
    saveColumns(z.data.library, z.columns);
}

/** @returns order with `col` moved before `to` (null: to the end) */
export function moveColumn(order: string[], col: string, to: string | null): string[] {
    if (col === to) return order;
    const out = order.filter((n) => n !== col);
    const i = to == null ? -1 : out.indexOf(to);
    out.splice(i < 0 ? out.length : i, 0, col);
    return out;
}

// ---------------------------------------------------------------------------
// Columns menu: a checkbox per column (shown / hidden), drag to change the order; back to the view's columns
// ---------------------------------------------------------------------------

/** Opens (or closes) the columns menu below its button; `changed`: columns to be drawn anew */
export function toggleColumnsMenu(z: Zen, changed: () => void): void {
    const open = z.el.querySelector('.tp-zen-columns');
    if (open) return void open.remove();
    if (!z.data) return;
    const data = z.data;
    const menu = document.createElement('div');
    menu.className = 'tp-menu tp-zen-columns';
    const titleOf = new Map(data.fields.map((f) => [f.name, f.title]));
    const draw = () => {
        const { order, hidden } = columnOrder(data, z.columns);
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
    };
    draw();
    const apply = (order: string[], hidden: Set<string>) => {
        setColumns(z, order, hidden);
        draw();
        changed();
    };
    menu.addEventListener('change', (e) => {
        const label = (e.target as HTMLElement).closest('[data-col]') as HTMLElement | null;
        if (!label) return;
        const { order, hidden } = columnOrder(data, z.columns);
        const col = label.dataset.col as string;
        if ((e.target as HTMLInputElement).checked) hidden.delete(col);
        else hidden.add(col);
        apply(order, hidden);
    });
    menu.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('[data-reset]')) return;
        z.columns = { order: [], hidden: [], widths: {} };
        saveColumns(data.library, z.columns);
        draw();
        changed();
    });
    wireReorder(menu, {
        item: 'label[data-col]',
        axis: 'y',
        drop: (col, target, after) => {
            const { order, hidden } = columnOrder(data, z.columns);
            const i = order.indexOf(target) + (after ? 1 : 0);
            apply(moveColumn(order, col, order[i] ?? null), hidden);
        },
    });
    menu.style.top = `${z.columnsBtn.offsetTop + z.columnsBtn.offsetHeight + 4}px`;
    menu.style.right = '8px';
    z.el.append(menu);
    const outside = (e: Event) => {
        if (menu.contains(e.target as Node) || z.columnsBtn.contains(e.target as Node)) return;
        menu.remove();
        document.removeEventListener('pointerdown', outside, true);
    };
    document.addEventListener('pointerdown', outside, true);
}
