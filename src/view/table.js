// Table view: CSV parsing, rendering, sorting, filters, editing

// ===========================================================================
// IMPORTS
// ===========================================================================

import { esc } from '../_core/util.js';
import { CSV_COLOURS } from '../text/highlight/csv.js';
import { BIN_SVG } from '../ui/icons.js';
import { CHUNK_LINES } from './lines.js';
import { watchBlocks } from './lines.js';

/** @typedef {import('../_core/types.js').LineView} LineView */
/** @typedef {import('../_core/types.js').TableState} TableState */
/** @typedef {import('../_core/types.js').CsvRow} CsvRow */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Quote styles as in Python's csv module ('none' can break file)
/** @type {Object<string, string>} */
export const QUOTE_MODES = {
    minimal: 'Quotes: only when needed',
    all: 'Quotes: all cells',
    nonnumeric: 'Quotes: all but numbers',
    none: 'Quotes: none',
};
const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

// ===========================================================================
// METHODS
// ===========================================================================

// CSV text -> rows of cells; row.raw keeps original text for unedited rows
/** @param {string} text @param {string} sep @returns {CsvRow[]} */
export function parseCsv(text, sep) {
    /** @type {CsvRow[]} */
    const rows = [];
    /** @type {CsvRow} */
    let row = [];
    let cell = '';
    let quoted = false;
    let start = 0;
    /** @param {number} end */
    const endRow = (end) => {
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
/** @param {string} value @param {string} sep @param {string} [mode] @returns {string} */
function csvQuote(value, sep, mode = 'minimal') {
    const quoted = `"${value.replace(/"/g, '""')}"`;
    if (mode === 'none') return value;
    if (mode === 'all') return quoted;
    if (mode === 'nonnumeric' && !NUMBER_RE.test(value.trim())) return quoted;
    const spaces = sep.startsWith(' ') && /^ | $/.test(value); // would blur into delimiter
    return value.includes(sep) || spaces || /["\r\n]/.test(value) ? quoted : value;
}

// Table view: fixed header and row numbers, sort, ▾ filter; opts.editable for CSV write mode
/**
 * @param {HTMLElement} content @param {string[]} header @param {CsvRow[]} rows
 * @param {{ state: TableState,
 *   editable?: boolean, onEdit?: () => void, sep?: string, colour?: boolean, format?: { sep: string, quote: string }|null,
 *   classOf?: (c: number, value: string) => string }} opts classOf: own colours per cell (with colour on)
 * @returns {LineView & { csvText: () => string }}
 */
export function mountTable(content, header, rows, opts) {
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
    /** @type {IntersectionObserver|null} */
    let io = null;

    // Rows to show: filtered, then sorted (indexes into rows)
    const viewRows = () => {
        let idx = rows.map((_, i) => i);
        for (const [c, f] of state.filters) {
            const text = f.text.toLowerCase();
            idx = idx.filter((i) => {
                const v = rows[i][c] ?? '';
                return (!f.values || f.values.has(v)) && (!text || v.toLowerCase().includes(text));
            });
        }
        if (state.sort) {
            const { col, dir } = state.sort;
            const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
            idx.sort((a, b) => dir * cmp.compare(rows[a][col] ?? '', rows[b][col] ?? '') || a - b);
        }
        return idx;
    };

    const headHtml = () => {
        let cells = '<th class="tp-rn"></th>';
        const drag = opts.editable ? ' draggable="true"' : '';
        for (let c = 0; c < cols; c++) {
            const sort = state.sort && state.sort.col === c ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '';
            const active = state.filters.has(c) ? ' tp-on' : '';
            const bin = opts.editable
                ? `<button class="tp-col-delete" data-c="${c}" draggable="false" title="Delete this column">${BIN_SVG}</button>`
                : '';
            const line =
                opts.colour && !opts.classOf
                    ? ` style="border-bottom-color: var(--tp-${CSV_COLOURS[c % CSV_COLOURS.length]})"`
                    : '';
            cells +=
                `<th data-c="${c}"${drag}${line}><span class="tp-sort">${esc(header[c] ?? '')}${sort}</span>` +
                `<button class="tp-filter${active}" data-c="${c}" title="Filter">▾</button>${bin}` +
                `<span class="tp-resize" data-c="${c}" title="Drag to change the width"></span></th>`;
        }
        return `<thead><tr>${cells}</tr></thead>`;
    };

    /** @param {number} c @param {string} value */
    const colourOf = (c, value) => {
        if (!opts.colour) return '';
        const cls = opts.classOf ? opts.classOf(c, value) : CSV_COLOURS[c % CSV_COLOURS.length];
        return cls ? ` class="tp-${cls}"` : '';
    };
    /** @param {number} i @param {number} pos */
    const rowHtml = (i, pos) => {
        const r = rows[i];
        const edit = opts.editable ? ' contenteditable="plaintext-only"' : '';
        let cells = '';
        for (let c = 0; c < cols; c++) {
            const t = esc(r[c] ?? '');
            cells += `<td data-r="${i}" data-c="${c}"${colourOf(c, r[c] ?? '')} title="${t}"${edit}>${t}</td>`;
        }
        const drag = opts.editable ? ' draggable="true" title="Drag to move this row"' : '';
        return `<tr${pos % 2 ? ' class="tp-stripe"' : ''}><td class="tp-rn" data-row="${i}"${drag}>${(i + 1).toLocaleString()}</td>${cells}</tr>`;
    };

    // Structure edits use file's order (sort and filters off first)
    /** @param {Array<*>} list @param {number} from @param {number} to */
    const moveItem = (list, from, to) => {
        const [item] = list.splice(from, 1);
        list.splice(to > from ? to - 1 : to, 0, item);
    };
    /** @param {string} act @param {number} at @param {number} [to] */
    const structure = (act, at, to) => {
        state.sort = null;
        state.filters.clear();
        if (act.startsWith('col-')) widths.clear(); // columns shift: widths start fresh
        if (act === 'row-insert') {
            rows.splice(at, 0, new Array(cols).fill(''));
        } else if (act === 'row-move') {
            if (at === to || at + 1 === to) return;
            moveItem(rows, at, /** @type {number} */ (to)); // moves come with their target
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
                moveItem(r, at, /** @type {number} */ (to));
            }
            allEdited = true;
        }
        build();
        opts.onEdit?.();
    };

    const ROW_HEIGHT = 23 * (Number(content.style?.getPropertyValue?.('--tp-zoom')) || 1); // text size (panel)
    /** @param {number} h */
    const spacer = (h) => `<tr class="tp-spacer"><td colspan="${cols + 1}" style="height:${h}px"></td></tr>`;

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
        /** @param {HTMLElement} b */
        const fill = (b) => {
            if (b.dataset.on) return;
            b.innerHTML = view
                .slice(Number(b.dataset.from), Number(b.dataset.from) + Number(b.dataset.count))
                .map((i, k) => rowHtml(i, Number(b.dataset.from) + k))
                .join('');
            b.dataset.on = '1';
        };
        /** @param {HTMLElement} b */
        const empty = (b) => {
            if (!b.dataset.on || b.contains(document.activeElement)) return; // keep cell being edited
            b.innerHTML = spacer(b.getBoundingClientRect().height);
            delete b.dataset.on;
        };
        io = watchBlocks(content, blocks, fill, empty);
    };

    // Sort: click column title
    table.addEventListener('click', (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('.tp-resize')) return; // end of width change, not sort
        const del = /** @type {HTMLElement} */ (e.target).closest('.tp-col-delete');
        if (del) return void structure('col-delete', Number(del.dataset.c));
        const btn = /** @type {HTMLElement} */ (e.target).closest('.tp-filter');
        if (btn) return void openFilter(btn, Number(btn.dataset.c));
        const th = /** @type {HTMLElement} */ (e.target).closest('th[data-c]');
        if (!th) return;
        const col = Number(th.dataset.c);
        const s = state.sort;
        state.sort = !s || s.col !== col ? { col, dir: 1 } : s.dir > 0 ? { col, dir: -1 } : null;
        build();
    });

    // Filter panel: unique values with checkboxes, plus "contains" text field
    /** @type {HTMLElement|null} */
    let panel = null;
    const closePanel = () => {
        panel?.remove();
        panel = null;
        document.removeEventListener('pointerdown', outside, true);
    };
    /** @param {Event} e */
    const outside = (e) => {
        if (
            panel &&
            !panel.contains(/** @type {Node} */ (e.target)) &&
            !(/** @type {HTMLElement} */ (e.target).closest('.tp-filter'))
        )
            closePanel();
    };
    /** @param {HTMLElement} btn @param {number} c */
    const openFilter = (btn, c) => {
        closePanel();
        const f = state.filters.get(c) || { values: null, text: '' };
        const counts = new Map();
        for (const r of rows) counts.set(r[c] ?? '', (counts.get(r[c] ?? '') || 0) + 1);
        const cmp = new Intl.Collator(undefined, { numeric: true }).compare;
        const values = [...counts.keys()].sort(cmp).slice(0, 1000);
        panel = document.createElement('div');
        panel.className = 'tp-filter-panel';
        const items = values
            .map(
                (val, i) => `
        <label><input type="checkbox" data-i="${i}"${!f.values || f.values.has(val) ? ' checked' : ''}>
        ${esc(val || '(empty)')} <span>${counts.get(val)}</span></label>`,
            )
            .join('');
        const more =
            counts.size > values.length ? `<small>first ${values.length} of ${counts.size} values</small>` : '';
        panel.innerHTML = `
      <input type="text" placeholder="contains …" value="${esc(f.text)}">
      <label><input type="checkbox" data-all> <em>all</em></label>
      <div class="tp-filter-list">${items}
      </div>
      ${more}
    `;
        const r = btn.getBoundingClientRect();
        const box = content.getBoundingClientRect();
        panel.style.left = `${Math.max(0, Math.min(r.left - box.left, box.width - 240))}px`;
        panel.style.top = `${r.bottom - box.top + 2}px`;
        /** @type {HTMLElement} */ (content.parentElement).append(panel); // content sits in the viewer
        document.addEventListener('pointerdown', outside, true);

        const boxes = /** @type {HTMLInputElement[]} */ ([...panel.querySelectorAll('[data-i]')]); // checkboxes
        const all = /** @type {HTMLInputElement} */ (panel.querySelector('[data-all]')); // in the panel's HTML above
        const input = /** @type {HTMLInputElement} */ (panel.querySelector('input[type="text"]'));
        all.checked = boxes.every((b) => b.checked);
        const apply = () => {
            const checked = boxes.filter((b) => b.checked).map((b) => values[Number(b.dataset.i)]);
            const everything = checked.length === values.length;
            const nf = { values: everything ? null : new Set(checked), text: input.value };
            if (!nf.values && !nf.text) state.filters.delete(c);
            else state.filters.set(c, nf);
            build();
        };
        all.onchange = () => {
            for (const b of boxes) b.checked = all.checked;
            apply();
        };
        /** @type {HTMLElement} */ (panel.querySelector('.tp-filter-list')).onchange = () => {
            all.checked = boxes.every((b) => b.checked);
            apply();
        };
        input.oninput = () => {
            const t = input.value.toLowerCase();
            for (const b of boxes) {
                /** @type {HTMLElement} */ (b.parentElement).style.display = values[Number(b.dataset.i)]
                    .toLowerCase()
                    .includes(t)
                    ? ''
                    : 'none';
            }
            apply();
        };
        input.focus();
    };

    // Write mode: drag row numbers / column titles to move; "+" at edges to insert
    if (opts.editable) {
        /** @type {{ kind: 'row'|'col', from: number }|null} */
        let dragging = null; // { kind: 'row'|'col', from }
        /** @param {DragEvent} e */
        const dropTarget = (e) => {
            if (!dragging) return null;
            const el =
                dragging.kind === 'row'
                    ? /** @type {HTMLElement} */ (e.target).closest('td.tp-rn[data-row]')
                    : /** @type {HTMLElement} */ (e.target).closest('th[data-c]');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const i = dragging.kind === 'row' ? Number(el.dataset.row) : Number(el.dataset.c);
            const after = dragging.kind === 'row' ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
            return { el, to: after ? i + 1 : i, after };
        };
        const clearMarks = () => {
            for (const el of table.querySelectorAll('.tp-drop-before, .tp-drop-after')) {
                el.classList.remove('tp-drop-before', 'tp-drop-after');
            }
        };
        table.addEventListener('dragstart', (e) => {
            const rn = /** @type {HTMLElement} */ (e.target).closest?.('td.tp-rn[data-row]');
            const th = /** @type {HTMLElement} */ (e.target).closest?.('th[data-c]');
            if (!rn && !th) return;
            if (/** @type {HTMLElement} */ (e.target).closest?.('.tp-col-delete, .tp-filter, .tp-resize'))
                return void e.preventDefault();
            dragging = rn
                ? { kind: 'row', from: Number(rn.dataset.row) }
                : { kind: 'col', from: Number(/** @type {HTMLElement} */ (th).dataset.c) };
            const transfer = /** @type {DataTransfer} */ (e.dataTransfer); // always set on dragstart
            transfer.effectAllowed = 'move';
            transfer.setData('text/x-tp-move', '1');
            e.stopPropagation();
        });
        table.addEventListener('dragover', (e) => {
            const t = dropTarget(e);
            if (!t) return;
            e.preventDefault();
            e.stopPropagation();
            clearMarks();
            t.el.classList.add(t.after ? 'tp-drop-after' : 'tp-drop-before');
        });
        table.addEventListener('drop', (e) => {
            const t = dropTarget(e);
            clearMarks();
            if (!t) return;
            e.preventDefault();
            e.stopPropagation();
            const { kind, from } = /** @type {{ kind: 'row'|'col', from: number }} */ (dragging); // drop target found: dragging
            dragging = null;
            structure(kind === 'row' ? 'row-move' : 'col-move', from, t.to);
        });
        table.addEventListener('dragend', () => {
            dragging = null;
            clearMarks();
        });

        const plus = document.createElement('button');
        plus.className = 'tp-plus';
        plus.textContent = '+';
        plus.hidden = true;
        /** @type {{ kind: 'row'|'col', at: number }|null} */
        let plusAt = null;
        const EDGE = 6; // px from line that count as "on line"
        /** @param {'row'|'col'} kind @param {number} at @param {number} x @param {number} y */
        const showPlus = (kind, at, x, y) => {
            const box = content.getBoundingClientRect();
            plus.style.left = `${x - box.left + content.scrollLeft - 8}px`;
            plus.style.top = `${y - box.top + content.scrollTop - 8}px`;
            plus.title = kind === 'row' ? 'Insert a row here' : 'Insert a column here';
            plus.hidden = false;
            plusAt = { kind, at };
        };
        table.addEventListener('mousemove', (e) => {
            if (dragging) return;
            const rn = /** @type {HTMLElement} */ (e.target).closest('td.tp-rn[data-row]');
            const corner = /** @type {HTMLElement} */ (e.target).closest('th.tp-rn');
            const th = /** @type {HTMLElement} */ (e.target).closest('th[data-c]');
            if (rn || corner) {
                const r = /** @type {HTMLElement} */ (rn || corner).getBoundingClientRect();
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
            const td = /** @type {HTMLElement} */ (e.target).closest('td[data-r]');
            if (!td) return;
            const i = Number(td.dataset.r);
            while (rows[i].length < cols) rows[i].push('');
            rows[i][Number(td.dataset.c)] = td.textContent;
            edited.add(rows[i]);
            opts.onEdit?.();
        });
        table.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && /** @type {HTMLElement} */ (e.target).closest('td[data-r]')) {
                e.preventDefault();
                /** @type {HTMLElement} */ (e.target).blur();
            }
        });
    }

    const extras = [...content.querySelectorAll(':scope > .tp-plus')];
    content.replaceChildren(table, widthStyle, ...extras);
    applyWidths();
    build();

    // Column widths: drag lower right edge of title (upper part has "+")
    table.addEventListener('pointerdown', (e) => {
        const handle = /** @type {HTMLElement} */ (e.target).closest('.tp-resize');
        if (!handle) return;
        e.preventDefault();
        e.stopPropagation();
        const c = Number(handle.dataset.c);
        const startX = e.clientX;
        const startW = /** @type {HTMLElement} */ (handle.parentElement).getBoundingClientRect().width;
        handle.setPointerCapture(e.pointerId);
        /** @param {PointerEvent} ev */
        const move = (ev) => {
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
            closePanel();
        },
        show: () => {},
        // As CSV: edited rows rewritten, others as before (all with chosen format)
        csvText: () => {
            const sep = /** @type {string} */ (opts.format?.sep || opts.sep); // tables in write mode come with their delimiter
            const quote = opts.format?.quote || 'minimal';
            const all = allEdited || !!opts.format?.sep || !!opts.format?.quote;
            return [header, ...rows]
                .map((r) =>
                    all || edited.has(r) || /** @type {CsvRow} */ (r).raw === undefined
                        ? r.map((v) => csvQuote(v ?? '', sep, quote)).join(sep)
                        : /** @type {string} */ (/** @type {CsvRow} */ (r).raw),
                )
                .join('\n');
        },
    };
}
