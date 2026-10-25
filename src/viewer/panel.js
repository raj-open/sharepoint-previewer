// Viewer panel: elements, buttons, editor and gutter

// ===========================================================================
// IMPORTS
// ===========================================================================

import { COLOUR_KEYS } from '../_core/prefs.js';
import { colourPrefs } from '../_core/prefs.js';
import { PROPS_KEY } from '../_core/prefs.js';
import { savePref } from '../_core/prefs.js';
import { THEME_KEY } from '../_core/prefs.js';
import { view } from '../_core/prefs.js';
import { WRAP_KEY } from '../_core/prefs.js';
import { ZOOM_KEY } from '../_core/prefs.js';
import { ZOOM_RANGE } from '../_core/prefs.js';
import { openSettingsForm } from '../_core/settings-form.js';
import { POPUP_POS_KEY } from '../_core/settings-form.js';
import { LARGE_FILE_BYTES } from '../_core/settings.js';
import { LOGO } from '../_core/settings.js';
import { esc } from '../_core/util.js';
import { formatBytes } from '../_core/util.js';
import { CHECK_SVG } from '../ui/icons.js';
import { CLEAR_SVG } from '../ui/icons.js';
import { COLOUR_SVG } from '../ui/icons.js';
import { COPY_SVG } from '../ui/icons.js';
import { LOAD_ALL_SVG } from '../ui/icons.js';
import { MORE_SVG } from '../ui/icons.js';
import { POPUP_SVG } from '../ui/icons.js';
import { PROPS_SVG } from '../ui/icons.js';
import { REFRESH_SVG } from '../ui/icons.js';
import { SAVE_SVG } from '../ui/icons.js';
import { SETTINGS_SVG } from '../ui/icons.js';
import { SPLIT_H_SVG } from '../ui/icons.js';
import { SPLIT_V_SVG } from '../ui/icons.js';
import { STOP_SVG } from '../ui/icons.js';
import { TEXT_SVG } from '../ui/icons.js';
import { THEME_SVG } from '../ui/icons.js';
import { UPLOAD_SVG } from '../ui/icons.js';
import { WRAP_SVG } from '../ui/icons.js';
import { WRITE_SVG } from '../ui/icons.js';
import { FORMAT_LISTS } from '../readers/formats.js';
import { startMove } from '../ui/move.js';
import { createPicker } from '../ui/picker.js';
import { QUOTE_MODES } from '../view/table.js';
import { cancelLoad } from './cache.js';
import { clearAllCached } from './cache.js';
import { clearCached } from './cache.js';
import { makeRoom } from './cache.js';
import { memoryCache } from './cache.js';
import { discardEdits } from './edit.js';
import { editedText } from './edit.js';
import { enterWrite } from './edit.js';
import { exitWriteView } from './edit.js';
import { flash } from './edit.js';
import { markEdited } from './edit.js';
import { uploadEdits } from './edit.js';
import { layoutPage } from './layout.js';
import { setMode } from './layout.js';
import { startDrag } from './layout.js';
import { chooseFormat } from './open.js';
import { closeViewer } from './open.js';
import { showFile } from './open.js';
import { viewer } from './open.js';
import { setBusy } from './status.js';
import { close3d } from './view3d.js';
import { toggle3d } from './view3d.js';
import { colourKey } from './views.js';
import { colourOn } from './views.js';
import { markdownView } from './views.js';
import { previewOf } from './views.js';
import { setPreview } from './views.js';
import { tableView } from './views.js';
import { updateViews } from './views.js';
import { viewKey } from './views.js';

/** @typedef {import('../_core/types.js').Viewer} Viewer */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Preferences of the views switched by Text / Preview
/** @type {Object<string, string>} */
const VIEW_KEYS = { table: 'tp-preview-table', logTable: 'tp-preview-log-table', markdown: 'tp-preview-markdown' };

const ZOOM_STEP = 0.1;
const WHEEL_STEP = 40; // wheel distance per zoom step (mouse notch ~100, touchpad pinch: small steps)

const SQUARE_BTN_CSS = `
  position: absolute;
  z-index: 1;
  width: 30px;
  height: 30px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`;

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns {Viewer} */
export function createViewer() {
    // Dark backdrop (popup mode only)
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.5);
    z-index: 2147483000; /* above SharePoint's own panels (settings, details, ...) */
  `;

    // Panel
    const box = document.createElement('div');
    box.className = `tp-viewer tp-${view.theme}`;

    // Header bar
    const header = document.createElement('div');
    header.className = 'tp-header';
    header.style.cssText = `
    position: relative;
    flex: none;
    height: 94px;
  `;

    // Header buttons
    const ROW1 = 8;
    /** @param {string} svg @param {string} title @param {number} left @param {number} [top] @param {{ disabled?: boolean, pressed?: boolean }} [opts] */
    const button = (svg, title, left, top = ROW1, { disabled = false, pressed } = {}) => {
        const btn = document.createElement('button');
        btn.className = 'tp-mode-btn';
        btn.innerHTML = svg;
        btn.title = title;
        btn.disabled = disabled;
        if (pressed !== undefined) btn.setAttribute('aria-pressed', String(pressed));
        btn.style.cssText = `${SQUARE_BTN_CSS} left: ${left}px; top: ${top}px;`;
        return btn;
    };
    // Main row: [layout ▾] [edit] [cache all] [stop] [save] [upload] (i) File: name [table] [3D] … [⋯] [copy] [✕]
    const layoutBtn = button(SPLIT_H_SVG, 'Layout: below the list / right of the list / popup', 10);
    const writeBtn = button(WRITE_SVG, 'Edit (beta, text files only)', 46, ROW1, { disabled: true, pressed: false });
    const loadAllBtn = button(LOAD_ALL_SVG, 'Cache the whole file', 82, ROW1, { disabled: true });
    const stopBtn = button(STOP_SVG, 'Stop caching', 118, ROW1, { disabled: true }); // also: cancel changes
    const saveBtn = button(SAVE_SVG, 'Save: keep the changes, ready for upload (Ctrl+S)', 154, ROW1, {
        disabled: true,
    });
    const uploadBtn = button(UPLOAD_SVG, 'Upload the saved changes to SharePoint', 190, ROW1, { disabled: true });
    // View switch (status bar, bottom right): Text | Preview (Table, 3D or Markdown, by file type)
    /** @param {string} svg @param {string} label @param {string} title */
    const viewBtn = (svg, label, title) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tp-view-btn';
        b.innerHTML = `${svg}<span>${label}</span>`;
        b.title = title;
        b.disabled = true;
        b.setAttribute('aria-pressed', 'false');
        return b;
    };
    const textBtn = viewBtn(TEXT_SVG, 'Text', 'Text view');
    const previewBtn = viewBtn('', 'Preview', ''); // look set per file (setPreview)
    const moreBtn = button(MORE_SVG, 'More', 0);
    moreBtn.style.left = '';
    moreBtn.style.right = '86px';

    // Menu entries (icon + label); toggles show check mark when on
    /** @param {string} svg @param {string} label @param {{ disabled?: boolean, pressed?: boolean }} [opts] */
    const item = (svg, label, opts) => {
        const b = button(svg, label, 0, 0, opts);
        b.className = 'tp-menu-item';
        b.style.cssText = '';
        b.innerHTML = `${svg}<span>${label}</span>`;
        return b;
    };
    const hBtn = item(SPLIT_H_SVG, 'Below the list');
    const vBtn = item(SPLIT_V_SVG, 'Right of the list');
    const pBtn = item(POPUP_SVG, 'Popup');
    const themeBtn = item(THEME_SVG, 'Dark mode', { pressed: view.theme === 'dark' });
    const colourBtn = item(COLOUR_SVG, 'Syntax colours');
    const wrapBtn = item(WRAP_SVG, 'Wrap long lines');
    const refreshBtn = item(REFRESH_SVG, 'Reload this file');
    const clearBtn = item(CLEAR_SVG, 'Clear this file from the cache', { disabled: true });
    const clearAllBtn = item(CLEAR_SVG, 'Clear all files from the cache', { disabled: memoryCache.size === 0 });
    const settingsBtn = item(SETTINGS_SVG, 'Full settings …');

    // Small drop-down under its button; closes on any click outside or on entry
    /** @param {HTMLElement} anchor @param {HTMLElement[]} entries @param {boolean} [alignRight] */
    const menu = (anchor, entries, alignRight = false) => {
        const m = document.createElement('div');
        m.className = 'tp-menu';
        m.hidden = true;
        m.append(...entries);
        const close = () => {
            m.hidden = true;
            document.removeEventListener('pointerdown', outside, true);
        };
        /** @param {Event} e */
        const outside = (e) => {
            const t = /** @type {Node} */ (e.target);
            if (!m.contains(t) && !anchor.contains(t)) close();
        };
        anchor.onclick = () => {
            if (!m.hidden) return close();
            m.style.top = `${anchor.offsetTop + anchor.offsetHeight + 4}px`;
            if (alignRight) m.style.right = anchor.style.right;
            else m.style.left = `${anchor.offsetLeft}px`;
            m.hidden = false;
            document.addEventListener('pointerdown', outside, true);
        };
        m.addEventListener('click', (e) => {
            if (/** @type {HTMLElement} */ (e.target).closest('.tp-menu-item')) close();
        });
        return m;
    };
    const layoutMenu = menu(layoutBtn, [hBtn, vBtn, pBtn]);
    const moreMenu = menu(
        moreBtn,
        [settingsBtn, themeBtn, colourBtn, wrapBtn, refreshBtn, clearBtn, clearAllBtn],
        true,
    );

    // Title: file name, with small note below it
    const title = document.createElement('div');
    title.className = 'tp-title tp-well';
    title.style.cssText = `
    position: absolute;
    top: 8px;
    height: 30px;
    left: 232px;
    right: 256px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: left;
    font-family: sans-serif;
  `;
    title.innerHTML = `
    <div style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; line-height:18px; margin-right:4px">
      <strong>File:</strong> <span class="tp-title-name"></span><span class="tp-title-sheet" hidden></span>
    </div>
  `;
    // Properties on/off: small (i) button in the title well, left of "File:"
    const propsBtn = button(PROPS_SVG, 'Display file metadata and properties', 0, 0, { pressed: view.props });
    propsBtn.style.cssText = `
    flex: none;
    width: 24px;
    height: 24px;
    margin-left: -6px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  `;
    title.prepend(propsBtn);
    // Note: tooltip on header
    header.title =
        'Note: this viewer is primarily for text files. Parquet files and spreadsheets may also be viewed (read only). ' +
        'Write mode is only partially supported.';
    const titleName = title.querySelector('.tp-title-name');
    const titleSheet = title.querySelector('.tp-title-sheet');

    // Metadata (second line, full width): dates, size, format, table shape, ...
    const metaLine = document.createElement('div');
    metaLine.className = 'tp-title';
    metaLine.style.cssText = `
    position: absolute;
    top: 44px;
    left: 12px;
    right: 12px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical; /* wraps, cut off with "…" after the lines shown */
    line-height: 15px;
    white-space: normal;
    font: 12px/15px sans-serif;
    opacity: .85;
  `;

    // Version and logo (top right, left of copy button)
    const brand = document.createElement('div');
    brand.className = 'tp-title';
    brand.style.cssText = `
    position: absolute;
    top: 8px;
    height: 30px;
    right: 124px;
    max-width: 124px;
    display: flex;
    align-items: center;
    gap: 8px;
    font: 11px sans-serif;
    opacity: .75;
    white-space: nowrap;
  `;
    // NOTE: not `!== 'undefined'`: minified to `GM_info<"u"`, which editors read as type arguments (brackets then mismatch)
    const version = typeof GM_info === 'object' ? GM_info.script.version : '';
    const logo = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(LOGO) ? LOGO.replace(/\s+/g, '') : '';
    const logoHtml = logo ? `<img src="${logo}" alt="" style="height:18px; width:auto; display:block">` : '';
    const versionHtml = version ? `<span>v${esc(version)}</span>` : '';
    brand.innerHTML = `
    ${logoHtml}
    ${versionHtml}
  `;
    brand.title = version ? `Sharepoint Previewer v${version}` : 'Sharepoint Previewer';

    // Copy button (left of X)
    const copyBtn = document.createElement('button');
    copyBtn.innerHTML = COPY_SVG;
    copyBtn.title = 'Copy';
    copyBtn.style.cssText = `${SQUARE_BTN_CSS} top: 8px; right: 48px; background: #0078d4; color: #fff;`;

    // Close button (red X, top right)
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close (Esc)';
    closeBtn.style.cssText = `
    ${SQUARE_BTN_CSS}
    top: 8px;
    right: 10px;
    background: #d13438;
    color: #fff;
    font: bold 15px sans-serif;
  `;

    // Metadata height: one line at first; drag grip below it to show more lines
    const metaGrip = document.createElement('div');
    metaGrip.className = 'tp-meta-grip';
    metaGrip.title = 'Drag to show more or fewer lines';
    /** @param {number} n */
    const setMetaLines = (n) => {
        view.metaLines = Math.max(1, Math.min(6, n));
        savePref('tp-preview-meta-lines', String(view.metaLines));
        const h = view.props ? view.metaLines * 15 : -4; // hidden: header ends under buttons
        metaLine.style.display = view.props ? '' : 'none';
        metaGrip.style.display = view.props ? '' : 'none';
        propsBtn.setAttribute('aria-pressed', String(view.props));
        metaLine.style.height = `${h}px`;
        metaLine.style.webkitLineClamp = String(view.metaLines);
        header.style.setProperty('--tp-lint-top', `${44 + h + 4}px`); // not on lint: its style is observed
        const lintShown = lint.style.display !== 'none' && lint.style.display !== '';
        header.style.height = `${44 + h + 6 + (lintShown ? 18 : 0)}px`; // room for check line only when shown
    };
    metaGrip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const startY = e.clientY;
        const start = view.metaLines;
        metaGrip.setPointerCapture(e.pointerId);
        metaGrip.classList.add('tp-drag');
        /** @param {PointerEvent} ev */
        const move = (ev) => setMetaLines(start + Math.round((ev.clientY - startY) / 15));
        const up = () => {
            metaGrip.classList.remove('tp-drag');
            metaGrip.removeEventListener('pointermove', move);
            metaGrip.removeEventListener('pointerup', up);
            metaGrip.removeEventListener('pointercancel', up);
        };
        metaGrip.addEventListener('pointermove', move);
        metaGrip.addEventListener('pointerup', up);
        metaGrip.addEventListener('pointercancel', up);
    });
    metaGrip.ondblclick = () => setMetaLines(view.metaLines > 1 ? 1 : 6); // quick open / close

    header.append(
        layoutBtn,
        writeBtn,
        loadAllBtn,
        stopBtn,
        saveBtn,
        uploadBtn,
        title,
        metaLine,
        metaGrip,
        brand,
        moreBtn,
        copyBtn,
        closeBtn,
        layoutMenu,
        moreMenu,
    );

    // Lint bar (only for xml / json / yaml / ifc)
    const lint = document.createElement('div');
    lint.className = 'tp-lint';
    lint.style.display = 'none';

    // Code view
    const content = document.createElement('div');
    content.className = 'tp-content';
    content.tabIndex = 0;

    // "Cache next" bar (bottom, only shown while file is not fully cached)
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'tp-load-more';
    loadMoreBtn.style.cssText = `
    display: none;
    flex: none;
    width: 100%;
    padding: 8px;
    cursor: pointer;
    font: 600 12px sans-serif;
  `;

    // Drag handle on edge next to list (split modes only)
    const splitter = document.createElement('div');
    splitter.className = 'tp-splitter';
    splitter.title = 'Drag to resize';
    splitter.onpointerdown = startDrag;

    header.append(lint); // below metadata line
    setMetaLines(view.metaLines);
    new MutationObserver(() => setMetaLines(view.metaLines)).observe(lint, {
        attributes: true,
        attributeFilter: ['style'],
    });

    // Write mode: whole file in editable text box with line numbers, framed in red (beta)
    const editorWrap = document.createElement('div');
    editorWrap.className = 'tp-editor-wrap';
    editorWrap.style.display = 'none';
    const gutter = document.createElement('pre');
    gutter.className = 'tp-gutter';
    const editor = document.createElement('textarea');
    editor.className = 'tp-editor';
    editor.spellcheck = false;
    editor.wrap = 'off'; // no wrap: line numbers stay next to their lines
    editorWrap.append(gutter, editor);

    // Line numbers follow text and its scroll
    let gutterQueued = false;

    const updateGutter = () => {
        gutterQueued = false;
        const n = editor.value.split('\n').length;
        if (Number(gutter.dataset.lines) === n) return;
        gutter.dataset.lines = String(n);
        gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    };
    editor.addEventListener('input', () => {
        if (!gutterQueued) {
            gutterQueued = true;
            requestAnimationFrame(updateGutter);
        }
    });
    editor.addEventListener('scroll', () => {
        gutter.scrollTop = editor.scrollTop;
    });

    // Write mode in table view: delimiter and quote style for saved file
    const csvBar = document.createElement('div');
    csvBar.className = 'tp-csv-bar';
    const quoteOptions = Object.entries(QUOTE_MODES)
        .map(([k, t]) => `<option value="${k}">${t}</option>`)
        .join('');
    csvBar.innerHTML = `
    <select class="tp-csv-sep" title="Delimiter of the saved file"></select>
    <select class="tp-csv-quote" title="Quote style of the saved file">
      <option value="">Quotes: as in the file</option>
      ${quoteOptions}
    </select>`;
    // 3D view: canvas with status line (shown instead of text)
    const stage3d = document.createElement('div');
    stage3d.style.cssText = 'display:none; position:relative; flex:1; min-height:0; background:var(--tp-bg);';
    const canvas3d = document.createElement('canvas');
    canvas3d.style.cssText = 'display:block; width:100%; height:100%; touch-action:none; cursor:grab;';
    canvas3d.title = 'Drag: rotate · right drag or Shift + drag: move · wheel: zoom · double-click: fit';
    const status3d = document.createElement('div');
    status3d.style.cssText =
        'position:absolute; left:8px; bottom:6px; font:12px sans-serif; color:var(--tp-fg); opacity:.75; pointer-events:none;';
    stage3d.append(canvas3d, status3d);
    // Cache progress (bottom left)
    const progress = document.createElement('div');
    progress.className = 'tp-progress';
    progress.innerHTML = '<div class="tp-progress-bar"><div class="tp-progress-fill"></div></div><span></span>';
    // (children written just above)
    const progressBar = /** @type {HTMLElement} */ (progress.firstElementChild);
    const progressFill = /** @type {HTMLElement} */ (progressBar.firstElementChild);
    const progressText = /** @type {HTMLElement} */ (progress.lastElementChild);
    // Status bar (fixed height): cache state left, view switch right
    const statusBar = document.createElement('div');
    statusBar.className = 'tp-statusbar';
    // Spreadsheets: sheet or table shown; its menu lists sheets and tables side by side
    const sheetPicker = createPicker(statusBar, (list, i) => v.selectSheet?.(i, list ? 'tables' : 'sheets'));
    const views = document.createElement('div');
    views.className = 'tp-views';
    views.append(textBtn, previewBtn, sheetPicker.button);
    // Format: recognised or chosen (any format can be chosen: its reader tries the file)
    const formatPicker = createPicker(statusBar, (list, i) => chooseFormat(FORMAT_LISTS[list][1][i]));
    const formatBar = document.createElement('div');
    formatBar.className = 'tp-views tp-format';
    formatBar.append(formatPicker.button);
    // Text size: − 100 % + (value: back to 100 %)
    const zoomBar = document.createElement('div');
    zoomBar.className = 'tp-views tp-zoom';
    zoomBar.innerHTML = `
    <button type="button" class="tp-view-btn" title="Smaller text (Ctrl −, Ctrl + wheel)">−</button>
    <button type="button" class="tp-view-btn tp-zoom-value" title="Text size: back to 100 % (Ctrl 0)"></button>
    <button type="button" class="tp-view-btn" title="Larger text (Ctrl +, Ctrl + wheel)">+</button>`;
    const [zoomOut, zoomValue, zoomIn] = /** @type {HTMLButtonElement[]} */ ([...zoomBar.children]);
    statusBar.append(progress, formatBar, zoomBar, views);
    box.append(header, csvBar, content, stage3d, editorWrap, loadMoreBtn, statusBar, splitter);

    // Keep panel's events away from SharePoint's handlers (split mode: inside its DOM)
    for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown', 'keydown', 'keyup', 'contextmenu', 'wheel']) {
        box.addEventListener(type, (e) => e.stopPropagation());
    }

    /** @type {Viewer} */
    const v = {
        backdrop,
        box,
        header,
        layoutBtn,
        hBtn,
        vBtn,
        pBtn,
        refreshBtn,
        loadAllBtn,
        stopBtn,
        clearBtn,
        clearAllBtn,
        saveBtn,
        uploadBtn,
        writeBtn,
        textBtn,
        previewBtn,
        sheetPicker,
        formatPicker,
        stage3d,
        canvas3d,
        status3d,
        progress,
        progressBar,
        progressFill,
        progressText,
        editor,
        editorWrap,
        updateGutter,
        title,
        titleName,
        titleSheet,
        metaLine,
        csvBar,
        copyBtn,
        closeBtn,
        lint,
        content,
        loadMoreBtn,
        splitter,
        mode: 'popup',
        text: '',
        loadToken: 0,
        originalBodyStyle: document.body.getAttribute('style'),
    };
    setPreview(v, null);

    // Popup: drag header (not its buttons, menus or properties grip) to move window
    header.addEventListener('pointerdown', (e) => {
        if (v.mode !== 'popup' || e.button !== 0) return;
        if (
            /** @type {HTMLElement} */ (e.target).closest(
                'button, select, input, textarea, a, .tp-menu, .tp-meta-grip, .tp-lint',
            )
        )
            return;
        if (metaLine.contains(/** @type {Node} */ (e.target))) return; // properties stay selectable
        startMove(e, box, POPUP_POS_KEY);
    });

    /** @param {KeyboardEvent} e */
    const onEscape = (e) => {
        if (e.key === 'Escape' && viewer === v) {
            e.stopPropagation();
            for (const p of [sheetPicker, formatPicker]) if (!p.menu.hidden) return void p.close(); // open drop-down first
            closeViewer();
        }
    };

    // Window resized -> recompute horizontal split (it uses pixel positions)
    const onResize = () => {
        if (viewer === v && !v.selfResize && v.mode !== 'popup') layoutPage(v, v.mode);
    };
    document.addEventListener('keydown', onEscape, true);
    window.addEventListener('resize', onResize);
    v.removeListeners = () => {
        document.removeEventListener('keydown', onEscape, true);
        window.removeEventListener('resize', onResize);
    };

    backdrop.onclick = closeViewer;
    closeBtn.onclick = closeViewer;
    themeBtn.onclick = () => {
        view.theme = view.theme === 'dark' ? 'light' : 'dark';
        savePref(THEME_KEY, view.theme);
        box.classList.remove('tp-dark', 'tp-light');
        box.classList.add(`tp-${view.theme}`);
        themeBtn.setAttribute('aria-pressed', String(view.theme === 'dark'));
    };
    hBtn.onclick = () => v.mode !== 'horizontal' && setMode('horizontal');
    vBtn.onclick = () => v.mode !== 'vertical' && setMode('vertical');
    pBtn.onclick = () => v.mode !== 'popup' && setMode('popup');
    refreshBtn.onclick = () => v.file && showFile(v.file.name, v.file.url, true);
    stopBtn.onclick = () => {
        if (v.writeMode) {
            // in write mode: cancel all changes (unsaved and saved)
            discardEdits(v);
            exitWriteView(v);
            return;
        }
        if (!v.busy) return;
        v.userStopped = true;
        cancelLoad(v, true);
        setBusy(v, false);
    };
    clearBtn.onclick = () => v.file && clearCached(v);
    clearAllBtn.onclick = () => clearAllCached();
    settingsBtn.onclick = () => openSettingsForm();
    writeBtn.onclick = () => (v.writeMode ? leaveWrite() : enterWrite(v));
    // 3D choice remembered for next IFC files (also across reloads)
    /** @param {boolean} on */
    const set3d = (on) => {
        view.show3d = on;
        savePref('tp-preview-3d', on ? '1' : '0');
    };

    textBtn.onclick = () => {
        if (v.view3d) {
            set3d(false);
            close3d(v);
        }
        if (tableView(v)) showView('table', false);
        else if (markdownView(v)) showView('markdown', false);
        updateViews(v);
    };
    previewBtn.onclick = () => {
        const kind = previewOf(v.lang);
        if (kind === '3d' && !v.view3d) {
            set3d(true);
            toggle3d(v);
        } else if (kind === 'table' && !tableView(v)) showView('table', true);
        else if (kind === 'md' && !markdownView(v)) showView('markdown', true);
        updateViews(v);
    };
    // Table or Markdown view on / off (remembered for files of its type)
    /** @param {'table'|'markdown'} key @param {boolean} on */
    const showView = (key, on) => {
        if (v.writeMode && v.dirty) {
            alert('Please save your changes first, then switch the view.');
            return void flash(saveBtn);
        }
        close3d(v); // back to text / table / Markdown
        const k = viewKey(v, key); // logs: own choice
        view[k] = on;
        savePref(VIEW_KEYS[k], on ? '1' : '0');
        applyColour(); // each view has its own colour choice
        if (!v.writeMode) return void v.rerender?.();
        exitWriteView(v); // Markdown, log table: shown from saved text, edit ends
        if (k === 'table') enterWrite(v); // edit on in other view (table <-> text), on saved text
    };
    // Back to read mode (edit button again): unsaved edits only after asking
    const leaveWrite = () => {
        if (!v.writeMode) return;
        if (v.dirty) {
            // only unsaved edits are at stake here; saved changes stay
            flash(saveBtn);
            if (!confirm('You have unsaved changes. Discard them?')) return void flash(saveBtn);
        }
        exitWriteView(v);
    };
    // Save stages edits; upload hands saved state to SharePoint
    saveBtn.onclick = () => {
        if (!v.writeMode || !v.dirty) return;
        v.staged = editedText(v);
        const src = v.source;
        if (src.originalText == null) src.originalText = src.text; // for cancel / discard
        src.text = v.staged;
        v.text = v.staged;
        src.lintResult = null;
        // Saved text is checked again: now if colours are on, else once they are switched on
        src.needsLint = true;
        if (colourOn(v)) v.relint?.();
        v.dirty = false;
        saveBtn.disabled = true;
        uploadBtn.disabled = false;
    };
    uploadBtn.onclick = () => {
        if (v.dirty) {
            alert('Please save your latest changes first, then upload.');
            flash(saveBtn);
            return;
        }
        if (v.staged == null) return;
        const file = v.file;
        uploadEdits(v, v.staged).then((ok) => {
            if (viewer !== v || v.file !== file) return; // viewer closed / other file meanwhile
            if (!ok) return void flash(uploadBtn);
            v.staged = null;
            uploadBtn.disabled = true;
            v.rerender?.();
        });
    };
    editor.addEventListener('input', () => markEdited(v));
    loadAllBtn.onclick = () => {
        const src = v.source;
        if (!src || src.done) return;
        const big = src.total > LARGE_FILE_BYTES;
        if (big && !confirm(`This file is large (${formatBytes(src.total)}). Cache all of it?`)) return;
        if (!makeRoom(v, src.total - src.loaded)) return;
        v.loadAll();
    };
    const applyColour = () => colourBtn.setAttribute('aria-pressed', String(colourOn(v)));
    v.applyColour = applyColour;
    colourBtn.onclick = () => {
        const key = colourKey(v);
        colourPrefs[key] = !colourPrefs[key];
        savePref(COLOUR_KEYS[key], colourPrefs[key] ? '1' : '0');
        applyColour();
        v.rerender?.();
        // Saved edit not yet checked: check now that colours are on
        if (colourOn(v) && v.source?.needsLint) v.relint?.();
    };
    applyColour();

    const applyWrap = () => {
        content.classList.toggle('tp-wrap', view.wrap);
        wrapBtn.setAttribute('aria-pressed', String(view.wrap));
    };
    propsBtn.onclick = () => {
        view.props = !view.props;
        savePref(PROPS_KEY, view.props ? '1' : '0');
        setMetaLines(view.metaLines);
    };
    wrapBtn.onclick = () => {
        view.wrap = !view.wrap;
        savePref(WRAP_KEY, view.wrap ? '1' : '0');
        applyWrap();
    };
    applyWrap();

    // Text size (content area and editor): CSS variable; text and table views are laid out anew
    // (their unfilled blocks keep heights measured at the old size), keeping the position in the file
    /** @param {number} z */
    const applyZoom = (z) => {
        for (const el of [content, editorWrap]) el.style.setProperty('--tp-zoom', String(z));
        zoomValue.textContent = `${Math.round(z * 100)} %`;
        zoomOut.disabled = z <= ZOOM_RANGE[0];
        zoomIn.disabled = z >= ZOOM_RANGE[1];
    };
    applyZoom(view.zoom);
    let relayout = 0;
    let scrollShare = 0;
    /** @param {number} z */
    const setZoom = (z) => {
        z = Math.round(Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], z)) * 100) / 100;
        if (z === view.zoom) return;
        view.zoom = z;
        savePref(ZOOM_KEY, String(z));
        applyZoom(z);
        if (v.writeMode || v.view3d) return; // editor: CSS alone; CSV cell edits are not redrawn
        if (!relayout) scrollShare = content.scrollTop / Math.max(1, content.scrollHeight);
        clearTimeout(relayout);
        relayout = setTimeout(() => {
            relayout = 0;
            if (viewer !== v || v.writeMode || v.view3d) return;
            v.rerender?.();
            content.scrollTop = scrollShare * content.scrollHeight;
        }, 150);
    };
    /** @param {number} steps */
    const zoomBy = (steps) => setZoom(view.zoom + steps * ZOOM_STEP);
    zoomOut.onclick = () => zoomBy(-1);
    zoomIn.onclick = () => zoomBy(1);
    zoomValue.onclick = () => setZoom(1);
    let wheel = 0;
    box.addEventListener(
        'wheel',
        (e) => {
            const t = /** @type {Node} */ (e.target);
            if (!(e.ctrlKey || e.metaKey) || !(content.contains(t) || editorWrap.contains(t))) return;
            e.preventDefault(); // not the page's zoom
            wheel += e.deltaY;
            const steps = Math.trunc(wheel / WHEEL_STEP);
            if (!steps) return;
            wheel -= steps * WHEEL_STEP;
            zoomBy(-steps);
        },
        { passive: false },
    );

    // Text view: whole file selected (also lines not drawn yet), and copied as such
    const selectAll = () => {
        const lines = content.firstElementChild;
        if (!lines?.classList.contains('tp-lines')) return false; // table, Markdown: as the browser does
        getSelection()?.selectAllChildren(lines);
        return true;
    };
    content.addEventListener('copy', (e) => {
        const lines = content.firstElementChild;
        const s = getSelection();
        if (!lines || !s || !v.text || s.anchorNode !== lines || s.focusNode !== lines) return;
        const ends = [s.anchorOffset, s.focusOffset].sort((a, b) => a - b);
        if (ends[0] !== 0 || ends[1] !== lines.childNodes.length) return;
        e.clipboardData?.setData('text/plain', v.text);
        e.preventDefault();
    });

    // Keys in the content area (once clicked into) or editor: Ctrl / ⌘ with + − 0 (text size), A (select all)
    box.addEventListener('keydown', (e) => {
        const t = /** @type {Node} */ (e.target);
        if (!(e.ctrlKey || e.metaKey) || e.altKey || !(content.contains(t) || t === editor)) return;
        if (e.key === '+' || e.key === '=') zoomBy(1);
        else if (e.key === '-') zoomBy(-1);
        else if (e.key === '0') setZoom(1);
        else if (e.key.toLowerCase() !== 'a' || t !== content || !selectAll()) return;
        e.preventDefault();
    });

    copyBtn.onclick = async () => {
        try {
            if (v.source && !v.source.done && !v.source.isSheet) {
                // (spreadsheets: only the sheet shown is copied, nothing more to cache)
                const big = v.source.total > LARGE_FILE_BYTES;
                if (big && !confirm('This text file is large are you sure you want to load it all into the previewer?'))
                    return;
                copyBtn.disabled = true;
                const ok = await v.loadAll();
                copyBtn.disabled = false;
                if (!ok) throw new Error('caching failed');
            }
            await navigator.clipboard.writeText(
                v.tableEditing ? v.lineView.csvText() : v.writeMode ? v.editor.value : v.text,
            );
            copyBtn.innerHTML = CHECK_SVG;
            copyBtn.title = 'Copied!';
            copyBtn.style.background = '#107c41';
        } catch (_err) {
            copyBtn.innerHTML = '!';
            copyBtn.title = 'Copy failed';
            copyBtn.style.background = '#a80000';
        }
        setTimeout(() => {
            copyBtn.innerHTML = COPY_SVG;
            copyBtn.title = 'Copy';
            copyBtn.style.background = '#0078d4';
        }, 2000);
    };

    // Appended to <html>, not <body>: in split mode <body> is shrunk (see setMode)
    document.documentElement.append(backdrop, box);
    return v;
}
