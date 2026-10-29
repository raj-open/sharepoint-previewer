// Filters and sorting of tables (table view, Zen list): rows shown, filter panel of a column

// ===========================================================================
// IMPORTS
// ===========================================================================

import { esc } from '../_core/util.ts';

import type { Filter } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const MAX_VALUES = 1000; // values listed in a filter panel
const PANEL_WIDTH = 240;

// Filter panel open (one at a time) and its outside-click handler
let panel: HTMLElement | null = null;

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Rows shown
// ---------------------------------------------------------------------------

/**
 * @param count rows
 * @param cell text of a cell (filters)
 * @param key sort key of a cell (default: its text); numbers in it sort as numbers
 * @returns indexes of the rows shown: filtered, then sorted (stable)
 */
export function shownRows<K>(
    count: number,
    cell: (i: number, col: K) => string,
    filters: Map<K, Filter>,
    sort: { col: K; dir: number } | null,
    key: (i: number, col: K) => string = cell,
): number[] {
    let idx = Array.from({ length: count }, (_, i) => i);
    for (const [col, f] of filters) {
        const text = f.text.toLowerCase();
        idx = idx.filter((i) => {
            const v = cell(i, col);
            return (!f.values || f.values.has(v)) && (!text || v.toLowerCase().includes(text));
        });
    }
    if (sort) {
        const { col, dir } = sort;
        const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        idx.sort((a, b) => dir * cmp.compare(key(a, col), key(b, col)) || a - b);
    }
    return idx;
}

/** @returns sort after a click on a column title: ascending, descending, off */
export function nextSort<K>(sort: { col: K; dir: number } | null, col: K): { col: K; dir: number } | null {
    if (!sort || sort.col !== col) return { col, dir: 1 };
    return sort.dir > 0 ? { col, dir: -1 } : null;
}

// ---------------------------------------------------------------------------
// Filter panel: values with checkboxes (counts), plus "contains" text field
// ---------------------------------------------------------------------------

export function closeFilterPanel(): void {
    panel?.remove();
    panel = null;
    document.removeEventListener('pointerdown', outside, true);
}

function outside(e: Event): void {
    if (panel && !panel.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tp-filter'))
        closeFilterPanel();
}

/**
 * Opens the panel below `btn`, inside `content`'s parent.
 * @param cells texts of the column (all rows)
 * @param onChange new filter (null: none)
 */
export function openFilterPanel(
    content: HTMLElement,
    btn: HTMLElement,
    cells: string[],
    current: Filter | undefined,
    onChange: (f: Filter | null) => void,
): void {
    closeFilterPanel();
    const f = current || { values: null, text: '' };
    const counts = new Map<string, number>();
    for (const v of cells) counts.set(v, (counts.get(v) || 0) + 1);
    const cmp = new Intl.Collator(undefined, { numeric: true }).compare;
    const values = [...counts.keys()].sort(cmp).slice(0, MAX_VALUES);
    const p = document.createElement('div');
    p.className = 'tp-filter-panel';
    const items = values
        .map(
            (val, i) => `
        <label><input type="checkbox" data-i="${i}"${!f.values || f.values.has(val) ? ' checked' : ''}>
        ${esc(val || '(empty)')} <span>${counts.get(val)}</span></label>`,
        )
        .join('');
    const more = counts.size > values.length ? `<small>first ${values.length} of ${counts.size} values</small>` : '';
    p.innerHTML = `
      <input type="text" placeholder="contains …" value="${esc(f.text)}">
      <label><input type="checkbox" data-all> <em>all</em></label>
      <div class="tp-filter-list">${items}
      </div>
      ${more}
    `;
    const r = btn.getBoundingClientRect();
    const host = content.parentElement as HTMLElement; // content sits in the viewer (or Zen list)
    const box = host.getBoundingClientRect();
    p.style.left = `${Math.max(0, Math.min(r.left - box.left, box.width - PANEL_WIDTH))}px`;
    p.style.top = `${r.bottom - box.top + 2}px`;
    host.append(p);
    panel = p;
    document.addEventListener('pointerdown', outside, true);

    const boxes = [...p.querySelectorAll('[data-i]')] as HTMLInputElement[]; // checkboxes
    const all = p.querySelector('[data-all]') as HTMLInputElement; // in the panel's HTML above
    const input = p.querySelector('input[type="text"]') as HTMLInputElement;
    all.checked = boxes.every((b) => b.checked);
    const apply = () => {
        const checked = boxes.filter((b) => b.checked).map((b) => values[Number(b.dataset.i)]);
        const everything = checked.length === values.length;
        const nf = { values: everything ? null : new Set(checked), text: input.value };
        onChange(!nf.values && !nf.text ? null : nf);
    };
    all.onchange = () => {
        for (const b of boxes) b.checked = all.checked;
        apply();
    };
    (p.querySelector('.tp-filter-list') as HTMLElement).onchange = () => {
        all.checked = boxes.every((b) => b.checked);
        apply();
    };
    input.oninput = () => {
        const t = input.value.toLowerCase();
        for (const b of boxes) {
            (b.parentElement as HTMLElement).style.display = values[Number(b.dataset.i)].toLowerCase().includes(t)
                ? ''
                : 'none';
        }
        apply();
    };
    input.focus();
}
