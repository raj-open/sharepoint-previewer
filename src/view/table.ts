// Table view: CSV parsing, rendering, sorting, filters, editing

// ===========================================================================
// IMPORTS
// ===========================================================================

import { esc } from '../_core/util.ts';
import { CSV_COLOURS } from '../text/highlight/csv.ts';
import { BIN_SVG } from '../ui/icons.ts';
import { CHUNK_LINES } from './lines.ts';
import { watchBlocks } from './lines.ts';
import { closeFilterPanel } from './filter.ts';
import { nextSort } from './filter.ts';
import { openFilterPanel } from './filter.ts';
import { shownRows } from './filter.ts';
import { wireReorder } from './reorder.ts';

import type { LineView } from '../_core/types.ts';
import type { TableState } from '../_core/types.ts';
import type { CsvRow } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Quote styles as in Python's csv module ('none' can break file)
export const QUOTE_MODES: Record<string, string> = {
    minimal: 'Quotes: only when needed',
    all: 'Quotes: all cells',
    nonnumeric: 'Quotes: all but numbers',
    none: 'Quotes: none',
};
const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const MAX_TITLE = 2000; // characters of a cell's tooltip

// ===========================================================================
// METHODS
// ===========================================================================

// CSV text -> rows of cells; row.raw keeps original text for unedited rows
export function parseCsv(text: string, sep: string): CsvRow[] {
    const rows: CsvRow[] = [];
    let row: CsvRow = [];
    let cell = '';
    let quoted = false;
    let start = 0;
    const endRow = (end: number) => {
        row.push(cell);
        row.raw = text.slice(start, end);
        rows.push(row);
        row = [];
        cell = '';
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') cell += text[++i];
                else quoted = false;
            } else cell += c;
        } else if (c === '"') quoted = true;
        else if (c === sep[0] && text.startsWith(sep, i)) {
            row.push(cell);
            cell = '';
            i += sep.length - 1;
        } else if (c === '\n' || c === '\r') {
            const end = i;
            if (c === '\r' && text[i + 1] === '\n') i++;
            endRow(end);
            start = i + 1;
        } else cell += c;
    }
    if (cell || row.length || start < text.length) endRow(text.length);
    return rows;
}

// One CSV cell, quoted as quote style says
function csvQuote(value: string, sep: string, mode = 'minimal'): string {
    const quoted = `"${value.replace(/"/g, '""')}"`;
    if (mode === 'none') return value;
    if (mode === 'all') return quoted;
    if (mode === 'nonnumeric' && !NUMBER_RE.test(value.trim())) return quoted;
    const spaces = sep.startsWith(' ') && /^ | $/.test(value); // would blur into delimiter
    return value.includes(sep) || spaces || /["\r\n]/.test(value) ? quoted : value;
}

// Table view: fixed header and row numbers, sort, ▾ filter; opts.editable for CSV write mode
/**
 * @param opts classOf: own colours per cell (with colour on);
 *   expand: rows that open a detail row below them (▸ in the row number)
 */
export function mountTable(
    content: HTMLElement,
    header: string[],
    rows: CsvRow[],
    opts: {
        state: TableState;
        editable?: boolean;
        onEdit?: () => void;
        sep?: string;
        colour?: boolean;
        format?: { sep: string; quote: string } | null;
        classOf?: (c: number, value: string) => string;
        expand?: { can: (i: number) => boolean; html: (i: number) => string; title: string };
    },
): LineView & { csvText: () => string } {
    const { state } = opts;
    for (const n of content.querySelectorAll(':scope > .tp-plus, :scope > .tp-col-widths')) n.remove(); // earlier table
    if (!state.widths) state.widths = new Map(); // column -> width in px (column edge drag)
    const widths = state.widths;
    const widthStyle = document.createElement('style');
    widthStyle.className = 'tp-col-widths';
    const tableId = Math.random().toString(36).slice(2);
    const applyWidths = () => {
        widthStyle.textContent = [...widths]
            .map(
                ([c, w]) =>
                    `.tp-table[data-tid="${tableId}"] tr > :nth-child(${c + 2}) { width: ${w}px; min-width: ${w}px; max-width: ${w}px; }`,
            )
            .join('\n');
    };
    let cols = Math.max(header.length, ...rows.slice(0, 1000).map((r) => r.length));
    const edited = new Set(); // edited rows (row arrays themselves, so moves keep track)
    let allEdited = false; // columns added / moved: every line is written anew
    const table = document.createElement('table');
    table.className = opts.editable ? 'tp-table tp-editing' : 'tp-table';
    table.dataset.tid = tableId;
    let io: IntersectionObserver | null = null;

    // Rows to show: filtered, then sorted (indexes into rows)
    const viewRows = () => shownRows(rows.length, (i, c: number) => rows[i][c] ?? '', state.filters, state.sort);

    const headHtml = () => {
        const all = opts.expand
            ? `<button class="tp-expand-all" title="${state.allOpen ? 'Collapse all rows shown' : 'Expand all rows shown (as filtered)'}">${state.allOpen ? '▾' : '▸'}</button>`
            : '';
        let cells = `<th class="tp-rn">${all}</th>`;
        for (let c = 0; c < cols; c++) {
            const sort = state.sort && state.sort.col === c ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '';
            const active = state.filters.has(c) ? ' tp-on' : '';
            const bin = opts.editable
                ? `<button class="tp-col-delete" data-c="${c}" title="Delete this column">${BIN_SVG}</button>`
                : '';
            const line =
                opts.colour && !opts.classOf
                    ? ` style="border-bottom-color: var(--tp-${CSV_COLOURS[c % CSV_COLOURS.length]})"`
                    : '';
            cells +=
                `<th data-c="${c}"${line}><span class="tp-sort">${esc(header[c] ?? '')}${sort}</span>` +
                `<button class="tp-filter${active}" data-c="${c}" title="Filter">▾</button>${bin}` +
                `<span class="tp-resize" data-c="${c}" title="Drag to change the width"></span></th>`;
        }
        return `<thead><tr>${cells}</tr></thead>`;
    };

    const colourOf = (c: number, value: string) => {
        if (!opts.colour) return '';
        const cls = opts.classOf ? opts.classOf(c, value) : CSV_COLOURS[c % CSV_COLOURS.length];
        return cls ? ` class="tp-${cls}"` : '';
    };
    const rowHtml = (i: number, pos: number) => {
        const r = rows[i];
        const edit = opts.editable ? ' contenteditable="plaintext-only"' : '';
        let cells = '';
        for (let c = 0; c < cols; c++) {
            const t = esc(r[c] ?? '');
            const title = t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE)} …` : t; // long cells: tooltip shortened
            cells += `<td data-r="${i}" data-c="${c}"${colourOf(c, r[c] ?? '')} title="${title}"${edit}>${t}</td>`;
        }
        const tip = opts.editable ? ' title="Drag to move this row"' : '';
        const open = !!state.expanded?.has(i);
        const toggle = opts.expand?.can(i) ? toggleHtml(i, open) : '';
        const row =
            `<tr${pos % 2 ? ' class="tp-stripe"' : ''}><td class="tp-rn" data-row="${i}"${tip}>` +
            `${toggle}${(i + 1).toLocaleString()}</td>${cells}</tr>`;
        return open ? row + detailHtml(i) : row;
    };

    // Detail rows (expand): ▸ / ▾ in the row number, detail below the row; open ones kept in state
    const toggleHtml = (i: number, open: boolean) =>
        `<button class="tp-expand" data-x="${i}" title="${open ? 'Collapse' : esc(opts.expand?.title ?? '')}">${open ? '▾' : '▸'}</button>`;
    const detailHtml = (i: number) =>
        `<tr class="tp-detail"><td class="tp-rn"></td><td colspan="${cols}"><div class="tp-detail-box">` +
        `${opts.expand?.html(i) ?? ''}</div></td></tr>`;
    // All rows shown (filters applied) open or closed at once
    const toggleAll = () => {
        if (!state.expanded) state.expanded = new Set();
        const shown = viewRows().filter((i) => opts.expand?.can(i));
        state.allOpen = !state.allOpen;
        for (const i of shown) state.allOpen ? state.expanded.add(i) : state.expanded.delete(i);
        build();
    };
    const toggleDetail = (btn: HTMLElement) => {
        const i = Number(btn.dataset.x);
        const tr = btn.closest('tr') as HTMLElement;
        if (!state.expanded) state.expanded = new Set();
        const open = !state.expanded.has(i);
        if (open) {
            state.expanded.add(i);
            tr.insertAdjacentHTML('afterend', detailHtml(i));
        } else {
            state.expanded.delete(i);
            if (tr.nextElementSibling?.classList.contains('tp-detail')) tr.nextElementSibling.remove();
        }
        btn.outerHTML = toggleHtml(i, open);
    };

    // Structure edits use file's order (sort and filters off first)
    const moveItem = <T>(list: T[], from: number, to: number) => {
        const [item] = list.splice(from, 1);
        list.splice(to > from ? to - 1 : to, 0, item);
    };
    const structure = (act: string, at: number, to?: number) => {
        state.sort = null;
        state.filters.clear();
        if (act.startsWith('col-')) widths.clear(); // columns shift: widths start fresh
        if (act === 'row-insert') {
            rows.splice(at, 0, new Array(cols).fill(''));
        } else if (act === 'row-move') {
            if (at === to || at + 1 === to) return;
            moveItem(rows, at, to as number); // moves come with their target
        } else if (act === 'col-insert') {
            const name = prompt('Name of the new column:', '');
            if (name === null) return;
            for (const r of [header, ...rows]) {
                while (r.length < at) r.push('');
                r.splice(at, 0, r === header ? name : '');
            }
            cols++;
            allEdited = true;
        } else if (act === 'col-delete') {
            if (!confirm(`Delete the column "${header[at] ?? ''}" and its contents?`)) return;
            for (const r of [header, ...rows]) if (r.length > at) r.splice(at, 1);
            cols--;
            allEdited = true;
        } else if (act === 'col-move') {
            if (at === to || at + 1 === to) return;
            for (const r of [header, ...rows]) {
                while (r.length < cols) r.push('');
                moveItem(r, at, to as number);
            }
            allEdited = true;
        }
        build();
        opts.onEdit?.();
    };

    const ROW_HEIGHT = 23 * (Number(content.style?.getPropertyValue?.('--tp-zoom')) || 1); // text size (panel)
    const spacer = (h: number) => `<tr class="tp-spacer"><td colspan="${cols + 1}" style="height:${h}px"></td></tr>`;

    const build = () => {
        io?.disconnect();
        const view = viewRows();
        table.innerHTML = headHtml();
        const blocks = [];
        for (let from = 0; from < view.length; from += CHUNK_LINES) {
            const body = document.createElement('tbody');
            body.dataset.from = String(from);
            body.dataset.count = String(Math.min(CHUNK_LINES, view.length - from));
            body.innerHTML = spacer(Number(body.dataset.count) * ROW_HEIGHT);
            table.append(body);
            blocks.push(body);
        }
        const fill = (b: HTMLElement) => {
            if (b.dataset.on) return;
            b.innerHTML = view
                .slice(Number(b.dataset.from), Number(b.dataset.from) + Number(b.dataset.count))
                .map((i, k) => rowHtml(i, Number(b.dataset.from) + k))
                .join('');
            b.dataset.on = '1';
        };
        const empty = (b: HTMLElement) => {
            if (!b.dataset.on || b.contains(document.activeElement)) return; // keep cell being edited
            b.innerHTML = spacer(b.getBoundingClientRect().height);
            delete b.dataset.on;
        };
        io = watchBlocks(content, blocks, fill, empty);
    };

    // Sort: click column title
    table.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.tp-resize')) return; // end of width change, not sort
        const expand = (e.target as HTMLElement).closest('.tp-expand');
        if (expand) return void toggleDetail(expand as HTMLElement);
        if ((e.target as HTMLElement).closest('.tp-expand-all')) return void toggleAll();
        const del = (e.target as HTMLElement).closest('.tp-col-delete');
        if (del) return void structure('col-delete', Number(del.dataset.c));
        const btn = (e.target as HTMLElement).closest('.tp-filter');
        if (btn) return void openFilter(btn, Number(btn.dataset.c));
        const th = (e.target as HTMLElement).closest('th[data-c]');
        if (!th) return;
        state.sort = nextSort(state.sort, Number(th.dataset.c));
        build();
    });

    // Filter panel of a column (its values, "contains" text)
    const openFilter = (btn: HTMLElement, c: number) =>
        openFilterPanel(
            content,
            btn,
            rows.map((r) => r[c] ?? ''),
            state.filters.get(c),
            (f) => {
                if (f) state.filters.set(c, f);
                else state.filters.delete(c);
                build();
            },
        );

    // Write mode: row numbers / column titles dragged to move them; "+" at edges to insert
    if (opts.editable) {
        // as the Zen list's columns (pointer, no HTML drag and drop): a lifted copy, the target shaded, a bar where it goes
        const moveTo = (kind: 'row-move' | 'col-move') => (from: string, to: string, after: boolean) =>
            structure(kind, Number(from), Number(to) + (after ? 1 : 0));
        wireReorder(table, {
            item: 'th[data-c]',
            axis: 'x',
            key: (el) => el.dataset.c ?? '',
            skip: '.tp-col-delete, .tp-filter, .tp-resize',
            span: content,
            drop: moveTo('col-move'),
        });
        wireReorder(table, {
            item: 'td.tp-rn[data-row]',
            axis: 'y',
            key: (el) => el.dataset.row ?? '',
            span: content,
            drop: moveTo('row-move'),
        });

        const plus = document.createElement('button');
        plus.className = 'tp-plus';
        plus.textContent = '+';
        plus.hidden = true;
        let plusAt: { kind: 'row' | 'col'; at: number } | null = null;
        const EDGE = 6; // px from line that count as "on line"
        const showPlus = (kind: 'row' | 'col', at: number, x: number, y: number) => {
            const box = content.getBoundingClientRect();
            plus.style.left = `${x - box.left + content.scrollLeft - 8}px`;
            plus.style.top = `${y - box.top + content.scrollTop - 8}px`;
            plus.title = kind === 'row' ? 'Insert a row here' : 'Insert a column here';
            plus.hidden = false;
            plusAt = { kind, at };
        };
        table.addEventListener('mousemove', (e) => {
            if (table.classList.contains('tp-reordering')) return; // moving a row or column
            const rn = (e.target as HTMLElement).closest('td.tp-rn[data-row]');
            const corner = (e.target as HTMLElement).closest('th.tp-rn');
            const th = (e.target as HTMLElement).closest('th[data-c]');
            if (rn || corner) {
                const r = ((rn || corner) as HTMLElement).getBoundingClientRect();
                const i = rn ? Number(rn.dataset.row) : -1;
                if (rn && e.clientY - r.top < EDGE) return showPlus('row', i, r.left, r.top);
                if (r.bottom - e.clientY < EDGE) return showPlus('row', i + 1, r.left, r.bottom);
            } else if (th) {
                const r = th.getBoundingClientRect();
                const c = Number(th.dataset.c);
                const upper = e.clientY - r.top < r.height * 0.4; // lower part: width handle
                if (upper && e.clientX - r.left < EDGE) return showPlus('col', c, r.left, r.top + 6);
                if (upper && r.right - e.clientX < EDGE) return showPlus('col', c + 1, r.right, r.top + 6);
            }
            plus.hidden = true;
        });
        content.addEventListener('mouseleave', () => (plus.hidden = true));
        plus.onclick = () => {
            plus.hidden = true;
            if (plusAt) structure(plusAt.kind === 'row' ? 'row-insert' : 'col-insert', plusAt.at);
        };
        content.append(plus);
    }

    // Cell edits (CSV write mode)
    if (opts.editable) {
        table.addEventListener('input', (e) => {
            const td = (e.target as HTMLElement).closest('td[data-r]');
            if (!td) return;
            const i = Number(td.dataset.r);
            while (rows[i].length < cols) rows[i].push('');
            rows[i][Number(td.dataset.c)] = td.textContent;
            edited.add(rows[i]);
            opts.onEdit?.();
        });
        table.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).closest('td[data-r]')) {
                e.preventDefault();
                (e.target as HTMLElement).blur();
            }
        });
    }

    const extras = [...content.querySelectorAll(':scope > .tp-plus')];
    content.replaceChildren(table, widthStyle, ...extras);
    applyWidths();
    build();

    // Column widths: drag lower right edge of title (upper part has "+")
    table.addEventListener('pointerdown', (e) => {
        const handle = (e.target as HTMLElement).closest('.tp-resize');
        if (!handle) return;
        e.preventDefault();
        e.stopPropagation();
        const c = Number(handle.dataset.c);
        const startX = e.clientX;
        const startW = (handle.parentElement as HTMLElement).getBoundingClientRect().width;
        handle.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
            widths.set(c, Math.max(40, Math.round(startW + ev.clientX - startX)));
            applyWidths();
        };
        const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    });

    return {
        stop: () => {
            io?.disconnect();
            closeFilterPanel();
        },
        show: () => {},
        // As CSV: edited rows rewritten, others as before (all with chosen format)
        csvText: () => {
            const sep = (opts.format?.sep || opts.sep) as string; // tables in write mode come with their delimiter
            const quote = opts.format?.quote || 'minimal';
            const all = allEdited || !!opts.format?.sep || !!opts.format?.quote;
            return [header, ...rows]
                .map((r) =>
                    all || edited.has(r) || (r as CsvRow).raw === undefined
                        ? r.map((v) => csvQuote(v ?? '', sep, quote)).join(sep)
                        : ((r as CsvRow).raw as string),
                )
                .join('\n');
        },
    };
}
