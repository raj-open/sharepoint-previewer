// SharePoint list: eye per file row and in the header, current folder, clicks

// ===========================================================================
// IMPORTS
// ===========================================================================

import { EYE_CLOSED_SVG } from '../ui/icons.js';
import { EYE_FULL_SVG } from '../ui/icons.js';
import { EYE_HALF_SVG } from '../ui/icons.js';
import { memoryCache } from '../viewer/cache.js';
import { syncPanel } from '../viewer/layout.js';
import { openEmptyViewer } from '../viewer/open.js';
import { openPreview } from '../viewer/open.js';
import { pendingOpens } from '../viewer/open.js';
import { sameFile } from '../viewer/open.js';
import { viewer } from '../viewer/open.js';
import { COL_WIDTH } from './settings.js';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const NAME_SELECTORS = [
    '[data-automationid="FieldRenderer-name"]',
    '[data-automationid="field-LinkFilename"] button',
    '[data-automationid="field-LinkFilename"] a',
    '[data-automationid="field-LinkFilename"]',
].join(',');

// Single path segment with extension, e.g. "notes.txt"
const FILENAME_RE = /^[^\\/:*?"<>|\r\n]+\.[A-Za-z0-9_-]{1,12}$/;

// Folder markers in technical attributes (icon URLs, classes, data-*): same in every UI language
const FOLDER_RE = /folder/i;
const TEXT_ATTRS = new Set(['href', 'aria-label', 'title', 'alt']); // links, translated texts

const EYE_TITLES = {
    closed: 'Preview',
    half: 'Preview (partly cached)',
    open: 'Preview (fully cached)',
};

let scheduled = false;

/** @returns {void} */
// Containers of SharePoint's dialogues, panels and pop-ups (Fluent UI layers)
const OVERLAY =
    '.ms-Layer, .fui-Portal, [role="dialog"], [role="alertdialog"], [aria-modal="true"], .ms-Panel, .ms-Modal, .ms-Callout';

let headerDirty = true;

// Changes inside script's own elements (viewer, eyes) don't need new scan
const OWN = '.tp-viewer, .tp-cell, .tp-head';

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Current folder, from URL only
//  .../AllItems.aspx?id=/sites/X/Shared Documents/Folder -> id
//  .../Shared Documents/Forms/AllItems.aspx -> library root
// ---------------------------------------------------------------------------

/** @returns {string|null} server-relative folder of the open view, or null outside a library */
export function currentFolder() {
    const params = new URLSearchParams(location.search);
    // "parent" is set while SharePoint shows its own file preview
    const id = params.get('parent') || params.get('id') || params.get('RootFolder');
    if (id) return id.replace(/\/+$/, '');

    const path = decodeURIComponent(location.pathname);
    const i = path.toLowerCase().indexOf('/forms/');
    return i >= 0 ? path.slice(0, i) : null;
}

// ---------------------------------------------------------------------------
// Row inspection (purely from list view's HTML)
// ---------------------------------------------------------------------------

/** @param {HTMLElement} row @returns {string|null} */
export function rowName(row) {
    // 1. Known SharePoint name-field selectors
    const el = row.querySelector(NAME_SELECTORS);
    const name = el?.textContent.trim();
    if (name) return name;

    // 2. Fallback: first visible text in row that looks like file name
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('.tp-cell')) continue;
        const text = (node.textContent ?? '').trim(); // text nodes always have text
        if (FILENAME_RE.test(text)) return text;
    }

    // 3. Fallback: title / aria-label attributes that look like file name
    for (const attrEl of row.querySelectorAll('[title], [aria-label]')) {
        for (const attr of ['title', 'aria-label']) {
            const value = (attrEl.getAttribute(attr) || '').trim();
            if (FILENAME_RE.test(value)) return value;
        }
    }
    return null;
}

/** @param {HTMLElement} row @returns {boolean} */
function isFolder(row) {
    const name = rowName(row);
    for (const el of row.querySelectorAll('*')) {
        if (el.closest('.tp-cell')) continue;
        for (const { name: attr, value } of el.attributes) {
            if (TEXT_ATTRS.has(attr)) continue;
            if (value && value !== name && !value.includes(name ?? '\0') && FOLDER_RE.test(value)) {
                return true;
            }
        }
    }
    return false;
}

// Only rows that show file name (skips folders and totals/footer row)
/** @param {HTMLElement} row @returns {boolean} */
function isFileRow(row) {
    return !!rowName(row) && !isFolder(row);
}

// ---------------------------------------------------------------------------
// Inject column
// ---------------------------------------------------------------------------

// Header eye: overlaid at x position of row eyes (other cell layout)
/** @param {HTMLElement} row @returns {void} */
function processHeader(row) {
    const rowEye = document.querySelector('.tp-cell');
    const ref = row.querySelector('[role="columnheader"]');
    if (!rowEye || !ref || document.querySelector('.tp-overlay')) return;

    const target = rowEye.getBoundingClientRect();
    let head = document.querySelector('.tp-head');
    if (head) {
        if (Math.abs(head.getBoundingClientRect().left - target.left) < 1) return;
        head.remove(); // layout changed -> reposition
    }

    const refRect = ref.getBoundingClientRect();
    const x = target.left + target.width / 2;
    const y = refRect.top + refRect.height / 2;

    // Host = box under that point in header (or one that contains it)
    let host = /** @type {HTMLElement|null} */ (document.elementFromPoint(x, y));
    if (!host || !(row.contains(host) || host.contains(row))) host = ref;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const hostRect = host.getBoundingClientRect();
    head = document.createElement('span');
    head.className = 'tp-head';
    head.title = 'Open the previewer (no file)';
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.innerHTML = EYE_CLOSED_SVG; // state set by refreshEyes()
    head.style.cssText = `
    position: absolute;
    left: ${target.left - hostRect.left + host.scrollLeft}px;
    top: ${refRect.top - hostRect.top + host.scrollTop}px;
    width: ${COL_WIDTH}px;
    height: ${refRect.height}px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #0078d4; /* blue like the row eyes: clickable */
    cursor: pointer;
    z-index: 1;
  `;
    host.append(head);
    refreshEyes();
}

// Return true if row was (re)worked on
/** @param {HTMLElement} row @returns {boolean} true if the row was (re)worked on */
function processRow(row) {
    if (row.querySelector('[role="columnheader"]')) return false; // header: see processHeader

    // Fast path: same content as last time (SharePoint reuses rows)
    const sig = row.textContent;
    if (row.dataset.tpSig === sig && row.querySelector('.tp-cell')) return false;
    row.dataset.tpSig = sig;

    // One shared grid: nothing may go between cells. eye sits in first cell's
    // reserved left padding, same offset in every row.
    const cells = [...row.querySelectorAll('[role="gridcell"], [role="rowheader"]')].filter(
        (c) => c.getClientRects().length,
    ); // skip hidden cells
    if (!cells.length) return false;
    const target = cells.reduce((a, b) => (b.getBoundingClientRect().left < a.getBoundingClientRect().left ? b : a));

    let cell = target.querySelector(':scope > .tp-cell');
    if (!cell) {
        for (const n of row.querySelectorAll('.tp-cell')) n.remove(); // recycled row
        if (!target.dataset.tpPadded) {
            target.dataset.tpPadded = '1';
            const pad = parseFloat(getComputedStyle(target).paddingLeft) || 0;
            target.style.paddingLeft = `${pad + COL_WIDTH}px`;
            if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
        }
        cell = document.createElement('span');
        cell.className = 'tp-cell';
        cell.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: ${COL_WIDTH}px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
    `;
        target.prepend(cell);
    }

    // Align with row's own icon (at top in tall rows)
    /** @type {Element[]} */
    const icons = [...row.querySelectorAll('img, svg, i[data-icon-name]')]; // SVG too: Element methods only
    const icon = icons.find((el) => !el.closest('.tp-cell') && el.getBoundingClientRect().height);
    if (icon) {
        const ir = icon.getBoundingClientRect();
        const mid = ir.top + ir.height / 2 - target.getBoundingClientRect().top;
        cell.style.top = `${Math.round(mid - 14)}px`;
        cell.style.bottom = 'auto';
        cell.style.height = '28px';
    }

    // SharePoint recycles row elements -> re-check state on every pass
    const state = isFileRow(row) ? 'file' : 'none';
    if (cell.dataset.state !== state) {
        cell.dataset.state = state;
        cell.innerHTML =
            state === 'file'
                ? `
        <span class="tp-preview" role="button" tabindex="0" title="Preview"
              style="display:flex; cursor:pointer; color:#0078d4; padding:4px"></span>
      `
                : '';
    }
    if (state === 'file') {
        // Which file this row is now (rows are reused), for eye's cache state
        const eye = /** @type {HTMLElement} */ (cell.querySelector('.tp-preview')); // written just above
        const name = rowName(row);
        const folder = currentFolder();
        eye.dataset.url = (name && (rowFilePath(row, name) || (folder && `${folder}/${name}`))) || '';
        setEye(eye);
    }
    return true;
}

// Eye per file: closed = not cached, half open = partly cached (previewed), open = fully cached
/** @param {string} [url] @returns {'closed'|'half'|'open'} */
function eyeState(url) {
    if (url && pendingOpens.has(url)) return 'half'; // first fetch under way (e.g. Parquet)
    const src = url && memoryCache.get(url)?.src;
    if (!src) return 'closed';
    return src.done || (src.total > 0 && src.loaded >= src.total) ? 'open' : 'half'; // all bytes here
}

/** @param {HTMLElement} eye @returns {void} */
function setEye(eye) {
    // Row of file shown in viewer: highlighted like row under mouse
    const shown = !!(viewer?.file && eye.dataset.url && sameFile(viewer.file.url, eye.dataset.url));
    eye.closest('[role="row"]')?.classList.toggle('tp-row-shown', shown);
    const state = eyeState(eye.dataset.url);
    if (eye.dataset.eye === state) return;
    eye.dataset.eye = state;
    eye.innerHTML = { closed: EYE_CLOSED_SVG, half: EYE_HALF_SVG, open: EYE_FULL_SVG }[state];
    eye.title = EYE_TITLES[state];
}

// Called whenever cache changes
/** @returns {void} */
export function refreshEyes() {
    document.querySelectorAll('.tp-preview').forEach(setEye);
    // Header eye: closed = no viewer, half = viewer with file, open = viewer without file
    const head = document.querySelector('.tp-head');
    if (head) {
        const state = !viewer ? 'closed' : viewer.file ? 'half' : 'open';
        if (head.dataset.eye !== state) {
            head.dataset.eye = state;
            head.innerHTML = { closed: EYE_CLOSED_SVG, half: EYE_HALF_SVG, open: EYE_FULL_SVG }[state];
        }
    }
    if (viewer) viewer.clearAllBtn.disabled = memoryCache.size === 0;
}

function scan() {
    scheduled = false;
    // H-mode panel inside SharePoint's container: put it back if SharePoint re-rendered
    if (viewer?.anchor && !viewer.box.isConnected) syncPanel();
    if (!currentFolder()) return; // not inside library
    // Only library's list, not grids in dialogues, panels or pop-ups
    const rows = [...document.querySelectorAll('[role="grid"] [role="row"], [role="treegrid"] [role="row"]')].filter(
        (row) => !row.closest(OVERLAY),
    );
    document.querySelectorAll('.tp-cell, .tp-head').forEach((el) => {
        if (el.closest(OVERLAY)) el.remove(); // added before grid moved into overlay
    });
    // Rows first (header eye aligns to them); header re-measured only on change
    let changed = headerDirty;
    for (const row of rows) if (processRow(row)) changed = true;
    headerDirty = false;
    const header = changed && rows.find((r) => r.querySelector('[role="columnheader"]'));
    if (header) processHeader(header);
}

/** Watches the list: rescans on DOM changes and resize, plus a first scan. @returns {void} */
export function watchList() {
    new MutationObserver((changes) => {
        if (changes.every((c) => /** @type {Element} */ (c.target).closest?.(OWN))) return; // text nodes: no closest()
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(scan);
        }
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', () => {
        headerDirty = true; // re-align header eye
        requestAnimationFrame(scan);
    });
    requestAnimationFrame(scan); // first scan once page has settled
}

// ---------------------------------------------------------------------------
// Clicks (capture phase, so SharePoint doesn't select/open row)
// ---------------------------------------------------------------------------

/** @param {Event} e @returns {HTMLElement|null} */
const findPreview = (e) => /** @type {HTMLElement|null} */ (e.target)?.closest?.('.tp-preview') ?? null;
/** @param {Event} e @returns {HTMLElement|null} */
const findHead = (e) => /** @type {HTMLElement|null} */ (e.target)?.closest?.('.tp-head') ?? null;

/** Eye clicks and keys (capture phase): preview a row, or open the empty viewer. @returns {void} */
export function handleEyes() {
    for (const type of ['pointerdown', 'mousedown', 'dblclick']) {
        document.addEventListener(
            type,
            (e) => {
                if (findPreview(e) || findHead(e)) e.stopPropagation(); // not sort / row selection
            },
            true,
        );
    }

    // Header eye: previewer without file (to see it, change settings, ...); again: close
    document.addEventListener(
        'click',
        (e) => {
            if (!findHead(e)) return;
            e.preventDefault();
            e.stopPropagation();
            openEmptyViewer();
        },
        true,
    );
    document.addEventListener(
        'keydown',
        (e) => {
            if (!findHead(e) || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            e.stopPropagation();
            openEmptyViewer();
        },
        true,
    );

    document.addEventListener(
        'click',
        (e) => {
            const btn = findPreview(e);
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            openPreview(btn.closest('[role="row"]'));
        },
        true,
    );

    document.addEventListener(
        'keydown',
        (e) => {
            const btn = findPreview(e);
            if (!btn || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            e.stopPropagation();
            openPreview(btn.closest('[role="row"]'));
        },
        true,
    );
}

// File's path from row's links (search results mix folders)
/** @param {HTMLElement} row @param {string} name @returns {string|null} */
export function rowFilePath(row, name) {
    const host = location.hostname;

    /** @param {string} value */
    const toPath = (value) => {
        let u;
        try {
            u = new URL(value, location.href);
        } catch {
            return null;
        }
        if (u.hostname !== host) return null;
        const id = u.searchParams.get('id');
        if (/\.aspx$/i.test(u.pathname) && id) return id;
        return decodeURIComponent(u.pathname.replace(/^\/:[a-z]:\/r(?=\/)/i, ''));
    };
    for (const el of row.querySelectorAll('*')) {
        if (el.closest('.tp-cell')) continue;
        for (const { name: attr, value } of el.attributes) {
            if (!value || value.length > 2000 || !/[/%]/.test(value)) continue;
            if (!/^(href|src|title|aria-label|data-[\w-]+)$/i.test(attr)) continue;
            const path = /^(https?:|\/)/i.test(value) ? toPath(value) : null;
            if (path && path.split('/').pop() === name) return path;
        }
    }
    return null;
}
