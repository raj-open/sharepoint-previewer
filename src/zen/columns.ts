// Zen list columns: order, hidden ones and widths per library (kept in the browser), layout mode, columns pane;
// widths are changed in any mode and kept at once (they never go to Sharepoint)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { loadPref } from '../_core/prefs.ts';
import { savePref } from '../_core/prefs.ts';
import { esc } from '../_core/util.ts';
import { barButton } from '../ui/bar.ts';
import { SAVE_SVG } from '../ui/icons.ts';
import { STOP_SVG } from '../ui/icons.ts';
import { UPLOAD_SVG } from '../ui/icons.ts';
import { WRITE_SVG } from '../ui/icons.ts';
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

/** Layout mode off: changes not saved dropped (the columns as saved again) */
export function endLayout(z: Zen): void {
    if (z.layout) z.columns = z.layout;
    z.layout = null;
}

// ---------------------------------------------------------------------------
// Columns pane (right of the list, its full height): the columns in order, shown or hidden;
// read only until Edit (layout mode): then ticked, unticked and dragged here, or dragged by their titles in the list
// ---------------------------------------------------------------------------

/**
 * Opens the columns pane (bar: Edit, Cancel, Save, Upload, as the list's own; ✕)
 * @param acts what the buttons do; changed: columns to be drawn anew (layout mode)
 */
export function openColumnsPane(
    z: Zen,
    acts: { edit: () => void; cancel: () => void; save: () => void; upload: () => void; close: () => void },
    changed: () => void,
): void {
    if (z.pane) return;
    const el = document.createElement('aside');
    el.className = 'tp-zen-pane tp-zen-columns';
    const editBtn = barButton(WRITE_SVG, 'Edit the columns: show, hide and order them (here or by their titles)');
    editBtn.setAttribute('aria-pressed', 'false');
    const cancelBtn = barButton(STOP_SVG, 'Cancel: drop the changes of the columns not saved, end editing');
    const saveBtn = barButton(SAVE_SVG, 'Save: keep the columns for this library, in this browser (Ctrl+S)');
    const uploadBtn = barButton(
        UPLOAD_SVG,
        'Upload the columns saved to the Sharepoint view (for everyone; asks first)',
    );
    const closeBtn = barButton('✕', 'Close the columns');
    const head = document.createElement('div');
    head.className = 'tp-zen-pane-bar';
    head.innerHTML = '<strong>Columns</strong>';
    head.append(editBtn, cancelBtn, saveBtn, uploadBtn, closeBtn);
    const list = document.createElement('div');
    list.className = 'tp-zen-columns-list';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'tp-menu-item';
    reset.textContent = 'Columns of the Sharepoint view';
    el.append(head, list, reset);
    editBtn.onclick = acts.edit;
    cancelBtn.onclick = acts.cancel;
    saveBtn.onclick = acts.save;
    uploadBtn.onclick = acts.upload;
    closeBtn.onclick = acts.close;
    list.addEventListener('change', (e) => {
        const label = (e.target as HTMLElement).closest('[data-col]') as HTMLElement | null;
        if (!label || !z.data || !z.layout) return;
        const { order, hidden } = columnOrder(z.data, z.columns);
        const col = label.dataset.col as string;
        if ((e.target as HTMLInputElement).checked) hidden.delete(col);
        else hidden.add(col);
        setColumns(z, order, hidden);
        changed();
    });
    reset.onclick = () => {
        if (!z.layout) return;
        z.columns = { order: [], hidden: [], widths: z.columns.widths }; // widths: kept apart
        changed();
    };
    wireReorder(list, {
        item: 'label[data-col]',
        axis: 'y',
        movable: () => !!z.layout,
        drop: (col, target, after) => {
            if (!z.data || !z.layout) return;
            const { order, hidden } = columnOrder(z.data, z.columns);
            const i = order.indexOf(target) + (after ? 1 : 0);
            setColumns(z, moveColumn(order, col, order[i] ?? null), hidden);
            changed();
        },
    });
    z.pane = { el, list, reset, editBtn, cancelBtn, saveBtn, uploadBtn };
    z.body.append(el);
    drawColumnsPane(z);
}

/** Closes the columns pane (layout mode: ended before, cf. endLayout) */
export function closeColumnsPane(z: Zen): void {
    z.pane?.el.remove();
    z.pane = null;
}

/** @returns columns saved for the library (shown, in order) differ from the Sharepoint view's */
export function differsFromView(z: Zen): boolean {
    if (!z.data?.viewId) return false;
    const saved = z.layout ?? z.columns;
    const { order, hidden } = columnOrder(z.data, saved);
    return JSON.stringify(order.filter((n) => !hidden.has(n))) !== JSON.stringify(z.data.view);
}

/** Draws the columns pane anew (if open; the list's scroll position kept): entries, buttons as the mode allows */
export function drawColumnsPane(z: Zen): void {
    const pane = z.pane;
    if (!pane) return;
    const data = z.data;
    const layout = !!z.layout;
    const { order, hidden } = data ? columnOrder(data, z.columns) : { order: [], hidden: new Set<string>() };
    const titleOf = new Map((data?.fields ?? []).map((f) => [f.name, f.title]));
    const scrolled = pane.list.scrollTop;
    const off = layout ? '' : ' disabled';
    pane.list.innerHTML = order
        .map((n) => {
            const box = `<input type="checkbox"${hidden.has(n) ? '' : ' checked'}${off}>`;
            const grip = layout ? '<span class="tp-zen-grip">⠿</span>' : '';
            const tip = layout ? ' title="Drag to change the order"' : '';
            const name = esc(titleOf.get(n) ?? n);
            return `<label data-col="${esc(n)}"${tip}>${grip}${box}<span title="${name}">${name}</span></label>`;
        })
        .join('');
    pane.list.scrollTop = scrolled;
    showPaneButtons(z);
}

/** Buttons of the columns pane as the mode allows (layout mode and editing properties exclude each other) */
export function showPaneButtons(z: Zen): void {
    const pane = z.pane;
    if (!pane) return;
    const layout = !!z.layout;
    pane.el.classList.toggle('tp-zen-pane-editing', layout);
    pane.reset.disabled = !layout;
    pane.editBtn.setAttribute('aria-pressed', String(layout));
    pane.editBtn.disabled = !layout && (z.busy || !z.data || z.editing); // not while editing properties
    pane.cancelBtn.disabled = !layout;
    pane.saveBtn.disabled = !layoutDirty(z);
    const ready = !z.busy && !layoutDirty(z) && differsFromView(z); // saved, not in the view yet
    pane.uploadBtn.disabled = !ready;
    pane.uploadBtn.classList.toggle('tp-zen-ready', ready);
}
