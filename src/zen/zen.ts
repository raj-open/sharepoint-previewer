// Zen mode: own list of the folder (files, folders, their properties) in place of Sharepoint's, with or without the viewer

// ===========================================================================
// IMPORTS
// ===========================================================================

import { currentFolder } from '../_core/list.ts';
import { inLibrary } from '../_core/list.ts';
import { listShift } from '../_core/list.ts';
import { loadPref } from '../_core/prefs.ts';
import { savePref } from '../_core/prefs.ts';
import { view } from '../_core/prefs.ts';
import { SPLIT_GAP } from '../_core/settings.ts';
import { esc } from '../_core/util.ts';
import { API_OFF } from '../readers/api.ts';
import { apiAllowed } from '../readers/api.ts';
import { libraryOfPage } from '../readers/api.ts';
import { COLUMNS_SVG } from '../ui/icons.ts';
import { EYE_CLOSED_SVG } from '../ui/icons.ts';
import { EYE_FULL_SVG } from '../ui/icons.ts';
import { EYE_HALF_SVG } from '../ui/icons.ts';
import { REFRESH_SVG } from '../ui/icons.ts';
import { SAVE_SVG } from '../ui/icons.ts';
import { STOP_SVG } from '../ui/icons.ts';
import { UPLOAD_SVG } from '../ui/icons.ts';
import { WRITE_SVG } from '../ui/icons.ts';
import { ZEN_ON_SVG } from '../ui/icons.ts';
import { ZEN_SVG } from '../ui/icons.ts';
import { closeFilterPanel } from '../view/filter.ts';
import { flash } from '../viewer/edit.ts';
import { panelEdges } from '../viewer/layout.ts';
import { listRegion } from '../viewer/layout.ts';
import { nameProblem } from '../viewer/names.ts';
import { closeViewer } from '../viewer/open.ts';
import { openFolder } from '../viewer/open.ts';
import { sameFile } from '../viewer/open.ts';
import { showFile } from '../viewer/open.ts';
import { viewer } from '../viewer/open.ts';
import { keepChanges } from './changes.ts';
import { loadChanges } from './changes.ts';
import { loadColumns } from './columns.ts';
import { toggleColumnsMenu } from './columns.ts';
import { loadFolder } from './data.ts';
import { NAME } from './data.ts';
import { saveItem } from './data.ts';
import { drawGrid } from './grid.ts';
import { fieldOf } from './grid.ts';
import { markShown } from './grid.ts';
import { originalValue } from './grid.ts';
import { stopGrid } from './grid.ts';
import { wireGrid } from './grid.ts';

import type { Viewer } from '../_core/types.ts';
import type { Zen } from '../_core/types.ts';
import type { ZenItem } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const ZEN_TITLE = 'Zen mode: own list of the folder, with its properties (sort, filter, columns, edit)';
const DROP = 'Drop the changes of this folder which have not been uploaded to Sharepoint?';
const KEPT = "Changes are kept in the viewer but won't take effect until uploaded (cloud button).";
export const ZEN_KEY = 'tp-preview-zen'; // Zen mode on ('1') or off, kept
const ZEN_TAB_TITLE = ZEN_TITLE;
const TAB_WIDTH = 30; // px, out of the list to the left
const TAB_HEIGHT = 44; // px at the list's edge (the outer edge: 12 px less, shoulders sloping)
const TAB_TOP = 8; // px below the top of the list
// The tab: flush with the top of the list (its top edge continues the list's, whose top left corner is made square),
// the Zen button, below it room for the header eye of Sharepoint's list: there while the list is scrolled sideways
// (the header scrolls away), back in the header otherwise
const TAB_EYE = 30; // px more below for the eye
const TAB_LONG_SHAPE = ((w: number, t: number, h: number) => {
    const top = 0.5 - t; // the list's top edge (tab placed TAB_TOP below it)
    const d =
        `M ${w + 1} ${top} L 7 ${top} Q 1.5 ${top} 1.5 ${top + 5.5} ` +
        `L 1.5 ${h - 11.5} Q 1.5 ${h - 6} 7 ${h - 6} L ${w - 10} ${h - 6} C ${w - 6} ${h - 6} ${w - 4} ${h - 0.5} ${w + 1} ${h - 0.5}`;
    const box = `0 ${-t} ${w + 1} ${h + t}`;
    const css = `inset: auto; left: 0; top: ${-t}px; height: ${h + t}px`;
    return `<svg class="tp-zen-tab-shape" style="${css}" viewBox="${box}" aria-hidden="true"><path d="${d}"/></svg>`;
})(TAB_WIDTH, TAB_TOP, TAB_HEIGHT + TAB_EYE);

let zenTab: HTMLButtonElement | null = null; // the tab, once made
let tabEye: HTMLButtonElement | null = null; // header eye in the long tab, once made

/** Zen list shown, if any (on its own: with or without the viewer) */
export let zenList: Zen | null = null;

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// On and off: on its own (with or without the viewer), remembered (also across page loads)
// ---------------------------------------------------------------------------

/** @returns why Zen mode cannot start here ('' if it can) */
export function zenProblem(): string {
    if (!apiAllowed()) return `Zen mode reads the list through the Sharepoint API, which is ${API_OFF}.`;
    if (!inLibrary() || !libraryOfPage()) return 'Zen mode works in a document library: please open one first.';
    return '';
}

/** Zen mode on or off (off: asks first if there are unsaved changes) */
export function toggleZen(): void {
    if (zenList) exitZen();
    else enterZen();
}

/** Zen mode on (remembered); `quiet`: no message if it cannot start (page load) */
export function enterZen(quiet = false): void {
    if (zenList) return;
    const why = zenProblem();
    if (why) return void (quiet || alert(why));
    const library = libraryOfPage() as string; // checked by zenProblem
    const z = createZen(library);
    zenList = z;
    savePref(ZEN_KEY, '1');
    if (viewer) viewer.backdrop.style.display = 'none'; // popup: the list stays usable beside it
    placeZen(); // the viewer's split as it is: nothing moves
    showZenState();
    void goTo(z, startFolder(library));
}

/** @returns Zen mode is off (changes not uploaded stay in the view: said) */
export function exitZen(): boolean {
    const z = zenList;
    if (!z) return true;
    if (z.pending.size) {
        keepView(z);
        alert(KEPT); // allowed, but said: nothing uploaded yet
    }
    removeZen();
    savePref(ZEN_KEY, '0');
    if (viewer) viewer.backdrop.style.display = viewer.mode === 'popup' ? 'block' : 'none';
    showZenState();
    return true;
}

/** Takes the list away (no questions, nothing remembered: the page is no library any more) */
export function removeZen(): void {
    const z = zenList;
    if (!z) return;
    if (z.data) keepView(z); // changes stay in the view (next time in this folder)
    z.token++; // answers still on their way are dropped
    z.stop();
    z.el.remove();
    zenList = null;
    showZenState();
}

/** Page load or library opened: Zen mode as last time (once Sharepoint's list is there); outside a library: none */
export function restoreZen(): void {
    if (!inLibrary()) return void removeZen();
    if (zenList) {
        if (!zenList.el.isConnected) placeZen(); // put back if Sharepoint re-rendered
        return void followSharepoint(zenList);
    }
    if (loadPref(ZEN_KEY, '0') === '1' && listRegion()) enterZen(true);
}

// Folder of the file shown (same library), else of the empty viewer, else the one open in Sharepoint
function startFolder(library: string): string {
    const lower = `${library.toLowerCase()}/`;
    const file = viewer?.file?.url;
    const parent = file ? file.slice(0, file.lastIndexOf('/')) : null;
    for (const f of [parent, viewer?.place, currentFolder()]) {
        if (f && (`${f.toLowerCase()}/`.startsWith(lower) || sameFile(f, library))) return f;
    }
    return library;
}

// ---------------------------------------------------------------------------
// Page-wide hooks: keys, unsaved changes, theme, file shown, state of the eye and the Zen buttons
// ---------------------------------------------------------------------------

/** @returns Zen list has changes not uploaded (leaving the page: warned) */
export const zenPending = (): boolean => !!zenList?.pending.size;

/** Ctrl+S / Cmd+S: keeps the Zen list's changes in the view (edit mode, unless the viewer's text editor has the focus) */
export function zenSave(): boolean {
    const z = zenList;
    if (!z?.editing) return false;
    if (viewer?.writeMode && !z.el.contains(document.activeElement)) return false;
    saveView(z);
    return true;
}

/** Esc: closes a menu or panel of the Zen list, else ends its edit mode @returns Esc was used */
export function zenEscape(): boolean {
    const z = zenList;
    if (!z) return false;
    const menu = z.el.querySelector('.tp-zen-columns, .tp-filter-panel');
    if (menu) {
        menu.remove();
        closeFilterPanel();
        return true;
    }
    if (!z.editing || (viewer?.writeMode && !z.el.contains(document.activeElement))) return false;
    leaveEdit(z);
    return true;
}

/** Light / dark as the viewer */
export function zenTheme(): void {
    if (zenList) zenList.el.className = `tp-zen tp-${view.theme}${zenList.editing ? ' tp-zen-editing' : ''}`;
    placeTab();
}

/** Zen list after a change of the viewer or the cache: row of the file shown marked, its eye */
export function zenRefresh(): void {
    placeTab();
    const z = zenList;
    if (!z) return;
    markShown(z, shownPath());
    const state = !viewer ? 'closed' : viewer.file ? 'half' : 'open';
    if (z.eyeBtn.dataset.eye === state) return;
    z.eyeBtn.dataset.eye = state;
    z.eyeBtn.innerHTML = { closed: EYE_CLOSED_SVG, half: EYE_HALF_SVG, open: EYE_FULL_SVG }[state];
    z.eyeBtn.title = viewer ? 'Close the previewer' : 'Open the previewer (no file)';
}

// Zen on or off: the toggles (header of Sharepoint's list, ⋯ menu of the viewer) show it
function showZenState(): void {
    viewer?.zenBtn.setAttribute('aria-pressed', String(!!zenList));
    placeTab();
}

// ---------------------------------------------------------------------------
// Toggle: a tab at the left edge of the list (as on a folder), the same place with or without Zen mode
// ---------------------------------------------------------------------------

/**
 * Tab with the Zen toggle, left of the list (in a library, if the API may be used); its look: on or off
 * @param shown a list is there (false: no tab)
 */
export function placeTab(shown = !!zenTab): void {
    const list = shown && inLibrary() && apiAllowed() ? listRegion() : null;
    // joined to the list seen: the Zen list, else Sharepoint's (left edge of its list, as the Zen list's; top of its card)
    const own = zenList?.el.isConnected ? zenList.el.getBoundingClientRect() : null;
    const card = list?.card.getBoundingClientRect();
    const r =
        own ??
        (list && card ? { left: list.scroller.getBoundingClientRect().left, top: card.top, width: card.width } : null);
    const head = document.querySelector<HTMLElement>('.tp-head');
    if (!r?.width) {
        tabEye?.remove();
        if (head) head.style.visibility = '';
        return void zenTab?.remove();
    }
    if (!own && list) squareCorner(list.card, list.scroller);
    if (!zenTab) zenTab = createTab();
    if (!zenTab.isConnected) document.documentElement.append(zenTab);
    const on = !!zenList;
    if (zenTab.getAttribute('aria-pressed') !== String(on)) {
        zenTab.setAttribute('aria-pressed', String(on));
        zenTab.innerHTML = TAB_LONG_SHAPE + (on ? ZEN_ON_SVG : ZEN_SVG);
        zenTab.title = on ? "Zen mode off (back to Sharepoint's list)" : ZEN_TAB_TITLE;
    }
    const theme = `tp-${zenList ? view.theme : 'light'}`; // off: as Sharepoint; on: as the Zen list
    zenTab.className = `tp-zen-tab ${theme}`;
    const left = Math.round(r.left - TAB_WIDTH); // 1 px over the list's border: joined to it
    const top = Math.round(r.top + TAB_TOP);
    zenTab.style.left = `${left}px`;
    zenTab.style.top = `${top}px`;
    const moved = !on && !!head && listShift() > 0; // scrolled sideways: in the tab instead
    if (head) head.style.visibility = moved ? 'hidden' : '';
    if (!moved || !head) return void tabEye?.remove(); // Zen mode: the Zen list's own eye (its bar)
    // header eye in the tab, below the Zen button: same look, same action (a click on the header eye)
    if (!tabEye) tabEye = createTabEye();
    if (!tabEye.isConnected) document.documentElement.append(tabEye);
    if (tabEye.dataset.eye !== head.dataset.eye) {
        tabEye.dataset.eye = head.dataset.eye ?? '';
        tabEye.innerHTML = head.innerHTML;
    }
    tabEye.title = head.title;
    tabEye.className = `tp-zen-tab-eye ${theme}`;
    tabEye.style.left = `${left}px`;
    tabEye.style.top = `${top + TAB_HEIGHT - 6}px`;
}

// Top left corner of Sharepoint's list made square, so the tab joins it flush: every box of the card at that corner
function squareCorner(card: HTMLElement, scroller: HTMLElement): void {
    const c = card.getBoundingClientRect();
    for (let el: HTMLElement | null = scroller; el; el = el.parentElement) {
        const r = el.getBoundingClientRect();
        if (Math.abs(r.left - c.left) > 2 || Math.abs(r.top - c.top) > 2) {
            if (el === card || card.contains(el)) continue;
            break; // above the card, elsewhere: no longer its corner
        }
        if (el.dataset.tpSquare) continue;
        if (parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0) {
            el.dataset.tpSquare = '1';
            el.style.borderTopLeftRadius = '0';
        }
    }
}

function createTabEye(): HTMLButtonElement {
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.style.width = `${TAB_WIDTH - 2}px`;
    eye.style.height = `${TAB_EYE}px`;
    for (const type of ['dblclick', 'mousedown', 'pointerdown', 'keydown', 'contextmenu']) {
        eye.addEventListener(type, (e) => e.stopPropagation()); // not for Sharepoint
    }
    eye.onclick = (e) => {
        e.stopPropagation();
        document.querySelector<HTMLElement>('.tp-head')?.click(); // as the header eye (its own handler)
    };
    return eye;
}

function createTab(): HTMLButtonElement {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.style.width = `${TAB_WIDTH + 1}px`;
    tab.style.height = `${TAB_HEIGHT}px`;
    for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown', 'keydown', 'contextmenu']) {
        tab.addEventListener(type, (e) => e.stopPropagation()); // not for Sharepoint
    }
    tab.onclick = () => toggleZen();
    return tab;
}

const shownPath = (): string | null => {
    const url = viewer?.file?.url;
    if (!url) return null;
    try {
        return decodeURIComponent(url);
    } catch {
        return url;
    }
};

// ---------------------------------------------------------------------------
// Place: over Sharepoint's list (beside the viewer: its part; else, or pop-up: all of it), moving with it
// ---------------------------------------------------------------------------

export function placeZen(): void {
    const z = zenList;
    if (!z) return;
    const v = viewer;
    const r = zenRect(v);
    const host = v?.anchor && v.anchorParent ? v.anchorParent : document.documentElement;
    if (z.el.parentElement !== host) host.append(z.el);
    const s = z.el.style;
    const px = (n: number) => `${Math.max(0, Math.round(n))}px`;
    if (host === document.documentElement) {
        s.position = 'fixed';
        s.left = px(r.left);
        s.top = px(r.top);
    } else {
        const p = host.getBoundingClientRect();
        s.position = 'absolute';
        s.left = px(r.left - p.left - host.clientLeft + host.scrollLeft);
        s.top = px(r.top - p.top - host.clientTop + host.scrollTop);
    }
    s.width = px(r.right - r.left);
    s.height = px(r.bottom - r.top);
}

// Room of the list: what is left of Sharepoint's list, with the panel's own edges (one card beside the other,
// SPLIT_GAP apart): below the list the same left and right, beside it the same top and bottom;
// no viewer, or a pop-up: all of the list
function zenRect(v: Viewer | null): { left: number; top: number; right: number; bottom: number } {
    if (!v || v.mode === 'popup') {
        // same left and right edges as with the viewer below (nothing jumps when the viewer opens or closes)
        const list = listRegion();
        const t = (list?.card ?? document.body).getBoundingClientRect();
        const inner = list?.scroller.getBoundingClientRect() ?? t;
        const right = list ? panelEdges(list.card, list.scroller).right : t.right;
        return { left: inner.left, top: Math.max(0, t.top), right, bottom: Math.min(t.bottom, window.innerHeight) };
    }
    const t = (v.region ?? v.dock ?? document.body).getBoundingClientRect();
    const inner = v.scroller?.getBoundingClientRect() ?? t; // where the list itself starts (frame left out)
    const b = v.box.getBoundingClientRect();
    if (v.mode === 'horizontal')
        return { left: b.left, top: Math.max(0, t.top), right: b.right, bottom: b.top - SPLIT_GAP };
    return { left: inner.left, top: b.top, right: b.left - SPLIT_GAP, bottom: b.bottom };
}

// ---------------------------------------------------------------------------
// The list: bar (eye and Zen at the top left, as on Sharepoint's list; folder, note, buttons) and grid
// ---------------------------------------------------------------------------

function createZen(library: string): Zen {
    const el = document.createElement('div');
    el.className = `tp-zen tp-${view.theme}`;
    const button = (svg: string, title: string, cls = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `tp-mode-btn tp-zen-btn ${cls}`.trim();
        b.innerHTML = svg;
        b.title = title;
        return b;
    };
    const bar = document.createElement('div');
    bar.className = 'tp-zen-bar tp-header';
    const eyeBtn = button(EYE_CLOSED_SVG, 'Open the previewer (no file)', 'tp-zen-eye');
    const crumbs = document.createElement('nav');
    crumbs.className = 'tp-zen-crumbs tp-well';
    const note = document.createElement('span');
    note.className = 'tp-zen-note';
    const editBtn = button(WRITE_SVG, 'Edit properties and names (non-system fields)');
    editBtn.setAttribute('aria-pressed', 'false');
    const saveBtn = button(SAVE_SVG, 'Save: keep the changes in the view, ready for upload (Ctrl+S)');
    const uploadBtn = button(UPLOAD_SVG, 'Upload the saved changes to Sharepoint (as its properties form does)');
    const cancelBtn = button(STOP_SVG, 'Cancel: drop the changes not uploaded, end editing');
    const reloadBtn = button(REFRESH_SVG, 'Reload the folder');
    const columnsBtn = button(COLUMNS_SVG, 'Columns: show, hide, order');
    bar.append(eyeBtn, crumbs, note, editBtn, cancelBtn, saveBtn, uploadBtn, reloadBtn, columnsBtn);
    const grid = document.createElement('div');
    grid.className = 'tp-zen-grid tp-content';
    grid.tabIndex = 0;
    el.append(bar, grid);

    // Events stay away from Sharepoint's handlers (split modes: inside its page)
    for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown', 'keydown', 'keyup', 'contextmenu', 'wheel']) {
        el.addEventListener(type, (e) => e.stopPropagation());
    }
    // Esc without a viewer (with one: the viewer's handler asks the list first)
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !viewer && zenEscape()) e.preventDefault();
    });
    const onResize = () => placeZen();
    window.addEventListener('resize', onResize);

    const z: Zen = {
        el,
        bar,
        crumbs,
        note,
        grid,
        eyeBtn,
        editBtn,
        saveBtn,
        uploadBtn,
        cancelBtn,
        columnsBtn,
        folder: library,
        urlFolder: '',
        data: null,
        columns: loadColumns(library),
        sort: null,
        filters: new Map(),
        editing: false,
        busy: false,
        pending: new Map(),
        dirty: false,
        errors: new Map(),
        token: 0,
        stop: () => {
            window.removeEventListener('resize', onResize);
            stopGrid(z);
        },
    };
    const redraw = () => draw(z);
    const edited = () => {
        z.dirty = true;
        showButtons(z);
    };
    wireGrid(z, { redraw, open: (item) => openItem(z, item), edited });
    crumbs.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest('[data-folder]') as HTMLElement | null;
        if (a) void goTo(z, a.dataset.folder as string);
    });
    // eye: the previewer on (empty, for the folder shown here) or off; Zen: off
    eyeBtn.onclick = () => (viewer ? closeViewer() : openFolder(z.folder));
    editBtn.onclick = () => (z.editing ? leaveEdit(z) : startEdit(z));
    saveBtn.onclick = () => saveView(z);
    uploadBtn.onclick = () => void upload(z);
    cancelBtn.onclick = () => cancelEdit(z);
    reloadBtn.onclick = () => void goTo(z, z.folder, true);
    columnsBtn.onclick = () => toggleColumnsMenu(z, redraw);
    showButtons(z);
    queueMicrotask(zenRefresh);
    return z;
}

function draw(z: Zen): void {
    drawGrid(z, zenList === z ? shownPath() : null);
}

function showButtons(z: Zen): void {
    z.editBtn.setAttribute('aria-pressed', String(z.editing));
    z.editBtn.disabled = z.busy || !z.data;
    z.saveBtn.disabled = z.busy || !z.editing || !z.dirty;
    const ready = !z.busy && !z.dirty && z.pending.size > 0; // saved, not uploaded
    z.uploadBtn.disabled = !ready;
    z.uploadBtn.classList.toggle('tp-zen-ready', ready);
    z.cancelBtn.disabled = z.busy || (!z.editing && !z.pending.size);
    z.el.classList.toggle('tp-zen-editing', z.editing);
}

// Folder path as links: library (its title, once known), then each folder below it
function showCrumbs(z: Zen, library: string): void {
    const parts = z.folder.slice(library.length).split('/').filter(Boolean);
    const top = z.data?.title || (library.split('/').pop() ?? library);
    const links = [top, ...parts].map((name, i) => {
        const folder = [library, ...parts.slice(0, i)].join('/');
        const last = i === parts.length;
        return last
            ? `<strong title="${esc(folder)}">${esc(name)}</strong>`
            : `<a data-folder="${esc(folder)}" title="${esc(folder)}">${esc(name)}</a>`;
    });
    z.crumbs.innerHTML = links.join('<span class="tp-zen-sep">›</span>');
}

/**
 * Shows a folder; changes of the folder left stay in the view (kept for it, not uploaded)
 * @param again same folder read anew
 */
async function goTo(z: Zen, folder: string, again = false): Promise<void> {
    if (!again && z.data && sameFile(folder, z.folder)) return;
    if (zenList !== z) return;
    if (z.data) keepView(z);
    const library = libraryOfPage() ?? z.folder;
    const token = ++z.token;
    if (!sameFile(folder, z.folder)) {
        z.filters.clear(); // filters belong to a folder's values
        z.errors.clear();
    }
    z.folder = folder;
    showInSharepoint(z, folder);
    showCrumbs(z, library);
    z.note.textContent = 'Loading …';
    z.busy = true;
    showButtons(z);
    const data = await loadFolder(library, folder);
    if (token !== z.token) return; // another folder meanwhile, or closed
    z.busy = false;
    if (typeof data === 'string') {
        z.data = null;
        z.note.textContent = '';
        z.grid.innerHTML = `<div class="tp-zen-empty tp-zen-failed">Could not read the folder: ${esc(data)}</div>`;
        return void showButtons(z);
    }
    z.data = data;
    z.pending = keptFor(z, data.items);
    z.dirty = false;
    for (const id of [...z.errors.keys()]) if (!z.pending.has(id)) z.errors.delete(id);
    showCrumbs(z, library);
    showCount(z, z.pending.size ? notUploaded(z) : '');
    showButtons(z);
    draw(z);
}

// Sharepoint's list follows the Zen list (its address too: Back works, Zen mode off shows that folder):
// address changed in place, then announced as Sharepoint's own navigation would be (popstate)
function showInSharepoint(z: Zen, folder: string): void {
    z.urlFolder = folder;
    const now = currentFolder();
    if (!now || sameFile(now, folder)) return;
    const url = new URL(location.href);
    for (const key of ['id', 'parent', 'RootFolder', 'q']) url.searchParams.delete(key);
    if (!sameFile(folder, libraryOfPage() ?? '')) url.searchParams.set('id', folder);
    history.pushState(null, '', url.href);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
}

// The Zen list follows Sharepoint's list (Back, a link): its folder, once the address shows another one
function followSharepoint(z: Zen): void {
    const now = currentFolder();
    if (!now || sameFile(now, z.urlFolder)) return;
    z.urlFolder = now;
    if (!sameFile(now, z.folder)) void goTo(z, now);
}

function showCount(z: Zen, extra = ''): void {
    const n = z.data?.items.length ?? 0;
    const count = `${n.toLocaleString()} item${n === 1 ? '' : 's'}`;
    z.note.textContent = extra ? `${count} · ${extra}` : count;
}

// Click on a row: a folder opens in the list, a file in the viewer
function openItem(z: Zen, item: ZenItem): void {
    if (item.folder) return void goTo(z, item.path);
    void showFile(item.name, item.path, false);
}

// ---------------------------------------------------------------------------
// Edit mode: values changed per cell; Save keeps them in the view, Upload applies them to Sharepoint
// ---------------------------------------------------------------------------

// Changes kept for the folder, of items still there and still different from Sharepoint's values
function keptFor(z: Zen, items: ZenItem[]): Map<number, Record<string, string>> {
    const out = new Map<number, Record<string, string>>();
    for (const [id, values] of loadChanges(z.folder)) {
        const item = items.find((x) => x.id === id);
        if (!item) continue;
        const own = Object.fromEntries(
            Object.entries(values).filter(
                ([col, v]) => (col === NAME || fieldOf(z, col)?.editable) && v !== originalValue(item, fieldOf(z, col)),
            ),
        );
        if (Object.keys(own).length) out.set(id, own);
    }
    return out;
}

// Changes of the folder shown kept in the view (as saved)
function keepView(z: Zen): void {
    (document.activeElement as HTMLElement | null)?.blur?.(); // last cell typed in: its value recorded
    keepChanges(z.folder, z.pending);
    z.dirty = false;
}

function notUploaded(z: Zen): string {
    const n = [...z.pending.values()].reduce((sum, v) => sum + Object.keys(v).length, 0);
    return `${n} change${n === 1 ? '' : 's'} not uploaded`;
}

function startEdit(z: Zen): void {
    if (!z.data || z.busy) return;
    z.editing = true;
    showButtons(z);
    draw(z);
}

/** Save: changes kept in the view (also in other folders, after a reload), ready for upload */
function saveView(z: Zen): void {
    if (!z.data || z.busy) return;
    keepView(z);
    showCount(z, z.pending.size ? `${notUploaded(z)} (saved in the view)` : '');
    showButtons(z);
    if (z.pending.size) flash(z.uploadBtn);
}

// Back to reading (edit button, Esc): changes kept in the view, said so; the upload button shows where to apply them
function leaveEdit(z: Zen): void {
    const changed = z.dirty || z.pending.size > 0;
    keepView(z);
    z.editing = false;
    showButtons(z);
    draw(z);
    if (!changed || !z.pending.size) return;
    showCount(z, KEPT);
    flash(z.uploadBtn);
}

// Cancel: changes not uploaded dropped (after asking), edit mode ended
function cancelEdit(z: Zen): void {
    if (z.busy) return;
    if (z.pending.size) {
        flash(z.uploadBtn);
        if (!confirm(DROP)) return;
    }
    z.pending.clear();
    z.errors.clear();
    keepView(z);
    z.editing = false;
    showButtons(z);
    showCount(z);
    draw(z);
}

/** Upload: all saved changes, item by item (as Sharepoint's form does); cells refused stay marked with the reason */
async function upload(z: Zen): Promise<void> {
    const data = z.data;
    if (!data || z.busy || z.dirty || !z.pending.size) return;
    z.busy = true;
    showButtons(z);
    z.note.textContent = 'Uploading …';
    let saved = 0;
    let failed = 0;
    const renamed: { from: string; to: string; name: string }[] = [];
    for (const [id, values] of [...z.pending]) {
        const item = data.items.find((x) => x.id === id);
        if (!item) continue;
        const errors: Record<string, string> = {};
        const name = values[NAME];
        if (name !== undefined) {
            const problem = nameProblem(name);
            if (problem) errors[NAME] = problem;
        }
        const send = Object.fromEntries(Object.entries(values).filter(([k]) => !errors[k]));
        if (Object.keys(send).length) Object.assign(errors, await saveItem(data.library, id, send, data.fields));
        const left = Object.fromEntries(Object.entries(values).filter(([k]) => errors[k]));
        saved += Object.keys(values).length - Object.keys(left).length;
        failed += Object.keys(left).length;
        if (name !== undefined && !errors[NAME]) {
            const folder = item.path.slice(0, item.path.lastIndexOf('/'));
            renamed.push({ from: item.path, to: `${folder}/${name}`, name });
        }
        if (Object.keys(left).length) {
            z.pending.set(id, left);
            z.errors.set(id, errors);
        } else {
            z.pending.delete(id);
            z.errors.delete(id);
        }
    }
    if (zenList !== z) return;
    keepChanges(z.folder, z.pending); // refused ones stay in the view
    z.busy = false;
    await goTo(z, z.folder, true); // values as Sharepoint keeps them now
    const done = saved ? [`${saved} change${saved === 1 ? '' : 's'} uploaded`] : [];
    if (failed)
        done.push(
            saved
                ? `${failed} not uploaded (marked)`
                : `${failed} change${failed === 1 ? '' : 's'} not uploaded (marked)`,
        );
    showCount(z, done.join(', '));
    // file shown was renamed: shown under its new name
    const v = viewer;
    for (const r of renamed) {
        if (v?.file && sameFile(v.file.url, r.from) && !v.writeMode) void showFile(r.name, r.to, true);
    }
}
