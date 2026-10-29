// Viewer panel: elements, buttons, editor and gutter

// ===========================================================================
// IMPORTS
// ===========================================================================

import { COLOUR_KEYS } from '../_core/prefs.ts';
import { colourPrefs } from '../_core/prefs.ts';
import { PROPS_KEY } from '../_core/prefs.ts';
import { savePref } from '../_core/prefs.ts';
import { THEME_KEY } from '../_core/prefs.ts';
import { view } from '../_core/prefs.ts';
import { WRAP_KEY } from '../_core/prefs.ts';
import { ZOOM_KEY } from '../_core/prefs.ts';
import { ZOOM_RANGE } from '../_core/prefs.ts';
import { openSettingsForm } from '../_core/settings-form.ts';
import { POPUP_POS_KEY } from '../_core/settings-form.ts';
import { POPUP_SIZE_KEY } from '../_core/settings-form.ts';
import { LARGE_FILE_BYTES } from '../_core/settings.ts';
import { formatBytes } from '../_core/util.ts';
import { isSelectAllKey } from '../_core/util.ts';
import { typing } from '../_core/util.ts';
import { barButton } from '../ui/bar.ts';
import { closeButton } from '../ui/bar.ts';
import { createBar } from '../ui/bar.ts';
import { placeBelow } from '../ui/bar.ts';
import { ABOUT_SVG } from '../ui/icons.ts';
import { CHECK_SVG } from '../ui/icons.ts';
import { CLEAR_SVG } from '../ui/icons.ts';
import { COLOUR_SVG } from '../ui/icons.ts';
import { COPY_SVG } from '../ui/icons.ts';
import { CUBE_SVG } from '../ui/icons.ts';
import { LINK_SVG } from '../ui/icons.ts';
import { LOAD_ALL_SVG } from '../ui/icons.ts';
import { MORE_SVG } from '../ui/icons.ts';
import { NEW_FILE_SVG } from '../ui/icons.ts';
import { POPUP_SVG } from '../ui/icons.ts';
import { PROPS_SVG } from '../ui/icons.ts';
import { REFRESH_SVG } from '../ui/icons.ts';
import { SAVE_SVG } from '../ui/icons.ts';
import { SETTINGS_SVG } from '../ui/icons.ts';
import { SPLIT_H_SVG } from '../ui/icons.ts';
import { SPLIT_V_SVG } from '../ui/icons.ts';
import { STOP_SVG } from '../ui/icons.ts';
import { TEXT_SVG } from '../ui/icons.ts';
import { THEME_SVG } from '../ui/icons.ts';
import { UPLOAD_SVG } from '../ui/icons.ts';
import { WRAP_SVG } from '../ui/icons.ts';
import { WRITE_SVG } from '../ui/icons.ts';
import { FORMAT_LISTS } from '../readers/formats.ts';
import { wireLink } from '../ui/link.ts';
import { keepSize } from '../ui/move.ts';
import { startMove } from '../ui/move.ts';
import { createPicker } from '../ui/picker.ts';
import { QUOTE_MODES } from '../view/table.ts';
import { zenDropSelection } from '../zen/zen.ts';
import { zenEscape } from '../zen/zen.ts';
import { zenProps } from '../zen/zen.ts';
import { zenTheme } from '../zen/zen.ts';
import { cancelLoad } from './cache.ts';
import { clearAllCached } from './cache.ts';
import { clearCached } from './cache.ts';
import { makeRoom } from './cache.ts';
import { memoryCache } from './cache.ts';
import { cancelEdits } from './edit.ts';
import { discardEdits } from './edit.ts';
import { editedText } from './edit.ts';
import { enterWrite } from './edit.ts';
import { exitWriteView } from './edit.ts';
import { flash } from './edit.ts';
import { markEdited } from './edit.ts';
import { uploadEdits } from './edit.ts';
import { layoutPage } from './layout.ts';
import { setMode } from './layout.ts';
import { startDrag } from './layout.ts';
import { renamable } from './names.ts';
import { startRename } from './names.ts';
import { target } from './names.ts';
import { chooseFormat } from './open.ts';
import { closeViewer } from './open.ts';
import { newFile } from './open.ts';
import { NEW_FILE_ON } from './open.ts';
import { showFile } from './open.ts';
import { shownUrl } from './open.ts';
import { viewer } from './open.ts';
import { setBusy } from './status.ts';
import { close3d } from './view3d.ts';
import { RELOAD_TITLE } from './view3d.ts';
import { reload3d } from './view3d.ts';
import { toggle3d } from './view3d.ts';
import { colourKey } from './views.ts';
import { colourOn } from './views.ts';
import { markdownView } from './views.ts';
import { previewOf } from './views.ts';
import { setPreview } from './views.ts';
import { tableView } from './views.ts';
import { updateViews } from './views.ts';
import { viewKey } from './views.ts';

import type { Viewer } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Preferences of the views switched by Text / Preview
const VIEW_KEYS: Record<string, string> = {
    table: 'tp-preview-table',
    logTable: 'tp-preview-log-table',
    markdown: 'tp-preview-markdown',
};

const ZOOM_STEP = 0.1;
const WHEEL_STEP = 40; // wheel distance per zoom step (mouse notch ~100, touchpad pinch: small steps)

// ===========================================================================
// METHODS
// ===========================================================================

export function createViewer(): Viewer {
    // Dark backdrop (popup mode only)
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.5);
    z-index: 2147483000; /* above Sharepoint's own panels (settings, details, ...) */
  `;

    // Panel
    const box = document.createElement('div');
    box.className = `tp-viewer tp-${view.theme}`;

    // Header: bar (cf. /src/ui/bar.ts), properties below it
    const header = document.createElement('div');
    header.className = 'tp-header tp-viewer-header';

    // Bar: [layout ▾] [edit] [stop] [save] [upload] [cache all] [(i) link File: name] [⋯] [copy] [✕] (version: About, settings)
    const button = (svg: string, title: string, disabled = true) => {
        const btn = barButton(svg, title);
        btn.disabled = disabled; // off until a file is shown
        return btn;
    };
    const layoutBtn = button(SPLIT_H_SVG, 'Layout: below the list / right of the list / popup', false);
    const writeBtn = button(WRITE_SVG, 'Edit (text files only)');
    writeBtn.setAttribute('aria-pressed', 'false');
    const loadAllBtn = button(LOAD_ALL_SVG, 'Cache the whole file');
    const stopBtn = button(STOP_SVG, 'Stop caching'); // also: cancel changes
    const saveBtn = button(SAVE_SVG, 'Save: keep the changes, ready for upload (Ctrl+S)');
    const uploadBtn = button(UPLOAD_SVG, 'Upload the saved changes to Sharepoint');
    // View switch (status bar, bottom right): Text | Preview (Table, 3D or Markdown, by file type)
    const viewBtn = (svg: string, label: string, title: string) => {
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
    const moreBtn = barButton(MORE_SVG, 'More');

    // Menu entries (icon + label); toggles show check mark when on
    const item = (
        svg: string,
        label: string,
        { disabled = false, pressed }: { disabled?: boolean; pressed?: boolean } = {},
    ) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tp-menu-item';
        b.innerHTML = `${svg}<span>${label}</span>`;
        b.title = label;
        b.disabled = disabled;
        if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
        return b;
    };
    const hBtn = item(SPLIT_H_SVG, 'Below the list');
    const vBtn = item(SPLIT_V_SVG, 'Right of the list');
    const pBtn = item(POPUP_SVG, 'Popup');
    const themeBtn = item(THEME_SVG, 'Dark mode', { pressed: view.theme === 'dark' });
    themeBtn.dataset.themeToggle = ''; // pressed: dark (also if switched in the Zen list)
    const colourBtn = item(COLOUR_SVG, 'Syntax colours');
    const wrapBtn = item(WRAP_SVG, 'Wrap long lines');
    const refreshBtn = item(REFRESH_SVG, 'Reload this file');
    const reload3dBtn = item(CUBE_SVG, 'Reload ifc-lite');
    reload3dBtn.title = RELOAD_TITLE;
    const clearBtn = item(CLEAR_SVG, 'Clear this file from the cache', { disabled: true });
    const clearAllBtn = item(CLEAR_SVG, 'Clear all files from the cache', { disabled: memoryCache.size === 0 });
    const settingsBtn = item(SETTINGS_SVG, 'Full settings …');
    const aboutBtn = item(ABOUT_SVG, 'About …');

    // Small drop-down under its button; closes on any click outside or on entry
    const menu = (anchor: HTMLElement, entries: HTMLElement[], alignRight = false) => {
        const m = document.createElement('div');
        m.className = 'tp-menu';
        m.hidden = true;
        m.append(...entries);
        const close = () => {
            m.hidden = true;
            document.removeEventListener('pointerdown', outside, true);
        };
        const outside = (e: Event) => {
            const t = e.target as Node;
            if (!m.contains(t) && !anchor.contains(t)) close();
        };
        anchor.onclick = () => {
            if (!m.hidden) return close();
            m.hidden = false; // shown first: measured
            placeBelow(m, anchor, alignRight);
            document.addEventListener('pointerdown', outside, true);
        };
        m.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.tp-menu-item')) close();
        });
        return m;
    };
    const layoutMenu = menu(layoutBtn, [hBtn, vBtn, pBtn]);
    const moreMenu = menu(
        moreBtn,
        [settingsBtn, themeBtn, colourBtn, wrapBtn, refreshBtn, reload3dBtn, clearBtn, clearAllBtn, aboutBtn],
        true,
    );

    // Well: (i) link File: name (new file: a button)
    const title = document.createElement('div');
    title.className = 'tp-title tp-well';
    title.innerHTML = `
    <div style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; line-height:18px; margin-right:4px">
      <strong>File:</strong> <span class="tp-title-name"></span><span class="tp-title-sheet" hidden></span>
    </div>
  `;
    // Small buttons in the well, left of "File:": properties on/off (i), link (copied on click)
    const propsBtn = barButton(PROPS_SVG, 'Display file metadata and properties', 'tp-well-btn');
    propsBtn.setAttribute('aria-pressed', String(view.props));
    const linkBtn = barButton(LINK_SVG, 'Copy the link', 'tp-well-btn');
    title.prepend(propsBtn, linkBtn);
    // New file: in the title well while no file is open
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'tp-new-file';
    newBtn.innerHTML = `${NEW_FILE_SVG}<span>New file</span>`;
    newBtn.title = NEW_FILE_ON;
    newBtn.hidden = true;
    title.append(newBtn);
    // Note: tooltip on header
    header.title =
        'Note: this viewer is primarily for text files. Parquet files and spreadsheets may also be viewed (read only). ' +
        'Text files can be edited.';
    const titleName = title.querySelector('.tp-title-name') as HTMLElement; // in the title's HTML
    titleName.onclick = () => startRename(v); // text: write mode only; read-only files: a copy
    const titleSheet = title.querySelector('.tp-title-sheet') as HTMLElement;

    // Metadata (below the bar, full width): dates, size, format, table shape, ...
    const metaLine = document.createElement('div');
    metaLine.className = 'tp-title tp-bar-meta';

    // Copy (blue) and close (red ✕), right end
    const copyBtn = barButton(COPY_SVG, 'Copy', 'tp-bar-copy');
    copyBtn.classList.remove('tp-mode-btn'); // own colours, as the close button
    const closeBtn = closeButton('Close (Esc)');

    // Metadata height: one line at first; drag grip below it to show more lines
    const metaGrip = document.createElement('div');
    metaGrip.className = 'tp-meta-grip';
    metaGrip.title = 'Drag to show more or fewer lines';
    const setMetaLines = (n: number) => {
        view.metaLines = Math.max(1, Math.min(6, n));
        savePref('tp-preview-meta-lines', String(view.metaLines));
        const h = view.props ? view.metaLines * 15 : -4; // hidden: header ends under buttons
        const top = (bar.offsetHeight || 46) - 2; // below the bar (one row or two; not shown yet: one)
        metaLine.style.display = view.props ? '' : 'none';
        metaGrip.style.display = view.props ? '' : 'none';
        propsBtn.setAttribute('aria-pressed', String(view.props));
        metaLine.style.top = `${top}px`;
        metaLine.style.height = `${h}px`;
        metaLine.style.webkitLineClamp = String(view.metaLines);
        header.style.setProperty('--tp-lint-top', `${top + h + 4}px`); // not on lint: its style is observed
        const lintShown = lint.style.display !== 'none' && lint.style.display !== '';
        header.style.height = `${top + h + 6 + (lintShown ? 18 : 0)}px`; // room for check line only when shown
    };
    metaGrip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const startY = e.clientY;
        const start = view.metaLines;
        metaGrip.setPointerCapture(e.pointerId);
        metaGrip.classList.add('tp-drag');
        const move = (ev: PointerEvent) => setMetaLines(start + Math.round((ev.clientY - startY) / 15));
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

    const { bar, stop: stopBar } = createBar(
        {
            start: [layoutBtn, writeBtn, stopBtn, saveBtn, uploadBtn, loadAllBtn], // edit … upload: as the Zen list's
            well: title,
            end: [moreBtn, copyBtn, closeBtn],
        },
        () => setMetaLines(view.metaLines), // properties below the bar's rows
    );
    header.append(bar, metaLine, metaGrip, layoutMenu, moreMenu);

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

    // Write mode: whole file in editable text box with line numbers, framed in red
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
    canvas3d.title =
        'Click: select · drag: rotate · right drag or Shift + drag: move · wheel: zoom · double-click: fit';
    const status3d = document.createElement('div');
    status3d.style.cssText =
        'position:absolute; left:8px; bottom:6px; font:12px sans-serif; color:var(--tp-fg); opacity:.75; pointer-events:none;';
    stage3d.append(canvas3d, status3d);
    // Cache progress (bottom left)
    const progress = document.createElement('div');
    progress.className = 'tp-progress';
    progress.innerHTML = '<div class="tp-progress-bar"><div class="tp-progress-fill"></div></div><span></span>';
    // (children written just above)
    const progressBar = progress.firstElementChild as HTMLElement;
    const progressFill = progressBar.firstElementChild as HTMLElement;
    const progressText = progress.lastElementChild as HTMLElement;
    // Status bar (fixed height): cache state left, view switch right
    const statusBar = document.createElement('div');
    statusBar.className = 'tp-statusbar';
    // Spreadsheets: sheet or table shown; its menu lists sheets and tables side by side
    const sheetPicker = createPicker(statusBar, (list, i) => v.selectSheet?.(i, list));
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
    const [zoomOut, zoomValue, zoomIn] = [...zoomBar.children] as HTMLButtonElement[];
    statusBar.append(progress, formatBar, zoomBar, views);
    box.append(header, csvBar, content, stage3d, editorWrap, loadMoreBtn, statusBar, splitter);

    // Keep panel's events away from Sharepoint's handlers (split mode: inside its DOM)
    for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown', 'keydown', 'keyup', 'contextmenu', 'wheel']) {
        box.addEventListener(type, (e) => e.stopPropagation());
    }

    const v: Viewer = {
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
        newBtn,
        linkBtn,
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
        showProps: () => setMetaLines(view.metaLines),
    };
    setPreview(v, null);

    // Popup: drag header (not its buttons, menus or properties grip) to move window
    header.addEventListener('pointerdown', (e) => {
        if (v.mode !== 'popup' || e.button !== 0) return;
        if ((e.target as HTMLElement).closest('button, select, input, textarea, a, .tp-menu, .tp-meta-grip, .tp-lint'))
            return;
        if (metaLine.contains(e.target as Node)) return; // properties stay selectable
        startMove(e, box, POPUP_POS_KEY);
    });

    // Esc: open drop-down first, then write mode (back to reading, as the edit button), then viewer; settings form: its own
    const onEscape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || viewer !== v || document.querySelector('.tp-settings')) return;
        if ((e.target as HTMLElement).classList?.contains('tp-name-input')) return; // name box: its own Esc
        e.stopPropagation();
        for (const p of [sheetPicker, formatPicker]) if (!p.menu.hidden) return void p.close();
        // whatever is selected: the content's text (not in the editor: its own Esc), the Zen list's items; all of it at once
        const s = getSelection();
        const marked = !!s && !s.isCollapsed && content.contains(s.anchorNode);
        if (marked) s?.removeAllRanges();
        if (zenDropSelection() || marked) return;
        if (zenEscape()) return; // Zen list: its menus, then its edit mode
        if (v.writeMode) return void leaveWrite(); // only back to reading: Esc again closes
        closeViewer();
    };

    // Window resized -> recompute horizontal split (it uses pixel positions)
    const onResize = () => {
        if (viewer === v && !v.selfResize && v.mode !== 'popup') layoutPage(v, v.mode);
    };
    document.addEventListener('keydown', onEscape, true);
    window.addEventListener('resize', onResize);
    // Popup resized by the user (corner bottom right): size kept for next time
    const sizeObserver = keepSize(box, POPUP_SIZE_KEY, () => v.mode === 'popup');
    v.removeListeners = () => {
        document.removeEventListener('keydown', onEscape, true);
        document.removeEventListener('keydown', onSelectAll, true);
        window.removeEventListener('resize', onResize);
        stopBar();
        sizeObserver.disconnect();
    };

    backdrop.onclick = closeViewer;
    closeBtn.onclick = closeViewer;
    themeBtn.onclick = () => toggleTheme();
    hBtn.onclick = () => v.mode !== 'horizontal' && setMode('horizontal');
    vBtn.onclick = () => v.mode !== 'vertical' && setMode('vertical');
    pBtn.onclick = () => v.mode !== 'popup' && setMode('popup');
    refreshBtn.onclick = () => v.file && showFile(v.file.name, v.file.url, true);
    reload3dBtn.onclick = () => void reload3d(v);
    stopBtn.onclick = () => {
        if (v.writeMode) return void cancelEdits(v); // in write mode: cancel all changes (asks first)
        if (!v.busy) return;
        v.userStopped = true;
        cancelLoad(v, true);
        setBusy(v, false);
    };
    clearBtn.onclick = () => v.file && clearCached(v);
    clearAllBtn.onclick = () => clearAllCached();
    settingsBtn.onclick = () => openSettingsForm();
    aboutBtn.onclick = () => openSettingsForm('about');
    newBtn.onclick = () => newFile();
    writeBtn.onclick = () => (v.writeMode ? leaveWrite() : enterWrite(v));
    // 3D choice remembered for next IFC files (also across reloads)
    const set3d = (on: boolean) => {
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
    const showView = (key: 'table' | 'markdown', on: boolean) => {
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
    // Save stages edits; upload hands saved state to Sharepoint
    saveBtn.onclick = () => {
        const src = v.source;
        if (!v.writeMode || !v.dirty || !src) return;
        const staged = editedText(v);
        v.staged = staged;
        v.stagedName = v.newName ?? null;
        if (src.originalText == null) src.originalText = src.text; // for cancel / discard
        src.text = staged;
        v.text = staged;
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
        const to = target(v, v.stagedName);
        uploadEdits(v, v.staged).then((ok) => {
            if (viewer !== v || v.file !== file) return; // viewer closed / other file meanwhile
            if (!ok) return void flash(uploadBtn);
            if (to.isNew) {
                discardEdits(v); // the original stays as it was
                return void showFile(to.name, to.url, true);
            }
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
        v.loadAll?.();
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
    // Link: clean URL of the file shown (a link file: where it leads), else of the folder
    wireLink(linkBtn, () => shownUrl(v));
    propsBtn.onclick = () => toggleProps();
    wrapBtn.onclick = () => {
        view.wrap = !view.wrap;
        savePref(WRAP_KEY, view.wrap ? '1' : '0');
        applyWrap();
    };
    applyWrap();

    // Text size (content area and editor): CSS variable; text and table views are laid out anew
    // (their unfilled blocks keep heights measured at the old size), keeping the position in the file
    const applyZoom = (z: number) => {
        for (const el of [content, editorWrap]) el.style.setProperty('--tp-zoom', String(z));
        zoomValue.textContent = `${Math.round(z * 100)} %`;
        zoomOut.disabled = z <= ZOOM_RANGE[0];
        zoomIn.disabled = z >= ZOOM_RANGE[1];
    };
    applyZoom(view.zoom);
    let relayout = 0;
    let scrollShare = 0;
    const setZoom = (z: number) => {
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
    const zoomBy = (steps: number) => setZoom(view.zoom + steps * ZOOM_STEP);
    zoomOut.onclick = () => zoomBy(-1);
    zoomIn.onclick = () => zoomBy(1);
    zoomValue.onclick = () => setZoom(1);
    let wheel = 0;
    box.addEventListener(
        'wheel',
        (e) => {
            const t = e.target as Node;
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

    // Ctrl / ⌘ + A with the pointer over the content (wherever the focus is; not typing in a field, e.g. the editor
    // or a table cell): all of the content selected (text view: the whole file, also lines not drawn yet, copied as such)
    let overContent = false;
    content.addEventListener('pointerenter', () => {
        overContent = true;
    });
    content.addEventListener('pointerleave', () => {
        overContent = false;
    });
    const onSelectAll = (e: KeyboardEvent) => {
        if (!overContent || viewer !== v || !isSelectAllKey(e) || typing(document.activeElement)) return;
        const shown = content.firstElementChild;
        if (!shown) return;
        e.preventDefault(); // not the page's text
        e.stopPropagation();
        getSelection()?.selectAllChildren(shown);
    };
    document.addEventListener('keydown', onSelectAll, true);
    content.addEventListener('copy', (e) => {
        const lines = content.firstElementChild;
        const s = getSelection();
        if (!lines || !s || !v.text || s.anchorNode !== lines || s.focusNode !== lines) return;
        const ends = [s.anchorOffset, s.focusOffset].sort((a, b) => a - b);
        if (ends[0] !== 0 || ends[1] !== lines.childNodes.length) return;
        e.clipboardData?.setData('text/plain', v.text);
        e.preventDefault();
    });

    // Keys in the content area (once clicked into) or editor: Ctrl / ⌘ with + − 0 (text size)
    box.addEventListener('keydown', (e) => {
        const t = e.target as Node;
        if (e.key === 'F2' && renamable(v)) {
            e.preventDefault();
            return void startRename(v); // another name (edited text, or a copy of a read-only file)
        }
        if (!(e.ctrlKey || e.metaKey) || e.altKey || !(content.contains(t) || t === editor)) return;
        if (e.key === '+' || e.key === '=') zoomBy(1);
        else if (e.key === '-') zoomBy(-1);
        else if (e.key === '0') setZoom(1);
        else return;
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
                const ok = await v.loadAll?.();
                copyBtn.disabled = false;
                if (!ok) throw new Error('caching failed');
            }
            await navigator.clipboard.writeText(
                v.tableEditing ? (v.lineView?.csvText?.() ?? '') : v.writeMode ? v.editor.value : v.text,
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
            copyBtn.style.background = '';
        }, 2000);
    };

    // Appended to <html>, not <body>: in split mode <body> is shrunk (see setMode)
    document.documentElement.append(backdrop, box);
    return v;
}

/** Light / dark (kept): the viewer, its menu entry and the Zen list */
/** Properties on or off: the viewer's line (the file's) and the Zen list's (the folder's), one setting */
export function toggleProps(): void {
    view.props = !view.props;
    savePref(PROPS_KEY, view.props ? '1' : '0');
    viewer?.showProps();
    zenProps();
}

export function toggleTheme(): void {
    view.theme = view.theme === 'dark' ? 'light' : 'dark';
    savePref(THEME_KEY, view.theme);
    const box = viewer?.box;
    if (box) {
        box.classList.remove('tp-dark', 'tp-light');
        box.classList.add(`tp-${view.theme}`);
        for (const b of box.querySelectorAll('[data-theme-toggle]')) {
            b.setAttribute('aria-pressed', String(view.theme === 'dark'));
        }
    }
    zenTheme();
}
