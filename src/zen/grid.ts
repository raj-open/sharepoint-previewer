// Zen list grid: name and column titles frozen, sort, filters, widths, column order; cells edited in place

// ===========================================================================
// IMPORTS
// ===========================================================================

import { esc } from '../_core/util.ts';
import { FILE_SVG } from '../ui/icons.ts';
import { FOLDER_SVG } from '../ui/icons.ts';
import { closeFilterPanel } from '../view/filter.ts';
import { nextSort } from '../view/filter.ts';
import { openFilterPanel } from '../view/filter.ts';
import { shownRows } from '../view/filter.ts';
import { CHUNK_LINES } from '../view/lines.ts';
import { watchBlocks } from '../view/lines.ts';
import { wireReorder } from '../view/reorder.ts';
import { columnOrder } from './columns.ts';
import { moveColumn } from './columns.ts';
import { saveColumns } from './columns.ts';
import { setColumns } from './columns.ts';
import { shownColumns } from './columns.ts';
import { NAME } from './data.ts';

import type { Zen } from '../_core/types.ts';
import type { ZenField } from '../_core/types.ts';
import type { ZenItem } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const ROW_HEIGHT = 27; // px, as in the styles (.tp-zen-table td)
const MIN_WIDTH = 48;
const MIN_NAME_WIDTH = 120; // name column: icon and some of the name
const MAX_CELL_TITLE = 2000; // characters of a cell's tooltip

// Blocks of rows being watched (filled near the visible part), per Zen list
const observers: WeakMap<Zen, IntersectionObserver> = new WeakMap();

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** @returns field of a column */
export const fieldOf = (z: Zen, col: string): ZenField | undefined => z.data?.fields.find((f) => f.name === col);

/** @returns value of a cell as edited: yes / no as 1 / 0, else the text shown */
export function originalValue(item: ZenItem, field: ZenField | undefined): string {
    if (field?.type === 'Boolean') return item.raw[field.name] === true || item.raw[field.name] === 1 ? '1' : '0';
    return item.text[field?.name ?? NAME] ?? '';
}

/** @returns value of a cell: changed (not saved yet) or as on Sharepoint */
export function cellValue(z: Zen, item: ZenItem, col: string): string {
    const changed = z.pending.get(item.id)?.[col];
    return changed ?? originalValue(item, fieldOf(z, col));
}

/** @returns text of a cell (yes / no: ✓ or empty, in any language) */
function cellText(z: Zen, item: ZenItem, col: string): string {
    const value = cellValue(z, item, col);
    if (fieldOf(z, col)?.type === 'Boolean') return value === '1' ? '✓' : '';
    return value;
}

/** @returns sort key of a cell: raw value for dates and numbers (sort as such), else the text */
function sortKey(z: Zen, item: ZenItem, col: string): string {
    const raw = item.raw[col];
    if (typeof raw === 'number') return String(raw);
    if (typeof raw === 'string' && /^\d{4}-\d\d-\d\dT/.test(raw)) return raw;
    return cellText(z, item, col);
}

/** Records the value of a cell (back to the original: no change) */
export function setValue(z: Zen, item: ZenItem, col: string, value: string): void {
    const own = { ...(z.pending.get(item.id) ?? {}) };
    if (value === originalValue(item, fieldOf(z, col))) delete own[col];
    else own[col] = value;
    if (Object.keys(own).length) z.pending.set(item.id, own);
    else z.pending.delete(item.id);
    const errors = z.errors.get(item.id);
    if (errors?.[col]) {
        delete errors[col];
        if (!Object.keys(errors).length) z.errors.delete(item.id);
    }
}

/** @returns items in the order shown: folders first, then files, each filtered and sorted */
export function itemsShown(z: Zen): ZenItem[] {
    const items = z.data?.items ?? [];
    const idx = shownRows(
        items.length,
        (i, col: string) => cellText(z, items[i], col),
        z.filters,
        z.sort,
        (i, col: string) => sortKey(z, items[i], col),
    );
    return [...idx.filter((i) => items[i].folder), ...idx.filter((i) => !items[i].folder)].map((i) => items[i]);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function headHtml(z: Zen, cols: string[]): string {
    const th = (col: string, title: string, cls: string) => {
        const sort = z.sort?.col === col ? (z.sort.dir > 0 ? ' ▲' : ' ▼') : '';
        const on = z.filters.has(col) ? ' tp-on' : '';
        const move = col === NAME ? '' : ' tp-movable';
        return (
            `<th data-col="${esc(col)}" class="${cls}${move}" title="${esc(title)}">` +
            `<span class="tp-sort">${esc(title)}${sort}</span>` +
            `<button class="tp-filter${on}" data-col="${esc(col)}" title="Filter">▾</button>` +
            `<span class="tp-resize" data-col="${esc(col)}" title="Drag to change the width"></span></th>`
        );
    };
    const titles = new Map((z.data?.fields ?? []).map((f) => [f.name, f.title]));
    const cells = cols.map((c) => th(c, titles.get(c) ?? c, fieldOf(z, c)?.editable ? 'tp-zen-editable' : ''));
    return `<thead><tr>${th(NAME, 'Name', 'tp-zen-name')}${cells.join('')}</tr></thead>`;
}

function cellHtml(z: Zen, item: ZenItem, col: string): string {
    const field = fieldOf(z, col);
    const value = cellValue(z, item, col);
    const changed = z.pending.get(item.id)?.[col] !== undefined;
    const error = z.errors.get(item.id)?.[col];
    const cls = [changed ? 'tp-zen-changed' : '', error ? 'tp-zen-error' : ''];
    const isName = col === NAME;
    const editable = z.editing && (isName || !!field?.editable);
    if (z.editing && !editable) cls.push('tp-zen-ro');
    let inner: string;
    if (editable && field?.type === 'Boolean') {
        inner = `<input type="checkbox" class="tp-zen-input"${value === '1' ? ' checked' : ''}>`;
    } else if (editable && field?.type === 'Choice') {
        const choices = field.choices.includes(value) || !value ? field.choices : [value, ...field.choices];
        const options = ['', ...choices]
            .map((c) => `<option${c === value ? ' selected' : ''}>${esc(c)}</option>`)
            .join('');
        inner = `<select class="tp-zen-input">${options}</select>`;
    } else {
        const edit = editable ? ' contenteditable="plaintext-only" spellcheck="false"' : '';
        inner = `<span class="tp-zen-text"${edit}>${esc(cellText(z, item, col))}</span>`;
    }
    if (isName) inner = `<span class="tp-zen-icon">${item.folder ? FOLDER_SVG : FILE_SVG}</span>${inner}`;
    const shown = cellText(z, item, col);
    const tip = error ? `${error}\n\n${shown}` : shown;
    const title = tip.length > MAX_CELL_TITLE ? `${tip.slice(0, MAX_CELL_TITLE)} …` : tip;
    const name = isName ? 'tp-zen-name ' : '';
    return `<td data-col="${esc(col)}" class="${name}${cls.filter(Boolean).join(' ')}" title="${esc(title)}">${inner}</td>`;
}

function rowHtml(z: Zen, item: ZenItem, pos: number, cols: string[], shown: string | null): string {
    const cls = [
        'tp-zen-row',
        pos % 2 ? 'tp-stripe' : '',
        item.folder ? 'tp-zen-folder' : '',
        shown && item.path.toLowerCase() === shown ? 'tp-zen-shown' : '',
    ];
    const cells = [NAME, ...cols].map((c) => cellHtml(z, item, c)).join('');
    return `<tr data-id="${item.id}" class="${cls.filter(Boolean).join(' ')}">${cells}</tr>`;
}

/** Widths of the columns (name and each one shown): kept, else as the browser lays them out */
function widthCss(z: Zen, cols: string[]): string {
    return [NAME, ...cols]
        .map((c, i) => {
            const w = z.columns.widths[c];
            return w
                ? `.tp-zen-table tr > :nth-child(${i + 1}) { width: ${w}px; min-width: ${w}px; max-width: ${w}px; }`
                : '';
        })
        .join('\n');
}

/**
 * Draws the list anew (scroll position kept).
 * @param shown server-relative path of the file in the viewer (row marked), or null
 */
export function drawGrid(z: Zen, shown: string | null): void {
    observers.get(z)?.disconnect();
    closeFilterPanel();
    const grid = z.grid;
    if (!z.data) return void grid.replaceChildren();
    const { scrollTop, scrollLeft } = grid;
    const cols = shownColumns(z);
    const items = itemsShown(z);
    const table = document.createElement('table');
    table.className = 'tp-table tp-zen-table'; // edit mode: marked on the list (.tp-zen-editing)
    table.innerHTML = headHtml(z, cols);
    const style = document.createElement('style');
    style.textContent = widthCss(z, cols);
    const lower = shown?.toLowerCase() ?? null;
    const blocks: HTMLElement[] = [];
    const spacer = (h: number) =>
        `<tr class="tp-spacer"><td colspan="${cols.length + 1}" style="height:${h}px"></td></tr>`;
    for (let from = 0; from < items.length; from += CHUNK_LINES) {
        const body = document.createElement('tbody');
        body.dataset.from = String(from);
        body.dataset.count = String(Math.min(CHUNK_LINES, items.length - from));
        body.innerHTML = spacer(Number(body.dataset.count) * ROW_HEIGHT);
        table.append(body);
        blocks.push(body);
    }
    const fill = (b: HTMLElement) => {
        if (b.dataset.on) return;
        const from = Number(b.dataset.from);
        b.innerHTML = items
            .slice(from, from + Number(b.dataset.count))
            .map((item, k) => rowHtml(z, item, from + k, cols, lower))
            .join('');
        b.dataset.on = '1';
    };
    const empty = (b: HTMLElement) => {
        if (!b.dataset.on || b.contains(document.activeElement)) return; // keep cell being edited
        b.innerHTML = spacer(b.getBoundingClientRect().height);
        delete b.dataset.on;
    };
    const note = items.length
        ? ''
        : `<div class="tp-zen-empty">${z.data.items.length ? 'No items match the filters.' : 'This folder is empty.'}</div>`;
    grid.replaceChildren(table, style);
    if (note) grid.insertAdjacentHTML('beforeend', note);
    if (blocks[0]) fill(blocks[0]); // first rows at once (no empty frame)
    observers.set(z, watchBlocks(grid, blocks, fill, empty));
    grid.scrollTop = scrollTop;
    grid.scrollLeft = scrollLeft;
}

/** Marks the row of the file in the viewer (no redraw) */
export function markShown(z: Zen, shown: string | null): void {
    const lower = shown?.toLowerCase();
    for (const tr of z.grid.querySelectorAll('tr.tp-zen-row')) {
        const item = itemOf(z, tr as HTMLElement);
        tr.classList.toggle('tp-zen-shown', !!item && !!lower && item.path.toLowerCase() === lower);
    }
}

/** Stops watching the rows (list closed) */
export function stopGrid(z: Zen): void {
    observers.get(z)?.disconnect();
    closeFilterPanel();
}

// ---------------------------------------------------------------------------
// Events (once per Zen list; state read when they happen)
// ---------------------------------------------------------------------------

/** @returns item of a row (or of a cell's row) */
export function itemOf(z: Zen, el: HTMLElement): ZenItem | undefined {
    const id = Number((el.closest('tr[data-id]') as HTMLElement | null)?.dataset.id);
    return z.data?.items.find((x) => x.id === id);
}

/**
 * @param redraw draws the list anew
 * @param open item clicked (read mode)
 * @param edited a value changed (edit mode)
 */
export function wireGrid(
    z: Zen,
    { redraw, open, edited }: { redraw: () => void; open: (item: ZenItem) => void; edited: () => void },
): void {
    const grid = z.grid;
    const colOf = (el: Element | null) => (el as HTMLElement | null)?.dataset.col ?? '';

    grid.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('.tp-resize')) return;
        const filter = t.closest('.tp-filter') as HTMLElement | null;
        if (filter) {
            const col = colOf(filter);
            const items = z.data?.items ?? [];
            return void openFilterPanel(
                grid,
                filter,
                items.map((x) => cellText(z, x, col)),
                z.filters.get(col),
                (f) => {
                    if (f) z.filters.set(col, f);
                    else z.filters.delete(col);
                    redraw();
                },
            );
        }
        const th = t.closest('th[data-col]');
        if (th) {
            z.sort = nextSort(z.sort, colOf(th));
            return void redraw();
        }
        if (z.editing) return; // cells are edited, rows not opened
        const item = itemOf(z, t);
        if (item) open(item);
    });

    // Edits: text (as typed), yes / no and choices (as chosen); Enter ends the cell (Shift+Enter: new line)
    const record = (el: HTMLElement) => {
        const td = el.closest('td[data-col]') as HTMLElement | null;
        const item = td && itemOf(z, td);
        if (!td || !item) return;
        const col = colOf(td);
        const value =
            el instanceof HTMLInputElement
                ? el.checked
                    ? '1'
                    : '0'
                : el instanceof HTMLSelectElement
                  ? el.value
                  : (el.textContent ?? '');
        setValue(z, item, col, value);
        td.classList.toggle('tp-zen-changed', z.pending.get(item.id)?.[col] !== undefined);
        td.classList.remove('tp-zen-error');
        edited();
    };
    grid.addEventListener('input', (e) => {
        const t = e.target as HTMLElement;
        if (t.classList.contains('tp-zen-text')) record(t);
    });
    grid.addEventListener('change', (e) => {
        const t = e.target as HTMLElement;
        if (t.classList.contains('tp-zen-input')) record(t);
    });
    grid.addEventListener('keydown', (e) => {
        const t = e.target as HTMLElement;
        if (e.key === 'Enter' && !e.shiftKey && t.classList.contains('tp-zen-text')) {
            e.preventDefault();
            t.blur();
        }
    });

    // Widths: drag the lower right edge of a column title
    grid.addEventListener('pointerdown', (e) => {
        const handle = (e.target as HTMLElement).closest('.tp-resize') as HTMLElement | null;
        if (!handle || !z.data) return;
        e.preventDefault();
        e.stopPropagation();
        const col = colOf(handle);
        const th = handle.parentElement as HTMLElement;
        const startX = e.clientX;
        const startW = th.getBoundingClientRect().width;
        const style = grid.querySelector('style') as HTMLStyleElement | null;
        handle.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
            const min = col === NAME ? MIN_NAME_WIDTH : MIN_WIDTH;
            z.columns.widths[col] = Math.max(min, Math.round(startW + ev.clientX - startX));
            if (style) style.textContent = widthCss(z, shownColumns(z));
        };
        const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            if (z.data) saveColumns(z.data.library, z.columns);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    });

    // Order: drag a column title onto another (the name stays first)
    wireReorder(grid, {
        item: 'th[data-col]',
        axis: 'x',
        skip: '.tp-filter, .tp-resize',
        movable: (col) => col !== NAME,
        drop: (col, target, after) => {
            if (!z.data) return;
            const { order, hidden } = columnOrder(z.data, z.columns);
            const shown = order.filter((n) => !hidden.has(n));
            const at = shown.indexOf(target) + (after ? 1 : 0);
            setColumns(z, moveColumn(order, col, shown[at] ?? null), hidden);
            redraw();
        },
    });
}
