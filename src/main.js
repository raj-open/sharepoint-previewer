// ==UserScript==
// @name         Sharepoint Previewer
// @description  Previewer (text, table, 3d-viewer) for various file types. Provides an editor for all pure text files.
// @version      1.0.0
// @copyright    2026, raj-open (https://github.com/raj-open/sharepoint-previewer)
// @license      MPL-2.0
// @match        https://*.sharepoint.com/*/*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  // --- Types (JSDoc) ---
  /** @typedef {[string, string]} Token [CSS class without "tp-", text] */
  /** @typedef {{ line: number, msg: string, severity: 'error'|'warning' }} Problem */
  /** @typedef {{ problems: Problem[], info?: string }} LintResult */
  /** @typedef {{ stop: () => void, show: (line: number) => void }} LineView */
  /** @typedef {{ total: number, loaded: number, done: boolean, text: string, more: () => Promise<void>, loadAll: () => Promise<void> } & Object<string, *>} Source */
  /** @typedef {Object<string, *>} Viewer the open preview panel: its elements and state */

  // ===========================================================================
  // Settings: defaults below; own values in Tampermonkey's storage (menu → "Settings …"),
  // kept across updates. Values of wrong type are ignored.
  // ===========================================================================
  const DEFAULTS = {
    // 'popup', 'horizontal' (below list) or 'vertical' (right of it); start value
    'layout': 'horizontal',

    // Share of space for preview in split mode (0.2 – 0.8); start value
    'viewer-share': 1 / 3,

    // Show light markers for whitespace: · for spaces, → for tabs
    'show-whitespace': true,

    // Wrap long lines (start value)
    'wrap-lines': false,

    // Syntax colours: text view, table view (start values)
    'colours-text': true,
    'colours-table': false,

    // Bytes per cache step ("Cache next"); 512 KB ≈ 10,000 lines of code
    'cache-chunk-bytes': 512 * 1024,

    // Parquet files: rows shown at first; "Cache next" shows this many more
    'parquet-rows': 100,

    // Cache limit for all files together (bytes of the files); more asks to clear first
    'memory-cache-bytes': 256 * 1024 * 1024,

    // "cache all" button asks for confirmation for files bigger than this
    'cache-all-confirm-bytes': 16 * 1024 * 1024,

    // Longer lines are cut for display (copy still gets full text)
    'max-line-chars': 5000,

    // Follow link files (.url shortcuts) and show file they point to
    'follow-links': true,

    // Folder with ifc-lite-3d.js and ifc-lite_bg.wasm: relative to site, or from top
    // with leading '/'. Fetched on first use of 3D button, checked by SHA-256.
    'viewer-3d-folder': '',

    // 3D view only for IFC files up to this size (for .ifczip: unpacked IFC file)
    'viewer-3d-max-bytes': 8 * 1024 * 1024,

    // 'dark' or 'light' (start value)
    'theme': 'light',

    // Logo (top right) as data: URI; empty = none. No network request.
    'logo': '',
  };

  /** @returns {Object<string, *>} */
  function loadSettings() {
    const out = {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      let value = GM_getValue(key);
      if (value === undefined) GM_setValue(key, (value = fallback)); // shown in Tampermonkey's storage
      out[key] = typeof value === typeof fallback ? value : fallback;
    }
    return out;
  }

  // Settings form, opened from Tampermonkey menu: [key, label, choices or unit]
  const SETTING_FORM = [
    ['layout', 'Layout', ['horizontal', 'vertical', 'popup']],
    ['viewer-share', 'Viewer takes up % of screen'],
    ['theme', 'Colours', ['dark', 'light']],
    ['show-whitespace', 'Display whitespaces'],
    ['wrap-lines', 'Wrap long lines'],
    ['colours-text', 'Syntax highlighting (text view)'],
    ['colours-table', 'Syntax highlighting (table view)'],
    ['cache-chunk-bytes', 'Cache chunk size', 'KB'],
    ['memory-cache-bytes', 'Cache limit (all files)', 'MB'],
    ['cache-all-confirm-bytes', 'Warn full file cache if file size exceeds', 'MB'],
    ['parquet-rows', 'Table rows shown'],
    ['max-line-chars', 'Lines cut after (characters)'],
    ['follow-links', 'Follow .url link files'],
    ['viewer-3d-folder', '3D viewer folder', 'Shared Documents/previewer  or  /sites/…/previewer'],
    ['viewer-3d-max-bytes', '3D view up to', 'MB'],
    ['logo', 'Logo (data:image/… URI, empty = no image)'],
  ];
  const UNIT_BYTES = { KB: 1024, MB: 1024 * 1024 };

  // ---------------------------------------------------------------------------
  // Movable windows (settings, popup): position kept in localStorage, inside screen
  // ---------------------------------------------------------------------------

  /** @param {string} key @returns {{ x: number, y: number }} */
  function loadOffset(key) {
    try {
      const o = JSON.parse(loadPref(key, 'null'));
      if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return o;
    } catch {}
    return { x: 0, y: 0 };
  }

  // Offset clamped so top edge and 80 px of window stay on screen
  /** @param {{ x: number, y: number }} o @param {DOMRect} base @returns {{ x: number, y: number }} */
  function clampOffset(o, base) {
    return {
      x: Math.round(Math.min(innerWidth - 80 - base.left, Math.max(80 - base.left - base.width, o.x))),
      y: Math.round(Math.min(innerHeight - 40 - base.top, Math.max(-base.top, o.y))),
    };
  }

  // Apply remembered offset to `target` (CSS translate)
  /** @param {HTMLElement} target @param {string} key @returns {void} */
  function placeMoved(target, key) {
    target.style.translate = '0 0';
    if (!target.isConnected) return void requestAnimationFrame(() => target.isConnected && placeMoved(target, key));
    const base = target.getBoundingClientRect();
    const o = clampOffset(loadOffset(key), base);
    target.style.translate = `${o.x}px ${o.y}px`;
  }

  // Drag `target` from pointerdown on its handle
  /** @param {PointerEvent} e @param {HTMLElement} target @param {string} key @returns {void} */
  function startMove(e, target, key) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const now = target.getBoundingClientRect();
    const o = loadOffset(key);
    // current offset ("10px 20px"; browser shortens "10px 0px" to "10px")
    const [tx = 0, ty = 0] = (target.style.translate || '').split(' ').map((v) => parseFloat(v) || 0);
    const base = new DOMRect(now.left - tx, now.top - ty, now.width, now.height);
    const start = { x: e.clientX - tx, y: e.clientY - ty };
    let last = { x: tx, y: ty };
    const move = (ev) => {
      last = clampOffset({ x: ev.clientX - start.x, y: ev.clientY - start.y }, base);
      target.style.translate = `${last.x}px ${last.y}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (last.x !== o.x || last.y !== o.y) savePref(key, JSON.stringify(last));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  // Start-value settings for viewer choices in browser storage
  const REMEMBERED_BY = {
    'layout': 'tp-preview-mode',
    'viewer-share': 'tp-preview-split',
    'theme': 'tp-preview-theme',
    'wrap-lines': 'tp-preview-wrap',
    'colours-text': 'tp-preview-colours-text',
    'colours-table': 'tp-preview-colours-table',
  };
  const SETTINGS_POS_KEY = 'tp-preview-settings-pos';
  const POPUP_POS_KEY = 'tp-preview-popup-pos';

  /** @returns {void} */
  function openSettingsForm() {
    document.querySelector('.tp-settings')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'tp-settings';
    // Follow viewer's light / dark choice; soft colours instead of pure white
    const dark = lastTheme === 'dark';
    const c = dark
      ? { bg: '#2b2b2e', fg: '#e6e6e6', field: '#1f1f22', border: '#55555a', muted: '#a8a8ad', bad: '#f1707b' }
      : { bg: '#f4f3f1', fg: '#242322', field: '#fbfaf9', border: '#c8c6c4', muted: '#605e5c', bad: '#c50f1f' };
    const font = "'Segoe UI', system-ui, -apple-system, sans-serif"; // single quotes: used inside style="…"
    const mono = 'Consolas, monospace';
    wrap.style.cssText = `position:fixed; inset:0; z-index:2147483100; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; font:13px ${font};`;
    const form = document.createElement('form');
    form.style.cssText = `background:${c.bg}; color:${c.fg}; padding:20px 24px; border-radius:10px; width:min(620px, 92vw); max-height:86vh; overflow:auto; box-shadow:0 8px 32px rgba(0,0,0,.3); font:13px ${font}; color-scheme:${dark ? 'dark' : 'light'}; user-select:text;`;
    const esc = (t) =>
      String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    const field = `font:13px ${font}; color:${c.fg}; background:${c.field}; padding:4px 8px; border:1px solid ${c.border}; border-radius:6px; box-sizing:border-box;`;
    const stored = Object.fromEntries(SETTING_FORM.map(([key]) => [key, GM_getValue(key, DEFAULTS[key])]));

    const rows = SETTING_FORM.map(([key, label, extra]) => {
      if (key === 'logo') {
        // full line, four lines high, wraps, scrolls
        return (
          `<div style="grid-column:1 / -1; margin-top:4px; user-select:text; cursor:text">${esc(label)}</div>` +
          `<textarea name="${key}" rows="4" spellcheck="false" style="grid-column:1 / -1; ${field} width:100%; ` +
          `resize:none; overflow-y:auto; word-break:break-all; font-family:${mono}; font-size:12px; line-height:16px; height:${4 * 16 + 10}px"></textarea>`
        );
      }
      let input;
      if (key === 'viewer-share') {
        // slider over full 0–100 %, held between 20 and 80 %
        input =
          `<input type="range" name="${key}" min="0" max="100" step="1" style="width:140px; margin:0">` +
          '<span data-pct style="margin-left:8px; min-width:3em"></span>';
      } else if (Array.isArray(extra)) {
        input = `<select name="${key}" style="${field} width:140px">${extra.map((o) => `<option>${o}</option>`).join('')}</select>`;
      } else if (typeof DEFAULTS[key] === 'boolean') {
        input = `<input type="checkbox" name="${key}" style="margin:0; width:16px; height:16px">`;
      } else if (typeof DEFAULTS[key] === 'number') {
        input =
          `<input type="number" step="any" name="${key}" style="${field} width:140px">` +
          (extra ? `<span style="margin-left:6px">${extra}</span>` : '');
      } else {
        input = `<input type="text" name="${key}" placeholder="${esc(extra || '')}" style="${field} width:100%">`;
      }
      // plain text (not a <label>): selectable, and click doesn't toggle field
      return (
        `<span style="align-self:center; user-select:text; cursor:text">${esc(label)}</span>` +
        `<div style="display:flex; align-items:center; min-width:0">${input}</div>`
      );
    });
    const tab = (mode, text) =>
      `<button type="button" data-mode="${mode}" style="border:none; padding:4px 12px; font:12px ${font}; cursor:pointer">${text}</button>`;
    form.innerHTML = `<div data-drag title="Drag to move" style="display:flex; align-items:center; gap:12px; margin:0 0 14px; cursor:move">
        <div style="display:flex; border:1px solid ${c.border}; border-radius:6px; overflow:hidden">${tab('form', 'Form')}${tab('json', 'JSON')}</div>
        <h3 style="flex:1; margin:0; font:600 16px ${font}">Sharepoint Previewer: settings</h3>
        <button type="button" data-act="close" title="Close" style="width:28px; height:28px; padding:0; border:none; border-radius:6px; background:transparent; color:${c.fg}; font:18px/1 ${font}; cursor:pointer">✕</button>
      </div>
      <div data-pane="form" style="display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:10px 16px">${rows.join('')}</div>
      <div data-pane="json" style="display:none">
        <div style="position:relative">
          <textarea data-json spellcheck="false" style="${field} width:100%; height:360px; resize:none; overflow-x:hidden; overflow-y:auto; white-space:pre-wrap; word-break:break-all; font:12px/17px ${mono}"></textarea>
          <button type="button" data-act="copy" title="Copy all" style="${field} position:absolute; top:6px; right:28px; width:28px; height:28px; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:.9">${COPY_SVG}</button>
        </div>
        <div data-errors style="color:${c.bad}; margin-top:6px; height:34px; overflow-y:auto; white-space:pre-line; font-size:12px; line-height:17px"></div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-top:18px">
        <button type="button" data-act="reset" title="Fill in the defaults (saved only with Save)" style="${field} cursor:pointer; padding:5px 12px">Reset to defaults</button>
        <span data-note style="flex:1; min-width:0; color:${c.muted}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis"></span>
        <button type="button" data-act="cancel" style="${field} cursor:pointer; padding:5px 16px">Cancel</button>
        <button type="submit" data-act="save" style="${field} padding:5px 16px">Save</button>
      </div>`;
    const json = form.querySelector('[data-json]');
    const errorsEl = form.querySelector('[data-errors]');
    const note = form.querySelector('[data-note]');
    const saveBtn = form.querySelector('[data-act="save"]');
    const slider = form.elements['viewer-share'];
    let mode = 'form';

    // Form inputs <-> stored values
    const setForm = (values) => {
      for (const [key, , extra] of SETTING_FORM) {
        const el = form.elements[key];
        const value = values[key];
        if (key === 'viewer-share') {
          el.value = Math.round(Math.min(0.8, Math.max(0.2, value)) * 100);
          form.querySelector('[data-pct]').textContent = `${el.value} %`;
        } else if (typeof DEFAULTS[key] === 'boolean') el.checked = value;
        else if (typeof DEFAULTS[key] === 'number')
          el.value = +(extra && UNIT_BYTES[extra] ? value / UNIT_BYTES[extra] : value).toFixed(2);
        else el.value = value;
      }
    };
    const readForm = () =>
      Object.fromEntries(
        SETTING_FORM.map(([key, , extra]) => {
          const el = form.elements[key];
          const fallback = DEFAULTS[key];
          let value;
          if (key === 'viewer-share') value = Math.min(80, Math.max(20, Number(el.value))) / 100;
          else if (typeof fallback === 'boolean') value = el.checked;
          else if (typeof fallback === 'number') {
            value = Number(el.value) * (UNIT_BYTES[extra] || 1);
            if (!Number.isFinite(value) || value <= 0) value = fallback;
          } else value = el.value.trim();
          return [key, value];
        }),
      );

    // JSON text <-> stored values (LOGO last, as it is long); reasons when it is not valid
    const toJson = (values) =>
      JSON.stringify(
        Object.fromEntries([
          ...SETTING_FORM.filter(([key]) => key !== 'logo').map(([key]) => [key, values[key]]),
          ['logo', values.logo],
        ]),
        null,
        2,
      );
    const readJson = () => {
      let data;
      try {
        data = JSON.parse(json.value);
      } catch (err) {
        return { errors: [`Not valid JSON: ${err.message}`] };
      }
      if (!data || typeof data !== 'object' || Array.isArray(data))
        return { errors: ['The settings must be one JSON object { … }'] };
      const errors = [];
      for (const key of Object.keys(data)) if (!(key in DEFAULTS)) errors.push(`Unknown setting "${key}"`);
      const values = {};
      for (const [key, , extra] of SETTING_FORM) {
        const value = key in data ? data[key] : stored[key];
        const type = typeof DEFAULTS[key];
        if (typeof value !== type) errors.push(`${key}: must be ${type === 'boolean' ? 'true or false' : `a ${type}`}`);
        else if (Array.isArray(extra) && !extra.includes(value))
          errors.push(`${key}: must be one of ${extra.map((o) => `"${o}"`).join(', ')}`);
        else if (key === 'viewer-share' && (value < 0.2 || value > 0.8))
          errors.push(`${key}: must be between 0.2 and 0.8`);
        else if (type === 'number' && !(value > 0 && Number.isFinite(value)))
          errors.push(`${key}: must be greater than 0`);
        values[key] = typeof value === 'string' ? value.trim() : value;
      }
      return errors.length ? { errors } : { values };
    };

    // Values currently entered (null: JSON not valid)
    const current = () => (mode === 'json' ? readJson().values || null : readForm());
    let saved = '';
    const changed = () => {
      const now = current();
      return now === null || JSON.stringify(now) !== saved;
    };

    // Save: blue while there are valid unsaved changes; clearly greyed out otherwise
    const update = () => {
      if (mode === 'json') {
        const { errors } = readJson();
        errorsEl.textContent = errors ? errors.join('\n') : '';
        json.style.borderColor = errors ? c.bad : c.border;
        json.style.boxShadow = errors ? `0 0 0 1px ${c.bad}` : 'none';
      }
      const now = current();
      const on = now !== null && JSON.stringify(now) !== saved;
      saveBtn.disabled = !on;
      saveBtn.style.background = on ? '#0078d4' : 'transparent';
      saveBtn.style.borderColor = on ? '#0078d4' : c.border;
      saveBtn.style.borderStyle = on ? 'solid' : 'dashed';
      saveBtn.style.color = on ? '#fff' : c.muted;
      saveBtn.style.opacity = on ? '1' : '.45';
      saveBtn.style.cursor = on ? 'pointer' : 'not-allowed';
      if (changed()) note.textContent = '';
    };

    // Form / JSON switch: other view takes over values entered so far
    const setMode = (next) => {
      if (next === mode) return;
      if (next === 'form') {
        const { values, errors } = readJson();
        if (errors) {
          note.textContent = 'Fix the JSON first (see the reasons below it).';
          return;
        }
        setForm(values);
      } else {
        json.value = toJson(readForm());
      }
      mode = next;
      for (const pane of form.querySelectorAll('[data-pane]')) {
        pane.style.display = pane.dataset.pane !== mode ? 'none' : pane.dataset.pane === 'form' ? 'grid' : 'block';
      }
      for (const b of form.querySelectorAll('[data-mode]')) {
        const active = b.dataset.mode === mode;
        b.style.background = active ? '#0078d4' : 'transparent';
        b.style.color = active ? '#fff' : c.fg;
      }
      errorsEl.textContent = '';
      update();
    };
    form.querySelectorAll('[data-mode]').forEach((b) => {
      b.onclick = () => setMode(b.dataset.mode);
    });
    form.querySelector('[data-act="reset"]').onclick = () => {
      setForm(DEFAULTS);
      if (mode === 'json') json.value = toJson(readForm());
      update();
      note.textContent = 'Defaults filled in: Save to keep them.';
    };
    form.querySelector('[data-act="copy"]').onclick = async () => {
      try {
        await navigator.clipboard.writeText(json.value);
      } catch {
        json.select();
        document.execCommand('copy');
      }
      note.textContent = 'Copied.';
    };

    setForm(stored);
    Object.assign(stored, readForm()); // as form shows them (e.g. 33 % instead of 1/3)
    mode = 'json'; // so that setMode below draws switch for form
    json.value = toJson(stored);
    saved = JSON.stringify(stored);
    setMode('form');
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    slider.oninput = () => {
      slider.value = Math.min(80, Math.max(20, Number(slider.value))); // blocked below 20 %, above 80 %
      form.querySelector('[data-pct]').textContent = `${slider.value} %`;
      update();
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      const values = current();
      if (!values || JSON.stringify(values) === saved) return;
      for (const [key, value] of Object.entries(values)) {
        // changed start value replaces choice remembered from viewer
        if (value !== stored[key] && REMEMBERED_BY[key]) removePref(REMEMBERED_BY[key]);
        GM_setValue(key, value);
      }
      Object.assign(stored, values);
      saved = JSON.stringify(values);
      if (mode === 'json') json.value = toJson(values);
      update();
      note.textContent = 'Saved. Reload the page to apply.';
    };

    // Close (✕, Cancel, Esc, click beside): asks first if unsaved
    const close = () => {
      if (changed() && !confirm('Close without saving your changes?')) return;
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    form.querySelector('[data-act="close"]').onclick = close;
    form.querySelector('[data-act="cancel"]').onclick = close;
    // click beside form closes it; selection dragged out of it doesn't
    let downOnBackdrop = false;
    wrap.onpointerdown = (e) => {
      downOnBackdrop = e.target === wrap;
    };
    wrap.onclick = (e) => {
      if (downOnBackdrop && e.target === wrap) close(); // block body: `return false` would cancel clicks
    };
    // Drag title row (not its buttons) to move window
    form.querySelector('[data-drag]').addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !e.target.closest('button')) startMove(e, form, SETTINGS_POS_KEY);
    });

    wrap.append(form);
    document.body.append(wrap);
    // JSON view as high as form view: no jump on switch
    const formHeight = form.querySelector('[data-pane="form"]').getBoundingClientRect().height;
    json.style.height = `${Math.max(200, Math.round(formHeight) - 43)}px`;
    placeMoved(form, SETTINGS_POS_KEY);
  }
  GM_registerMenuCommand('Settings …', openSettingsForm);

  GM_registerMenuCommand('Reset settings to defaults', () => {
    if (!confirm('Reset all Sharepoint Previewer settings to their defaults?')) return;
    for (const [key, value] of Object.entries(DEFAULTS)) GM_setValue(key, value);
    alert('Settings reset. Reload the page to apply them.');
  });
  const {
    'layout': DEFAULT_MODE,
    'viewer-share': DEFAULT_PREVIEW_SIZE,
    'show-whitespace': SHOW_WHITESPACE,
    'wrap-lines': DEFAULT_WRAP,
    'colours-text': DEFAULT_COLOURS,
    'colours-table': DEFAULT_TABLE_COLOURS,
    'cache-chunk-bytes': MAX_BYTES,
    'parquet-rows': PARQUET_ROWS,
    'memory-cache-bytes': MEMORY_CACHE_BYTES,
    'cache-all-confirm-bytes': LARGE_FILE_BYTES,
    'max-line-chars': MAX_LINE_CHARS,
    'follow-links': FOLLOW_LINKS,
    'viewer-3d-folder': VIEWER_3D_FOLDER,
    'viewer-3d-max-bytes': MAX_3D_BYTES,
    'theme': THEME,
    'logo': LOGO,
  } = loadSettings();

  // Fixed values (internal)
  // Links followed in row at most (against loops)
  const MAX_LINK_HOPS = 5;

  // Bytes at start that decide whether file is text
  const SNIFF_BYTES = 512;

  // Most problems listed by checker
  const MAX_PROBLEMS = 500;

  // Space between list and preview in split mode, in pixels
  const SPLIT_GAP = 3;

  // Width of preview (eye) column, in pixels
  const COL_WIDTH = 32;

  // Checksums of 3D viewer files (they belong to this script version)
  const VIEWER_3D_JS_SHA256 = 'f662159c4b4f5a92b7625943e8519872a1438ee32dad50e5f6997c7da77b36e2';
  const VIEWER_3D_WASM_SHA256 = '3912d1046cf6507e7ef6f85a0492a0e54fbb31ae711b85c6e46b6313ffd63312';

  // File types (by extension) that get colours and checks
  const LANGS = [
    [
      'xml',
      /\.(xml|xsd|xsl|xslt|svg|xaml|config|csproj|vbproj|props|targets|resx|plist|kml|gpx|rss|atom|wsdl|addin)$/i,
    ], // .addin: Revit add-in manifest
    ['json', /\.(json|geojson|webmanifest|har)$/i],
    ['yaml', /\.ya?ml$/i],
    ['ifc', /\.ifc(zip)?$/i], // .ifczip: unpacked first
    ['toml', /\.toml$/i],
    ['m', /\.(pq|pqm|m)$/i], // Power Query M
    ['js', /\.(js|mjs|cjs|jsx)$/i], // JavaScript
    ['md', /\.(md|markdown|mdown|mkd)$/i], // Markdown
    ['rst', /\.rst$/i], // reStructuredText
    ['csv', /\.(csv|tsv)$/i], // CSV / TSV
    ['xlf', /\.xlf$/i], // Excel formulas
    ['sql', /\.sql$/i], // SQL
    ['py', /\.(py|pyw|pyi)$/i], // Python
  ];

  // ===========================================================================

  // Closed eye: lid line with lashes
  const EYE_CLOSED_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2 10s4 6 10 6 10-6 10-6"/>
      <path d="M5.5 14l-1.5 2.2M12 16v2.6M18.5 14l1.5 2.2"/>
    </svg>
  `;

  // Half-open eye: lowered lid, lower half of pupil visible
  const EYE_HALF_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1 12s4 7 11 7 11-7 11-7"/>
      <path d="M1 12c3-2.5 7-3.5 11-3.5s8 1 11 3.5"/>
      <path d="M9 12a3 3 0 0 0 6 0z" fill="currentColor"/>
    </svg>
  `;

  // Fully open eye with lashes (file completely cached; also column header)
  const EYE_FULL_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1 13.5s4-6 11-6 11 6 11 6-4 6-11 6-11-6-11-6z"/>
      <circle cx="12" cy="13.5" r="2.8"/>
      <path d="M12 7.5V4.2M6.6 8.6L5 6.3M17.4 8.6L19 6.3"/>
    </svg>
  `;

  const COPY_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  `;

  const CHECK_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  `;

  // ---------------------------------------------------------------------------
  // Current folder, from URL only
  //  .../AllItems.aspx?id=/sites/X/Shared Documents/Folder -> id
  //  .../Shared Documents/Forms/AllItems.aspx -> library root
  // ---------------------------------------------------------------------------

  /** @returns {string|null} server-relative folder of the open view, or null outside a library */
  function currentFolder() {
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

  const NAME_SELECTORS = [
    '[data-automationid="FieldRenderer-name"]',
    '[data-automationid="field-LinkFilename"] button',
    '[data-automationid="field-LinkFilename"] a',
    '[data-automationid="field-LinkFilename"]',
  ].join(',');

  // Single path segment with extension, e.g. "notes.txt"
  const FILENAME_RE = /^[^\\/:*?"<>|\r\n]+\.[A-Za-z0-9_-]{1,12}$/;

  /** @param {Element} row @returns {string|null} */
  function rowName(row) {
    // 1. Known SharePoint name-field selectors
    const el = row.querySelector(NAME_SELECTORS);
    const name = el?.textContent.trim();
    if (name) return name;

    // 2. Fallback: first visible text in row that looks like file name
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('.tp-cell')) continue;
      const text = node.textContent.trim();
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

  // Folder markers in technical attributes (icon URLs, classes, data-*): same in every UI language
  const FOLDER_RE = /folder/i;
  const TEXT_ATTRS = new Set(['href', 'aria-label', 'title', 'alt']); // links, translated texts

  /** @param {Element} row @returns {boolean} */
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
  /** @param {Element} row @returns {boolean} */
  function isFileRow(row) {
    return !!rowName(row) && !isFolder(row);
  }

  // ---------------------------------------------------------------------------
  // Inject column
  // ---------------------------------------------------------------------------

  // Header eye: overlaid at x position of row eyes (other cell layout)
  /** @param {Element} row @returns {void} */
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
    let host = document.elementFromPoint(x, y);
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
  /** @param {Element} row @returns {boolean} true if the row was (re)worked on */
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
      row.querySelectorAll('.tp-cell').forEach((n) => n.remove()); // recycled row
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
    const icon = [...row.querySelectorAll('img, svg, i[data-icon-name]')].find(
      (el) => !el.closest('.tp-cell') && el.getBoundingClientRect().height,
    );
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
      const eye = cell.querySelector('.tp-preview');
      const name = rowName(row);
      const folder = currentFolder();
      eye.dataset.url = (name && (rowFilePath(row, name) || (folder && `${folder}/${name}`))) || '';
      setEye(eye);
    }
    return true;
  }

  // Eye per file: closed = not cached, half open = partly cached (previewed), open = fully cached
  /** @param {string} url @returns {'closed'|'half'|'open'} */
  function eyeState(url) {
    if (url && pendingOpens.has(url)) return 'half'; // first fetch under way (e.g. Parquet)
    const src = url && memoryCache.get(url)?.src;
    if (!src) return 'closed';
    return src.done || (src.total > 0 && src.loaded >= src.total) ? 'open' : 'half'; // all bytes here
  }

  const EYE_TITLES = {
    closed: 'Preview',
    half: 'Preview (partly cached)',
    open: 'Preview (fully cached)',
  };

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
  function refreshEyes() {
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

  let scheduled = false;

  /** @returns {void} */
  // Containers of SharePoint's dialogues, panels and pop-ups (Fluent UI layers)
  const OVERLAY =
    '.ms-Layer, .fui-Portal, [role="dialog"], [role="alertdialog"], [aria-modal="true"], .ms-Panel, .ms-Modal, .ms-Callout';

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
  let headerDirty = true;

  // Changes inside script's own elements (viewer, eyes) don't need new scan
  const OWN = '.tp-viewer, .tp-cell, .tp-head';
  new MutationObserver((changes) => {
    if (changes.every((c) => c.target.closest?.(OWN))) return;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => {
    headerDirty = true; // re-align header eye
    requestAnimationFrame(scan);
  });
  requestAnimationFrame(scan); // after whole script has run (scan uses later definitions)

  // ---------------------------------------------------------------------------
  // Clicks (capture phase, so SharePoint doesn't select/open row)
  // ---------------------------------------------------------------------------

  /** @param {Event} e @returns {HTMLElement|null} */
  const findPreview = (e) => e.target?.closest?.('.tp-preview');
  const findHead = (e) => e.target?.closest?.('.tp-head');

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

  // ---------------------------------------------------------------------------
  // Styles for code view and syntax colours
  // ---------------------------------------------------------------------------

  const style = document.createElement('style');
  style.textContent = `
    .tp-light {
      --tp-bg: #fff;
      --tp-fg: #1f1f1f;
      --tp-header-bg: #fff;
      --tp-thead-bg: rgba(59, 58, 57, .95);
      --tp-thead-fg: #fff;
      --tp-stripe: rgba(0, 0, 0, .045);
      --tp-title: #323130;
      --tp-border: #edebe9;
      --tp-edge: #e1dfdd;
      --tp-btn-bg: #f3f2f1;
      --tp-btn-fg: #323130;
      --tp-accent: #0078d4;
      --tp-ln-fg: #a0a0a0;
      --tp-ln-bg: #f8f8f8;
      --tp-ln-border: #eee;
      --tp-err-ln-bg: #e51400;
      --tp-err-ln-fg: #fff;
      --tp-err-bg: #fde7e9;
      --tp-warn-ln-bg: #f2c811;
      --tp-warn-ln-fg: #000;
      --tp-warn-bg: #fff8e1;
      --tp-flash: #fff4ce;
      --tp-ok-bg: #dff6dd;
      --tp-ok-fg: #107c10;
      --tp-bad-bg: #fde7e9;
      --tp-bad-fg: #a80000;
      --tp-wait-bg: #f3f2f1;
      --tp-wait-fg: #605e5c;
      --tp-hover: #f3f2f1;
      --tp-sev-error: #a80000;
      --tp-sev-warning: #8a6d00;
      --tp-key: #0451a5;
      --tp-str: #a31515;
      --tp-num: #098658;
      --tp-lit: #0000ff;
      --tp-punct: #777;
      --tp-com: #008000;
      --tp-tag: #800000;
      --tp-attr: #e50000;
      --tp-aval: #0000ff;
      --tp-meta: #af00db;
      --tp-ent: #b5651d;
      --tp-ref: #af00db;
      --tp-type: #267f99;
      --tp-enum: #0070c1;
      --tp-kw: #af00db;
      --tp-anchor: #795e26;
      --tp-trunc: #8a8886;
      --tp-ws: rgba(0, 0, 0, .2);
      --tp-well-bg: #f3f2f1;
      --tp-well-shadow: inset 0 1px 3px rgba(0, 0, 0, .18), inset 0 -1px 0 rgba(255, 255, 255, .9);
    }
    .tp-dark {
      --tp-bg: #1e1e1e;
      --tp-fg: #d4d4d4;
      --tp-header-bg: #252526;
      --tp-thead-bg: rgba(72, 72, 74, .95);
      --tp-thead-fg: #f3f3f3;
      --tp-stripe: rgba(255, 255, 255, .045);
      --tp-title: #cccccc;
      --tp-border: #333;
      --tp-edge: #616161;
      --tp-btn-bg: #3c3c3c;
      --tp-btn-fg: #cccccc;
      --tp-accent: #0e639c;
      --tp-ln-fg: #858585;
      --tp-ln-bg: #1e1e1e;
      --tp-ln-border: #333;
      --tp-err-ln-bg: #be1100;
      --tp-err-ln-fg: #fff;
      --tp-err-bg: rgba(255, 0, 0, .15);
      --tp-warn-ln-bg: #cca700;
      --tp-warn-ln-fg: #000;
      --tp-warn-bg: rgba(204, 167, 0, .15);
      --tp-flash: rgba(255, 255, 0, .2);
      --tp-ok-bg: #1d3320;
      --tp-ok-fg: #89d185;
      --tp-bad-bg: #3a1d1d;
      --tp-bad-fg: #f48771;
      --tp-wait-bg: #2d2d2d;
      --tp-wait-fg: #a0a0a0;
      --tp-hover: #2a2d2e;
      --tp-sev-error: #f48771;
      --tp-sev-warning: #cca700;
      --tp-key: #9cdcfe;
      --tp-str: #ce9178;
      --tp-num: #b5cea8;
      --tp-lit: #569cd6;
      --tp-punct: #808080;
      --tp-com: #6a9955;
      --tp-tag: #569cd6;
      --tp-attr: #9cdcfe;
      --tp-aval: #ce9178;
      --tp-meta: #c586c0;
      --tp-ent: #d7ba7d;
      --tp-ref: #c586c0;
      --tp-type: #4ec9b0;
      --tp-enum: #4fc1ff;
      --tp-kw: #c586c0;
      --tp-anchor: #dcdcaa;
      --tp-trunc: #808080;
      --tp-ws: rgba(255, 255, 255, .18);
      --tp-well-bg: #1e1e1e;
      --tp-well-shadow: inset 0 1px 3px rgba(0, 0, 0, .6), inset 0 -1px 0 rgba(255, 255, 255, .06);
      color-scheme: dark;
    }

    .tp-viewer { background: var(--tp-bg); }
    .tp-header { background: var(--tp-header-bg); border-bottom: 1px solid var(--tp-border); }
    .tp-title { color: var(--tp-title); }
    /* File name sits in a recessed "valley" */
    .tp-well {
      padding: 0 10px;
      border-radius: 8px;
      background: var(--tp-well-bg);
      box-shadow: var(--tp-well-shadow);
    }
    .tp-mode-btn { background: var(--tp-btn-bg); color: var(--tp-btn-fg); }
    .tp-mode-btn[aria-pressed="true"] { background: var(--tp-accent); color: #fff; }
    .tp-mode-btn:disabled { opacity: .4; cursor: default; }
    /* Unavailable buttons are only greyed out, never shown as "on" (e.g. table view for non-tables) */
    .tp-viewer .tp-mode-btn[aria-pressed="true"]:disabled { background: transparent; color: var(--tp-btn-fg); }
    .tp-viewer .tp-mode-btn:not([aria-pressed="true"]) { background: transparent; color: var(--tp-btn-fg); }
    .tp-viewer .tp-mode-btn:not([aria-pressed="true"]):not(:disabled):hover { background: var(--tp-btn-bg); }
    .tp-menu {
      position: absolute;
      z-index: 6;
      min-width: 210px;
      padding: 4px;
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,.3);
    }
    .tp-menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 6px 10px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--tp-fg);
      font: 13px sans-serif;
      text-align: left;
      cursor: pointer;
    }
    .tp-menu-item:hover:not(:disabled) { background: var(--tp-hover); }
    .tp-menu-item:disabled { opacity: .4; cursor: default; }
    .tp-menu-item[aria-pressed="true"]::after { content: '✓'; margin-left: auto; color: var(--tp-accent); font-weight: 700; }
    .tp-attn { animation: tp-attn 3s ease-out; }
    @keyframes tp-attn {
      from { box-shadow: 0 0 0 4px rgba(0, 120, 212, .9); }
      to { box-shadow: 0 0 0 4px rgba(0, 120, 212, 0); }
    }
    .tp-load-more {
      background: var(--tp-header-bg);
      color: var(--tp-accent);
      border: none;
      border-top: 1px solid var(--tp-border);
    }
    .tp-dark .tp-load-more { color: #3794ff; }

    .tp-content {
      flex: 1;
      min-height: 0;
      overflow: auto;
      outline: none;
      font: 13px/1.45 Consolas, "Courier New", monospace;
      color: var(--tp-fg);
      background: var(--tp-bg);
    }
    .tp-editor-wrap {
      flex: 1;
      min-height: 0;
      display: flex;
      margin: 4px;
      border: 2px solid #d13438;
      border-radius: 4px;
      overflow: hidden;
    }
    .tp-gutter {
      flex: none;
      margin: 0;
      padding: 4px 10px 12px 8px;
      overflow: hidden;
      text-align: right;
      font: 13px/1.45 Consolas, "Courier New", monospace;
      color: var(--tp-ln-fg);
      background: var(--tp-ln-bg);
      border-right: 1px solid var(--tp-ln-border);
      user-select: none;
    }
    .tp-viewer .tp-editor, .tp-viewer .tp-gutter {
      font-family: Consolas, "Courier New", monospace !important; /* SharePoint styles text boxes */
    }
    .tp-editor {
      flex: 1;
      min-height: 0;
      min-width: 0;
      margin: 0;
      padding: 4px 12px 12px;
      border: none;
      outline: none;
      resize: none;
      box-sizing: border-box;
      font: 13px/1.45 Consolas, "Courier New", monospace;
      color: var(--tp-fg);
      background: var(--tp-bg);
      white-space: pre;
      tab-size: 4;
    }
    .tp-table {
      border-collapse: separate;
      border-spacing: 0;
      font: 12px/1.4 sans-serif;
      color: var(--tp-fg);
    }
    .tp-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 4px 10px;
      text-align: left;
      white-space: nowrap;
      font-weight: 600;
      color: var(--tp-thead-fg);
      background: var(--tp-thead-bg);
      border-bottom: 3px solid var(--tp-border);
    }
    .tp-table th button { color: inherit; }
    .tp-table tr.tp-stripe td { background: var(--tp-stripe); }
    .tp-table tr.tp-stripe td.tp-rn { background: linear-gradient(var(--tp-stripe), var(--tp-stripe)), var(--tp-bg); }
    .tp-table td {
      padding: 3px 10px;
      max-width: 360px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-bottom: 1px solid var(--tp-border);
    }
    /* Row numbers: first column without header, numbers aligned right; stays in place when
       scrolling sideways (like the header row when scrolling down) */
    .tp-table .tp-rn {
      position: sticky;
      left: 0;
      text-align: right;
      color: var(--tp-ln-fg);
      background: var(--tp-bg);
      border-right: 1px solid var(--tp-border);
    }
    .tp-table td.tp-rn { z-index: 1; }
    .tp-table th.tp-rn { z-index: 2; background: var(--tp-thead-bg); }
    .tp-table tbody tr:not(.tp-spacer):hover td { background: var(--tp-hover); }
    .tp-table tr.tp-spacer td { padding: 0; border: none; }
    .tp-table th[data-c] { cursor: pointer; user-select: none; }
    .tp-filter {
      margin-left: 6px;
      padding: 0 4px;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--tp-ln-fg);
      cursor: pointer;
      font-size: 11px;
    }
    .tp-filter.tp-on { background: var(--tp-accent); color: #fff; }
    .tp-content:has(.tp-plus) { position: relative; }
    .tp-plus {
      position: absolute;
      z-index: 4;
      width: 16px;
      height: 16px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--tp-accent);
      color: #fff;
      font: bold 13px/16px sans-serif;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,.3);
    }
    .tp-table [draggable="true"] { cursor: grab; }
    .tp-resize {
      position: absolute;
      top: 40%;
      bottom: 0;
      right: -3px;
      width: 7px;
      z-index: 3;
      cursor: col-resize;
    }
    .tp-resize:hover { background: linear-gradient(90deg, transparent 2px, var(--tp-accent) 2px 5px, transparent 5px); }
    .tp-col-delete {
      visibility: hidden; /* appears when hovering over the column title */
      margin-left: 2px;
      padding: 0 2px;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--tp-ln-fg);
      vertical-align: middle;
      cursor: pointer;
    }
    .tp-col-delete svg { width: 12px; height: 12px; display: block; }
    .tp-table th:hover .tp-col-delete { visibility: visible; }
    .tp-col-delete:hover { background: #d13438; color: #fff; }
    /* Write mode: room on the left for the "+" between rows */
    .tp-table.tp-editing { margin-left: 14px; }
    .tp-table.tp-editing .tp-rn { left: 14px; }
    .tp-table .tp-drop-before { box-shadow: inset 0 3px 0 var(--tp-accent); }
    .tp-table .tp-drop-after { box-shadow: inset 0 -3px 0 var(--tp-accent); }
    .tp-table th.tp-drop-before { box-shadow: inset 3px 0 0 var(--tp-accent); }
    .tp-table th.tp-drop-after { box-shadow: inset -3px 0 0 var(--tp-accent); }
    .tp-table td[contenteditable] { cursor: text; outline: none; }
    .tp-statusbar {
      flex: none;
      height: 30px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 8px;
      background: var(--tp-header-bg);
      border-top: 1px solid var(--tp-border);
    }
    .tp-progress {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
      font: 11px sans-serif;
      color: var(--tp-fg);
      white-space: nowrap;
    }
    .tp-progress.tp-off { opacity: .4; }
    /* fully cached: calm, no accent (dark grey / soft light grey) */
    .tp-progress.tp-full .tp-progress-fill, .tp-progress.tp-idle .tp-progress-fill { background: #3b3a39; }
    .tp-dark .tp-progress.tp-full .tp-progress-fill, .tp-dark .tp-progress.tp-idle .tp-progress-fill { background: #c8c8c8; }
    .tp-progress .tp-click { cursor: pointer; }
    .tp-progress .tp-click:hover { color: var(--tp-accent); }
    .tp-progress.tp-full .tp-progress-bar { overflow: visible; }
    .tp-views {
      display: flex;
      flex: none;
      margin-left: auto;
      border: 1px solid var(--tp-border);
      border-radius: 6px;
      overflow: hidden;
    }
    .tp-viewer .tp-view-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      height: 22px;
      padding: 0 10px;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--tp-fg);
      font: 12px sans-serif;
      cursor: pointer;
    }
    .tp-viewer .tp-view-btn + .tp-view-btn { border-left: 1px solid var(--tp-border); }
    .tp-viewer .tp-view-btn svg { width: 14px; height: 14px; }
    .tp-viewer .tp-view-btn[aria-pressed="true"] { background: #0078d4; color: #fff; }
    .tp-viewer .tp-view-btn:disabled { opacity: .4; cursor: default; }
    .tp-viewer .tp-view-btn:not(:disabled):not([aria-pressed="true"]):hover { background: var(--tp-hover); }
    .tp-progress-bar {
      width: 140px;
      height: 3px;
      border-radius: 2px;
      background: var(--tp-border);
      overflow: hidden;
    }
    .tp-progress-fill { height: 100%; width: 0; background: #0078d4; transition: width .15s; }
    /* Row of the file in the viewer (SharePoint's own hover colour) */
    [role="row"].tp-row-shown, [role="row"].tp-row-shown:hover { background-color: #f3f2f1 !important; }
    .tp-notice .tp-code { font-style: italic; color: #d13438; }
    .tp-inline-icon svg { width: 14px; height: 14px; vertical-align: -2px; }
    .tp-notice .tp-sp { background-image: none; } /* notices: no whitespace markers */
    .tp-notice .tp-tab::before { content: none; }
    .tp-dark .tp-notice .tp-code { color: #9d9d9d; }
    .tp-csv-bar {
      display: none;
      gap: 6px;
      align-items: center;
      padding: 4px 8px;
      font: 12px sans-serif;
      color: var(--tp-fg);
      background: var(--tp-header-bg);
      border-bottom: 1px solid var(--tp-border);
    }
    .tp-csv-bar select {
      font: 12px sans-serif;
      color: var(--tp-fg);
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 3px;
    }
    .tp-table td[contenteditable]:focus { box-shadow: inset 0 0 0 2px #d13438; }
    .tp-filter-panel {
      position: absolute;
      z-index: 5;
      width: 240px;
      max-height: 320px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      font: 12px sans-serif;
      color: var(--tp-fg);
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,.25);
    }
    .tp-filter-panel input[type="text"] {
      padding: 3px 6px;
      color: var(--tp-fg);
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 3px;
    }
    .tp-filter-list { overflow: auto; display: flex; flex-direction: column; }
    .tp-filter-panel label { display: flex; gap: 6px; align-items: center; white-space: nowrap; }
    .tp-filter-panel label span { margin-left: auto; color: var(--tp-ln-fg); }
    .tp-lines { display: inline-block; min-width: 100%; padding: 4px 0 12px; }
    .tp-line { display: flex; }
    .tp-ln {
      position: sticky;
      left: 0;
      flex: none;
      min-width: var(--tp-ln-w, 3ch);
      padding: 0 10px 0 8px;
      text-align: right;
      color: var(--tp-ln-fg);
      background: var(--tp-ln-bg);
      border-right: 1px solid var(--tp-ln-border);
      user-select: none;
    }
    .tp-code { white-space: pre; padding: 0 12px; flex: 1; }
    .tp-wrap .tp-lines { display: block; }
    .tp-wrap .tp-code { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
    .tp-err .tp-ln { color: var(--tp-err-ln-fg); background: var(--tp-err-ln-bg); }
    .tp-err .tp-code { background: var(--tp-err-bg); }
    .tp-warn .tp-ln { color: var(--tp-warn-ln-fg); background: var(--tp-warn-ln-bg); }
    .tp-warn .tp-code { background: var(--tp-warn-bg); }
    .tp-flash .tp-code { background: var(--tp-flash) !important; transition: background .3s; }

    .tp-key { color: var(--tp-key); }
    .tp-str { color: var(--tp-str); }
    .tp-num { color: var(--tp-num); }
    .tp-lit { color: var(--tp-lit); font-weight: 600; }
    .tp-punct { color: var(--tp-punct); }
    .tp-com { color: var(--tp-com); font-style: italic; }
    .tp-tag { color: var(--tp-tag); }
    .tp-attr { color: var(--tp-attr); }
    .tp-aval { color: var(--tp-aval); }
    .tp-meta { color: var(--tp-meta); }
    .tp-ent { color: var(--tp-ent); }
    .tp-ref { color: var(--tp-ref); }
    .tp-type { color: var(--tp-type); font-weight: 600; }
    .tp-enum { color: var(--tp-enum); }
    .tp-kw { color: var(--tp-kw); font-weight: 700; }
    .tp-anchor { color: var(--tp-anchor); }
    .tp-sp {
      background-image: radial-gradient(circle, var(--tp-ws) 0.9px, transparent 1.3px);
      background-size: 1ch 100%;
      background-repeat: repeat-x;
    }
    .tp-tab { position: relative; }
    .tp-tab::before {
      content: '→';
      position: absolute;
      left: 0;
      color: var(--tp-ws);
      pointer-events: none;
    }
    .tp-trunc { color: var(--tp-trunc); font-style: italic; user-select: none; }

    .tp-splitter { display: none; position: absolute; z-index: 2; touch-action: none; }
    .tp-splitter-vertical { display: block; left: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize; }
    .tp-splitter-horizontal { display: block; left: 0; right: 0; top: 0; height: 6px; cursor: row-resize; }
    .tp-splitter:hover, .tp-splitter.tp-drag { background: rgba(0, 120, 212, .35); }
    .tp-splitter-vertical { border-radius: 8px 0 0 8px; }
    .tp-splitter-horizontal { border-radius: 8px 8px 0 0; }

    /* Check result: a short line across the whole width at the bottom of the header; the problem
       list opens over the text */
    /* Grip at the lower edge of the header (like the splitter): drag for more metadata lines */
    .tp-meta-grip {
      position: absolute;
      left: 0;
      right: 0;
      bottom: -3px;
      height: 6px;
      z-index: 2;
      cursor: row-resize;
    }
    .tp-meta-grip:hover, .tp-meta-grip.tp-drag { background: rgba(0, 120, 212, .35); }
    .tp-lint {
      position: absolute;
      top: var(--tp-lint-top, 63px);
      left: 0;
      right: 0;
      font: 12px sans-serif;
    }
    .tp-lint-summary {
      display: block;
      width: 100%;
      padding: 1px 12px;
      border: none;
      border-radius: 0;
      text-align: left;
      font: 600 11px/16px sans-serif;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .tp-lint-ok .tp-lint-summary { background: var(--tp-ok-bg); color: var(--tp-ok-fg); cursor: default; }
    .tp-lint-bad .tp-lint-summary { background: var(--tp-bad-bg); color: var(--tp-bad-fg); }
    .tp-lint-wait .tp-lint-summary { background: var(--tp-wait-bg); color: var(--tp-wait-fg); cursor: default; }
    .tp-lint-list {
      position: absolute;
      top: 20px;
      left: 0;
      right: 0;
      z-index: 3;
      max-height: 25vh;
      overflow: auto;
      background: var(--tp-bg);
      color: var(--tp-fg);
      border: 1px solid var(--tp-border);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,.25);
    }
    .tp-lint-item { padding: 3px 12px; cursor: pointer; white-space: pre-wrap; }
    .tp-lint-item:hover { background: var(--tp-hover); }
    .tp-lint-item b { display: inline-block; min-width: 6em; }
    .tp-lint-item.tp-sev-error b { color: var(--tp-sev-error); }
    .tp-lint-item.tp-sev-warning b { color: var(--tp-sev-warning); }
  `;
  document.documentElement.append(style);

  /** @param {string} s @returns {string} HTML-escaped */
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------------------------------------------------------------------------
  // Language detection
  // ---------------------------------------------------------------------------

  // Indentation style of text: tabs, 2 / 4 / ... spaces, or mixed (from first 5,000 lines)
  /** @param {string} text @returns {string|null} */
  function indentation(text) {
    let tabs = 0;
    let spaces = 0;
    let prev = 0;
    const steps = new Map(); // indent change between lines -> how often
    let count = 0;
    for (const line of text.split('\n', 5000)) {
      if (!line.trim()) continue;
      const lead = line.match(/^[ \t]*/)[0];
      if (lead.includes('\t')) {
        tabs++;
        prev = 0;
        continue;
      }
      if (lead.length) spaces++;
      const step = Math.abs(lead.length - prev);
      if (step) steps.set(step, (steps.get(step) || 0) + 1);
      prev = lead.length;
      count++;
    }
    if (!tabs && !spaces) return count ? 'none' : null;
    if (tabs && spaces > tabs / 4 && tabs > spaces / 4) return 'mixed (tabs and spaces)';
    if (tabs > spaces) return 'tabs';
    let best = 0;
    let most = 0;
    for (const [step, n] of steps) {
      if (step <= 8 && (n > most || (n === most && step < best))) {
        best = step;
        most = n;
      }
    }
    return best ? `${best} spaces` : 'spaces';
  }

  const LANG_NAMES = {
    json: 'JSON',
    xml: 'XML',
    yaml: 'YAML',
    ifc: 'IFC (STEP)',
    toml: 'TOML',
    m: 'Power Query M',
    js: 'JavaScript',
    md: 'Markdown',
    rst: 'reStructuredText',
    csv: 'CSV',
    xlf: 'Excel formulas',
    sql: 'SQL',
    py: 'Python',
  };

  /** @param {string} name @returns {string|null} */
  const langOf = (name) => (LANGS.find(([, re]) => re.test(name)) || [null])[0];

  // ---------------------------------------------------------------------------
  // Highlighters: text -> [[cssClass, text], ...]
  // ---------------------------------------------------------------------------

  /** @param {string} text @param {RegExp} re @param {(m: RegExpMatchArray, out: Token[]) => void} onMatch @param {(s: string, out: Token[]) => void} [onGap] @returns {Token[]} */
  function tokenise(text, re, onMatch, onGap = (s, out) => out.push(['', s])) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue;
      if (m.index > last) onGap(text.slice(last, m.index), out);
      onMatch(m, out);
      last = m.index + m[0].length;
    }
    if (last < text.length) onGap(text.slice(last), out);
    return out;
  }

  const JSON_RE =
    /("(?:\\.|[^"\\\n])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b|([{}[\],:])/g;

  /** @param {string} text @returns {Token[]} */
  const highlightJson = (text) =>
    tokenise(text, JSON_RE, (m, out) => {
      if (m[1] && m[2]) out.push(['key', m[1]], ['punct', m[2]]);
      else if (m[1]) out.push(['str', m[1]]);
      else if (m[3]) out.push(['num', m[3]]);
      else if (m[4]) out.push(['lit', m[4]]);
      else out.push(['punct', m[5]]);
    });

  const XML_RE = new RegExp(
    [
      /(<!--[\s\S]*?-->)/.source, // 1 comment
      /(<!\[CDATA\[[\s\S]*?\]\]>)/.source, // 2 CDATA
      /(<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>)/.source, // 3 declaration
      /(<\/?[A-Za-z_][\w:.-]*)/.source + // 4 tag start
        /((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)/.source + // 5 attributes
        /(\s*\/?>)/.source, // 6 tag end
      /(&[#\w]+;)/.source, // 7 entity
    ].join('|'),
    'g',
  );

  const XML_ATTR_RE = /([^\s=]+)(\s*=\s*)?("[^"]*"|'[^']*')?/g;

  /** @param {string} text @returns {Token[]} */
  const highlightXml = (text) =>
    tokenise(text, XML_RE, (m, out) => {
      if (m[1]) out.push(['com', m[1]]);
      else if (m[2]) out.push(['meta', m[2]]);
      else if (m[3]) out.push(['meta', m[3]]);
      else if (m[4]) {
        out.push(['tag', m[4]]);
        if (m[5]) {
          out.push(
            ...tokenise(m[5], XML_ATTR_RE, (a, o) => {
              o.push(['attr', a[1]]);
              if (a[2]) o.push(['punct', a[2]]);
              if (a[3]) o.push(['aval', a[3]]);
            }),
          );
        }
        out.push(['tag', m[6]]);
      } else out.push(['ent', m[7]]);
    });

  const IFC_RE = new RegExp(
    [
      /(\/\*[\s\S]*?\*\/)/.source, // 1 comment
      /('(?:[^']|'')*')/.source, // 2 string
      /(#\d+)/.source, // 3 instance reference
      /(\.[A-Z_][A-Z0-9_]*\.)/.source, // 4 enum / boolean
      /(END-ISO-10303-21|ISO-10303-21|\bHEADER\b|\bDATA\b|\bENDSEC\b)/.source, // 5 keyword
      /\b([A-Z][A-Z0-9_]*)(?=\s*\()/.source, // 6 entity type
      /(-?\b\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?)/.source, // 7 number
      /([$*])/.source, // 8 unset / derived
      /([()=,;])/.source, // 9 punctuation
    ].join('|'),
    'gi',
  );

  const IFC_CLASSES = [null, 'com', 'str', 'ref', 'enum', 'kw', 'type', 'num', 'lit', 'punct'];
  /** @param {string} text @returns {Token[]} */
  const highlightIfc = (text) =>
    tokenise(text, IFC_RE, (m, out) => {
      const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
      out.push([IFC_CLASSES[i], m[0]]);
    });

  const YAML_SCALAR_RE =
    /^(true|false|yes|no|on|off|null|~|[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+|\.inf|\.nan)|0x[0-9a-fA-F]+|0o[0-7]+)$/i;
  const YAML_KEY_RE = /^("(?:\\.|[^"\\])*"|'(?:[^']|'')*'|[^\s#'"[\]{},&*!|>%@`][^#]*?)(\s*:)(?=\s|$)/;
  const YAML_VALUE_RE = new RegExp(
    [
      /("(?:\\.|[^"\\])*"?|'(?:[^']|'')*'?)/.source, // 1 quoted string
      /((?:^|(?<=\s))#.*$)/.source, // 2 comment
      /([&*][^\s,[\]{}]+)/.source, // 3 anchor / alias
      /(![^\s]*)/.source, // 4 tag
      /((?<=^\s*)[|>][-+0-9]*(?=\s*(?:#.*)?$)|[[\]{},])/.source, // 5 block indicator / flow punctuation
    ].join('|'),
    'g',
  );

  /** @param {string} s @param {Token[]} out @returns {void} */
  function yamlValue(s, out) {
    out.push(
      ...tokenise(
        s,
        YAML_VALUE_RE,
        (m, o) => {
          if (m[1]) o.push(['str', m[1]]);
          else if (m[2]) o.push(['com', m[2]]);
          else if (m[3]) o.push(['anchor', m[3]]);
          else if (m[4]) o.push(['meta', m[4]]);
          else o.push(['punct', m[5]]);
        },
        (plain, o) => {
          const lead = plain.match(/^\s*/)[0];
          const trail = plain.slice(lead.length).match(/\s*$/)[0];
          const core = plain.slice(lead.length, plain.length - trail.length);
          if (lead) o.push(['', lead]);
          if (core) {
            const cls = !YAML_SCALAR_RE.test(core) ? 'str' : /^[-+]?[\d.]/.test(core) ? 'num' : 'lit';
            o.push([cls, core]);
          }
          if (trail) o.push(['', trail]);
        },
      ),
    );
  }

  /** @param {string} text @returns {Token[]} */
  function highlightYaml(text) {
    const out = [];
    let blockIndent = null; // inside a | or > block scalar: lines are plain string content
    text.split('\n').forEach((line, i) => {
      if (i) out.push(['', '\n']);
      const indent = line.match(/^ */)[0].length;
      if (blockIndent !== null) {
        if (!line.trim() || indent > blockIndent) {
          out.push(['str', line]);
          return;
        }
        blockIndent = null;
      }
      if (/(?:^|:\s+|-\s+)(?:[&!][^\s]*\s+)*[|>][-+0-9]*$/.test(stripYamlComment(line).trim())) {
        blockIndent = indent;
      }
      const doc = line.match(/^(---|\.\.\.)(?=\s|$)/);
      if (doc) {
        out.push(['kw', doc[1]]);
        yamlValue(line.slice(3), out);
        return;
      }
      if (/^\s*#/.test(line)) {
        out.push(['com', line]);
        return;
      }
      const lead = line.match(/^(\s*)((?:-(?:\s+|$))*)/);
      if (lead[1]) out.push(['', lead[1]]);
      if (lead[2]) out.push(['punct', lead[2]]);
      let rest = line.slice(lead[0].length);
      const key = rest.match(YAML_KEY_RE);
      if (key) {
        out.push(['key', key[1]], ['punct', key[2]]);
        rest = rest.slice(key[0].length);
      }
      yamlValue(rest, out);
    });
    return out;
  }

  const TOML_BARE_OR_QUOTED = /(?:[A-Za-z0-9_-]+|"(?:\\.|[^"\\\n])*"|'[^'\n]*')/.source;
  const TOML_KEY = `${TOML_BARE_OR_QUOTED}(?:[ \\t]*\\.[ \\t]*${TOML_BARE_OR_QUOTED})*`;
  const TOML_RE = new RegExp(
    [
      /^([ \t]*)(\[\[?[^\]\n]*\]\]?)(?=[ \t]*(?:#|$))/.source, // 1 indent, 2 [table] / [[array of tables]]
      `(?:^|(?<=[{,]))([ \\t]*)(${TOML_KEY})([ \\t]*=)`, // 3 indent, 4 key, 5 "="
      /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'[^'\n]*')/.source, // 6 string
      /(#[^\n]*)/.source, // 7 comment
      /(\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)/
        .source, // 8 date/time
      /((?<![\w.-])[+-]?(?:0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|inf|nan|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?)(?![\w.-]))/
        .source, // 9 number
      /\b(true|false)\b/.source, // 10 boolean
      /([[\]{},])/.source, // 11 punctuation
    ].join('|'),
    'gm',
  );

  /** @param {string} text @returns {Token[]} */
  const highlightToml = (text) =>
    tokenise(text, TOML_RE, (m, out) => {
      if (m[2]) {
        if (m[1]) out.push(['', m[1]]);
        out.push(['type', m[2]]);
      } else if (m[4]) {
        if (m[3]) out.push(['', m[3]]);
        out.push(['key', m[4]], ['punct', m[5]]);
      } else if (m[6]) out.push(['str', m[6]]);
      else if (m[7]) out.push(['com', m[7]]);
      else if (m[8] || m[9]) out.push(['num', m[0]]);
      else if (m[10]) out.push(['lit', m[10]]);
      else out.push(['punct', m[11]]);
    });

  // Power Query M
  const M_KEYWORDS = 'let|in|each|if|then|else|try|otherwise|catch|error|and|or|not|as|is|meta|section|shared|type';
  const M_TYPES =
    'any|anynonnull|binary|date|datetime|datetimezone|duration|function|list|logical|none|null|' +
    'number|record|table|text|time|nullable|optional';
  const M_RE = new RegExp(
    [
      /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.source, // 1 comment
      /(#"(?:[^"]|"")*")/.source, // 2 quoted identifier
      /("(?:[^"]|"")*")/.source, // 3 string
      /(#(?:date|datetime|datetimezone|duration|time|table|binary|infinity|nan|sections|shared)\b)/.source, // 4 intrinsic
      `\\b(${M_KEYWORDS})\\b`, // 5 keyword
      /\b(true|false|null)\b/.source, // 6 literal
      `\\b(${M_TYPES})\\b(?!\\s*\\.)`, // 7 type
      /\b([A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\b/.source, // 8 library name (Table.AddColumn, Int64.Type)
      /\b(0x[0-9A-Fa-f]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/.source, // 9 number
      /(=>|<>|<=|>=|\.\.\.|\.\.|[=<>+\-*/&?@!]|[()[\]{},;])/.source, // 10 operator / punctuation
    ].join('|'),
    'g',
  );

  const M_CLASSES = [null, 'com', 'key', 'str', 'meta', 'kw', 'lit', 'type', 'enum', 'num', 'punct'];
  /** @param {string} text @returns {Token[]} */
  const highlightM = (text) =>
    tokenise(text, M_RE, (m, out) => {
      const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
      out.push([M_CLASSES[i], m[0]]);
    });

  // JavaScript
  const JS_KEYWORDS =
    'async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|' +
    'extends|finally|for|from|function|get|if|import|in|instanceof|let|new|of|return|set|static|' +
    'super|switch|this|throw|try|typeof|var|void|while|with|yield';
  const JS_RE = new RegExp(
    [
      /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.source, // 1 comment
      /(`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/.source, // 2 string / template
      // 3 regex literal (only where value may start, so "a / b" stays division)
      /((?<=(?:^|[=(,:;!&|?{}[+\-*%<>~^])\s*|\b(?:return|typeof|case|do|else|in|of|void|yield|await)\s+)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*)/
        .source,
      `\\b(${JS_KEYWORDS})\\b`, // 4 keyword
      /\b(true|false|null|undefined|NaN|Infinity)\b/.source, // 5 literal
      /\b(0[xX][\da-fA-F_]+n?|0[oO][0-7_]+n?|0[bB][01_]+n?|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?)\b/.source, // 6 number
      /\b([A-Z][\w$]*)\b/.source, // 7 class / constructor name
      /([A-Za-z_$][\w$]*)(?=\s*\()/.source, // 8 function call
      /(=>|[{}()[\];,.?:]|[-+*/%=&|^!<>~]+)/.source, // 9 operator / punctuation
    ].join('|'),
    'gm',
  );

  const JS_CLASSES = [null, 'com', 'str', 'meta', 'kw', 'lit', 'num', 'type', 'enum', 'punct'];
  /** @param {string} text @returns {Token[]} */
  const highlightJs = (text) =>
    tokenise(text, JS_RE, (m, out) => {
      const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
      out.push([JS_CLASSES[i], m[0]]);
    });

  // Python
  const PY_KEYWORDS =
    'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|' +
    'global|if|import|in|is|lambda|match|case|nonlocal|not|or|pass|raise|return|try|while|with|yield';
  const PY_RE = new RegExp(
    [
      /(#[^\n]*)/.source, // 1 comment
      // 2 string: prefixes (r, b, f, ...), triple quoted (multi-line) or single line
      /((?:\b[rRbBuUfF]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))/.source,
      /(@[\w.]+)/.source, // 3 decorator
      `\\b(${PY_KEYWORDS})\\b`, // 4 keyword
      /\b(True|False|None|self|cls)\b/.source, // 5 literal
      /\b(0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?j?)\b/.source, // 6 number
      /\b([A-Z]\w*)\b/.source, // 7 class name
      /([A-Za-z_]\w*)(?=\s*\()/.source, // 8 function call
      /([{}()[\];,.:]|[-+*/%=&|^!<>~@]+)/.source, // 9 operator / punctuation
    ].join('|'),
    'gm',
  );
  const PY_CLASSES = [null, 'com', 'str', 'meta', 'kw', 'lit', 'num', 'type', 'enum', 'punct'];

  /** @param {string} text @returns {Token[]} */
  const highlightPy = (text) =>
    tokenise(text, PY_RE, (m, out) => {
      const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
      out.push([PY_CLASSES[i], m[0]]);
    });

  // Markdown (line by line; fenced code blocks are kept as plain string content)
  const MD_INLINE_RE = new RegExp(
    [
      /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.source, // 1-2 `code`
      /(\*\*|__)(?=\S)([\s\S]*?\S)\3/.source, // 3-4 **bold**
      /(\*|_)(?=\S)([\s\S]*?\S)\5(?![\w*])/.source, // 5-6 *emphasis*
      /(!?\[)([^\]\n]*)(\]\()([^)\s]*)((?:\s+"[^"]*")?\))/.source, // 7-11 [text](url) / ![alt](url)
      /(<(?:https?:\/\/|mailto:)[^>\s]+>|\bhttps?:\/\/[^\s<>()]+)/.source, // 12 link
      /(<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>)/.source, // 13 HTML tag
    ].join('|'),
    'g',
  );

  /** @param {string} text @param {Token[]} out @returns {void} */
  function mdInline(text, out) {
    out.push(
      ...tokenise(text, MD_INLINE_RE, (m, o) => {
        if (m[1]) o.push(['str', m[0]]);
        else if (m[3]) o.push(['type', m[0]]);
        else if (m[5]) o.push(['enum', m[0]]);
        else if (m[7]) o.push(['punct', m[7]], ['key', m[8]], ['punct', m[9]], ['aval', m[10]], ['punct', m[11]]);
        else if (m[12]) o.push(['aval', m[12]]);
        else o.push(['tag', m[13]]);
      }),
    );
  }

  /** @param {string} text @returns {Token[]} */
  function highlightMd(text) {
    const out = [];
    let fence = null; // end marker of open ``` / ~~~ block
    text.split('\n').forEach((line, i) => {
      if (i) out.push(['', '\n']);
      if (fence) {
        if (line.trim().startsWith(fence)) {
          out.push(['meta', line]);
          fence = null;
        } else {
          out.push(['str', line]);
        }
        return;
      }
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (open) {
        fence = open[1];
        out.push(['meta', line]);
        return;
      }
      if (/^\s{0,3}#{1,6}(\s|$)/.test(line) || (/^\s{0,3}(=+|-+)\s*$/.test(line) && i > 0)) {
        out.push(['kw', line]); // heading or setext underline
        return;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out.push(['punct', line]); // horizontal rule
        return;
      }
      const lead = line.match(/^(\s*(?:>\s?)*)((?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/);
      if (lead[1]) out.push(['punct', lead[1]]);
      if (lead[2]) out.push(['punct', lead[2]]);
      const rest = line.slice(lead[0].length);
      if (/^\s*\|/.test(rest) || /\|\s*$/.test(rest)) {
        // table row: pipes as punctuation
        rest.split(/(\|)/).forEach((part) => (part === '|' ? out.push(['punct', part]) : mdInline(part, out)));
      } else {
        mdInline(rest, out);
      }
    });
    return out;
  }

  // reStructuredText (line by line; literal blocks after "::" are kept as plain string content)
  const RST_INLINE_RE = new RegExp(
    [
      /(``[\s\S]+?``)/.source, // 1 ``literal``
      /(:[\w.+-]+:)(`[^`]+`)/.source, // 2-3 :role:`text`
      /(`[^`]+`__?)/.source, // 4 `link <url>`_ / `reference`_
      /(\*\*(?=\S)[\s\S]*?\S\*\*)/.source, // 5 **strong**
      /(\*(?=\S)[^*]*?\S\*)/.source, // 6 *emphasis*
      /(\|[^|\s][^|]*\|_{0,2})/.source, // 7 |substitution|
      /(\[[#*\w.-]+\]_)/.source, // 8 [footnote]_
      /(\bhttps?:\/\/[^\s<>`]+)/.source, // 9 link
    ].join('|'),
    'g',
  );

  /** @param {string} text @param {Token[]} out @returns {void} */
  function rstInline(text, out) {
    out.push(
      ...tokenise(text, RST_INLINE_RE, (m, o) => {
        if (m[1]) o.push(['str', m[1]]);
        else if (m[2]) o.push(['meta', m[2]], ['str', m[3]]);
        else if (m[4]) o.push(['aval', m[4]]);
        else if (m[5]) o.push(['type', m[5]]);
        else if (m[6]) o.push(['enum', m[6]]);
        else if (m[7]) o.push(['anchor', m[7]]);
        else if (m[8]) o.push(['anchor', m[8]]);
        else o.push(['aval', m[9]]);
      }),
    );
  }

  const RST_ADORNMENT_RE = /^([=\-`:'"~^_*+#<>.])\1{2,}\s*$/;

  /** @param {string} text @returns {Token[]} */
  function highlightRst(text) {
    const out = [];
    const lines = text.split('\n');
    let literal = null; // indent of paragraph that ended in "::"
    let literalStarted = false;
    lines.forEach((line, i) => {
      if (i) out.push(['', '\n']);
      const indent = line.match(/^\s*/)[0].length;

      if (literal !== null) {
        if (!line.trim()) {
          out.push(['', line]);
          return;
        }
        if (indent > literal) {
          literalStarted = true;
          out.push(['str', line]);
          return;
        }
        if (literalStarted || indent <= literal) literal = null;
      }

      const next = lines[i + 1] || '';
      if (RST_ADORNMENT_RE.test(line)) {
        out.push(['kw', line]); // section over-/underline
        return;
      }
      if (line.trim() && RST_ADORNMENT_RE.test(next) && next.trim().length >= line.trim().length) {
        out.push(['kw', line]); // section title
        return;
      }

      const directive = line.match(/^(\s*\.\.\s+)((?:\|[^|]+\|\s+)?[\w:.-]+::)(.*)$/);
      if (directive) {
        out.push(['meta', directive[1] + directive[2]]);
        rstInline(directive[3], out);
        // Indented body of code directive is code: show it as plain string content
        literal = /^(code|code-block|sourcecode|highlight)::/.test(directive[2]) ? indent : null;
        literalStarted = false;
        return;
      }
      const target = line.match(/^(\s*\.\.\s+)(_[^:]+:|\[[^\]]+\])(.*)$/);
      if (target) {
        out.push(['meta', target[1]], ['anchor', target[2]], ['aval', target[3]]);
        return;
      }
      if (/^\s*\.\.(\s|$)/.test(line)) {
        out.push(['com', line]); // comment
        return;
      }

      const lead = line.match(/^(\s*)((?:[-*+•]|\d+[.)]|#\.|\(?[a-zA-Z0-9]\))\s+)?(:[^:\s][^:]*:(?=\s|$))?/);
      if (lead[1]) out.push(['', lead[1]]);
      if (lead[2]) out.push(['punct', lead[2]]);
      if (lead[3]) out.push(['key', lead[3]]);
      rstInline(line.slice(lead[0].length), out);

      if (/::\s*$/.test(line)) {
        literal = indent;
        literalStarted = false;
      }
    });
    return out;
  }

  // CSV: one colour per column (cycles); "quoted" fields may hold separators, "" and breaks
  const SEPARATOR_NAMES = {
    ',': 'comma',
    ';': 'semicolon',
    '\t': 'tab',
    '  ': '2 spaces',
    '    ': '4 spaces',
    '        ': '8 spaces',
  };
  const CSV_COLOURS = ['key', 'str', 'num', 'type', 'enum', 'meta', 'anchor', 'attr'];

  // Delimiter: , ; or tab, one in every first line most often (ties: that order);
  // else widest run of spaces that splits all lines alike
  /** @param {string} text @returns {',' | ';' | '\t'} */
  function csvSeparator(text) {
    const lines = text
      .split('\n', 6)
      .filter((l) => l.trim())
      .slice(0, 5);
    let best = ',';
    let bestScore = -1;
    for (const sep of [',', ';', '\t']) {
      const counts = lines.map((line) => {
        let n = 0;
        let quoted = false;
        for (const c of line) {
          if (c === '"') quoted = !quoted;
          else if (c === sep && !quoted) n++;
        }
        return n;
      });
      const score = counts.length ? Math.min(...counts) : 0;
      if (score > bestScore) {
        bestScore = score;
        best = sep;
      }
    }
    if (bestScore > 0) return best;
    // Spaces: widest gap that splits every line into same number (> 1) of columns
    for (const sep of ['        ', '    ', '  ']) {
      const counts = new Set(parseCsv(lines.join('\n'), sep).map((r) => r.length));
      if (lines.length && counts.size === 1 && !counts.has(1)) return sep;
    }
    return best;
  }

  /** @param {string} text @returns {Token[]} */
  function highlightCsv(text) {
    const sep = csvSeparator(text);
    const out = [];
    let col = 0;
    let field = '';
    let quoted = false;

    const flush = () => {
      if (field) out.push([CSV_COLOURS[col % CSV_COLOURS.length], field]);
      field = '';
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        field += c;
        if (c === '"') {
          if (text[i + 1] === '"')
            field += text[++i]; // "" inside quotes
          else quoted = false;
        }
      } else if (c === '"') {
        field += c;
        quoted = true;
      } else if (c === sep) {
        flush();
        out.push(['punct', c]);
        col++;
      } else if (c === '\n') {
        flush();
        out.push(['', c]);
        col = 0;
      } else {
        field += c;
      }
    }
    flush();
    return out;
  }

  // Excel formulas (.xlf), any UI language: functions by their "(", errors by "#".
  // Argument separator , or ; from text (with ; decimal separator is ,).
  /** @param {string} text @returns {',' | ';'} */
  function xlfSeparator(text) {
    let commas = 0;
    let semis = 0;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        i = text.indexOf('"', i + 1);
        while (i !== -1 && text[i + 1] === '"') i = text.indexOf('"', i + 2);
        if (i === -1) break;
      } else if (c === '/' && text[i + 1] === '/') {
        i = text.indexOf('\n', i);
        if (i === -1) break;
      } else if (c === '/' && text[i + 1] === '*') {
        i = text.indexOf('*/', i + 2);
        if (i === -1) break;
      } else if (c === '(' || c === '{') depth++;
      else if (c === ')' || c === '}') depth = Math.max(0, depth - 1);
      else if (depth && c === ',') commas++;
      else if (depth && c === ';') semis++;
    }
    return semis > commas ? ';' : ',';
  }

  const XLF_ERRORS = '#[\\p{L}\\p{N}_/]+[!?]?';
  const XLF_REF =
    "((?:'(?:[^']|'')+'|[\\p{L}_][\\p{L}\\p{N}_.]*)!)?" + // optional sheet: Tabelle1! or 'My sheet'!
    '(\\$?[A-Za-z]{1,3}\\$?\\d+(?::\\$?[A-Za-z]{1,3}\\$?\\d+)?' + // A1, $A$1, A1:B2
    '|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d+:\\$?\\d+' + // A:C, 1:3
    '|R(?:\\[-?\\d+\\]|\\d+)?C(?:\\[-?\\d+\\]|\\d+)?)'; // R1C1, R[-1]C[2]

  /** @param {string} text @returns {Token[]} */
  function highlightXlf(text) {
    const decimal = xlfSeparator(text) === ';' ? ',' : '\\.';
    const re = new RegExp(
      [
        '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1 comment
        '("(?:[^"]|"")*")', // 2 text
        `(${XLF_ERRORS})`, // 3 error value
        '(^[ \\t]*[\\p{L}_][\\p{L}\\p{N}_.]*(?=[ \\t]*=(?!=)))', // 4 name definition (Name = ...)
        `(?<![\\p{L}\\p{N}_.$])${XLF_REF}(?![\\p{L}\\p{N}_(.!])`, // 5-6 cell reference
        '([\\p{L}_][\\p{L}\\p{N}_.]*)(?=\\s*\\()', // 7 function
        `((?<![\\p{L}\\p{N}_.])\\d+(?:${decimal}\\d+)?(?:[eE][+-]?\\d+)?%?)`, // 8 number
        '(<>|<=|>=|[-+*/^&=<>:@#%]|[,;(){}\\\\])', // 9 operator / separator
      ].join('|'),
      'gimu',
    );
    return tokenise(text, re, (m, out) => {
      if (m[1]) out.push(['com', m[1]]);
      else if (m[2]) out.push(['str', m[2]]);
      else if (m[3]) out.push(['attr', m[3]]);
      else if (m[4]) out.push(['key', m[4]]);
      else if (m[6]) {
        if (m[5]) out.push(['meta', m[5]]);
        out.push(['ref', m[6]]);
      } else if (m[7]) out.push(['type', m[7]]);
      else if (m[8]) out.push(['num', m[8]]);
      else out.push(['punct', m[9]]);
    });
  }

  // SQL (any dialect)
  const SQL_KEYWORDS = [
    'ADD',
    'ALL',
    'ALTER',
    'AND',
    'ANY',
    'AS',
    'ASC',
    'BEGIN',
    'BETWEEN',
    'BY',
    'CASCADE',
    'CASE',
    'CAST',
    'CHECK',
    'COLUMN',
    'COMMIT',
    'CONSTRAINT',
    'CREATE',
    'CROSS',
    'CURRENT',
    'DATABASE',
    'DECLARE',
    'DEFAULT',
    'DELETE',
    'DESC',
    'DISTINCT',
    'DROP',
    'ELSE',
    'END',
    'ESCAPE',
    'EXCEPT',
    'EXEC',
    'EXECUTE',
    'EXISTS',
    'FALSE',
    'FETCH',
    'FILTER',
    'FIRST',
    'FOR',
    'FOREIGN',
    'FROM',
    'FULL',
    'FUNCTION',
    'GRANT',
    'GROUP',
    'HAVING',
    'IF',
    'ILIKE',
    'IN',
    'INDEX',
    'INNER',
    'INSERT',
    'INTERSECT',
    'INTO',
    'IS',
    'JOIN',
    'KEY',
    'LAST',
    'LATERAL',
    'LEFT',
    'LIKE',
    'LIMIT',
    'MERGE',
    'NATURAL',
    'NOT',
    'NULL',
    'NULLS',
    'OFFSET',
    'ON',
    'OR',
    'ORDER',
    'OUTER',
    'OVER',
    'PARTITION',
    'PRIMARY',
    'PROCEDURE',
    'QUALIFY',
    'RECURSIVE',
    'REFERENCES',
    'REPLACE',
    'RETURN',
    'RETURNS',
    'REVOKE',
    'RIGHT',
    'ROLLBACK',
    'ROW',
    'ROWS',
    'SCHEMA',
    'SELECT',
    'SET',
    'TABLE',
    'TEMP',
    'TEMPORARY',
    'THEN',
    'TOP',
    'TRANSACTION',
    'TRIGGER',
    'TRUE',
    'TRUNCATE',
    'UNION',
    'UNIQUE',
    'UPDATE',
    'USE',
    'USING',
    'VALUES',
    'VIEW',
    'WHEN',
    'WHERE',
    'WINDOW',
    'WITH',
  ].join('|');
  const SQL_TYPES =
    'BIGINT|BINARY|BIT|BLOB|BOOLEAN|BOOL|CHAR|CLOB|DATE|DATETIME|DATETIME2|DECIMAL|DOUBLE|FLOAT|' +
    'INT|INTEGER|INTERVAL|JSON|JSONB|MONEY|NCHAR|NUMBER|NUMERIC|NVARCHAR|REAL|SERIAL|SMALLINT|' +
    'STRING|TEXT|TIME|TIMESTAMP|TIMESTAMPTZ|TINYINT|UUID|VARBINARY|VARCHAR|VARCHAR2|XML';
  const SQL_RE = new RegExp(
    [
      /(--[^\n]*|\/\*[\s\S]*?\*\/)/.source, // 1 comment
      /([NEeBbXx]?'(?:[^']|'')*'|\$\$[\s\S]*?\$\$)/.source, // 2 string (also N'..', $$..$$)
      /("(?:[^"]|"")*"|`[^`]*`|\[[^\]\n]*\])/.source, // 3 quoted name
      `\\b(${SQL_KEYWORDS})\\b`, // 4 keyword
      `\\b(${SQL_TYPES})\\b`, // 5 data type
      /([A-Za-z_][\w$]*)(?=\s*\()/.source, // 6 function
      /((?<![\w.])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.source, // 7 number
      /([@:$][A-Za-z_\d][\w$]*|\?)/.source, // 8 parameter / variable
      /(<>|<=|>=|!=|::|\|\||[-+*/%=<>~^&|!]|[(),;.])/.source, // 9 operator / punctuation
    ].join('|'),
    'gi',
  );

  const SQL_CLASSES = [null, 'com', 'str', 'key', 'kw', 'type', 'enum', 'num', 'anchor', 'punct'];
  /** @param {string} text @returns {Token[]} */
  const highlightSql = (text) =>
    tokenise(text, SQL_RE, (m, out) => {
      const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
      out.push([SQL_CLASSES[i], m[0]]);
    });

  const HIGHLIGHTERS = {
    sql: highlightSql,
    py: highlightPy,
    xlf: highlightXlf,
    csv: highlightCsv,
    md: highlightMd,
    rst: highlightRst,
    js: highlightJs,
    m: highlightM,
    json: highlightJson,
    xml: highlightXml,
    yaml: highlightYaml,
    ifc: highlightIfc,
    toml: highlightToml,
  };

  // ---------------------------------------------------------------------------
  // Linters: text -> { problems: [{ line, msg, severity }], info? }
  // ---------------------------------------------------------------------------

  /** @param {string} text @param {number} index @returns {number} 1-based line */
  const lineAt = (text, index) => {
    let n = 1;
    for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) n++;
    return n;
  };

  // Collect problems (at most MAX_PROBLEMS)
  /** @returns {{ problems: Problem[], add: (line: number, msg: string, severity?: 'error'|'warning') => void }} */
  function collector() {
    const problems = [];
    const add = (line, msg, severity = 'error') => {
      if (problems.length < MAX_PROBLEMS) problems.push({ line, msg, severity });
    };
    return { problems, add };
  }

  /** @param {string} text @returns {LintResult} */
  function lintJson(text) {
    try {
      const value = JSON.parse(text.replace(/^\uFEFF/, ''));
      const kind = Array.isArray(value) ? `array, ${value.length.toLocaleString()} items` : typeof value;
      return { problems: [], info: kind };
    } catch (e) {
      const msg = e.message.replace(/^JSON\.parse:\s*/, '');
      let line = 1;
      let m;
      if ((m = msg.match(/line (\d+)/i))) line = +m[1];
      else if ((m = msg.match(/position (\d+)/i))) line = lineAt(text, +m[1]);
      return { problems: [{ line, msg, severity: 'error' }] };
    }
  }

  /** @param {string} text @returns {LintResult} */
  function lintXml(text) {
    const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (!err) {
      return { problems: [], info: `root <${doc.documentElement.nodeName}>` };
    }
    const raw = err.textContent;
    const line = +((raw.match(/line(?: number)?\s*(\d+)/i) || [])[1] || 1);
    const msg =
      (raw.match(/error on line \d+ at column \d+:\s*([^\n]*)/i) || [])[1] ||
      raw.split('\n')[0].replace(/^XML Parsing Error:\s*/i, '');
    return { problems: [{ line, msg: msg.trim(), severity: 'error' }] };
  }

  // Remove "# comment" at end of line, if it is outside quotes
  /** @param {string} line @returns {string} */
  function stripYamlComment(line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === '\\' && quote === '"') i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
        return line.slice(0, i);
      }
    }
    return line;
  }

  // Lightweight structural checks (no full YAML parser available without libraries)
  /** @param {string} text @returns {LintResult} */
  function lintYaml(text) {
    const { problems, add } = collector();
    const stack = [{ indent: -1, keys: new Set(), lastValue: false }];
    const top = () => stack[stack.length - 1];
    let blockIndent = null; // inside a | or > block scalar

    text.split(/\r?\n/).forEach((raw, idx) => {
      const n = idx + 1;
      const indent = raw.match(/^ */)[0].length;

      if (blockIndent !== null) {
        if (!raw.trim() || indent > blockIndent) return;
        blockIndent = null;
      }
      if (/^ *\t/.test(raw)) add(n, 'Tab character used for indentation (YAML allows spaces only)');

      const line = stripYamlComment(raw).replace(/\s+$/, '');
      if (!line.trim()) return;
      if (/^(---|\.\.\.)(\s|$)/.test(line)) {
        stack.length = 1;
        stack[0].keys = new Set();
        stack[0].lastValue = false;
        return;
      }

      const lead = line.match(/^( *)((?:- +|-$)*)/);
      const rest = line.slice(lead[0].length);
      const col = lead[0].length;
      const key = rest.match(YAML_KEY_RE);

      if (!key) {
        if (lead[2] && /^[|>][-+0-9]*$/.test(rest.trim())) blockIndent = lead[1].length;
        return;
      }

      if (lead[2]) {
        // "- key: value": new mapping in list item
        while (stack.length > 1 && top().indent >= col) stack.pop();
        stack.push({ indent: col, keys: new Set(), lastValue: false });
      } else {
        while (stack.length > 1 && top().indent > col) stack.pop();
        if (top().indent < col) {
          if (top().lastValue && top().indent >= 0) {
            add(n, 'Unexpected indentation: the key above already has a value on its own line');
          }
          stack.push({ indent: col, keys: new Set(), lastValue: false });
        }
      }

      const name = key[1].replace(/^(["'])([\s\S]*)\1$/, '$2');
      const t = top();
      if (t.keys.has(name)) add(n, `Duplicate key "${name}"`);
      t.keys.add(name);

      const value = rest.slice(key[0].length).trim();
      const valueNoProps = value.replace(/^(?:[&!][^\s]*\s*)+/, '');
      if (/^[|>][-+0-9]*$/.test(valueNoProps)) {
        blockIndent = col;
        t.lastValue = true;
      } else {
        t.lastValue = valueNoProps !== '';
      }
      if (/^"/.test(valueNoProps) && !/^"(?:\\.|[^"\\])*"/.test(valueNoProps)) {
        add(n, 'Double-quoted string is not closed on this line', 'warning');
      }
      if (/^'/.test(valueNoProps) && !/^'(?:[^']|'')*'/.test(valueNoProps)) {
        add(n, 'Single-quoted string is not closed on this line', 'warning');
      }
    });
    return { problems, info: 'basic checks' };
  }

  // IFC = ISO 10303-21 (STEP physical file)
  /** @param {string} text @returns {LintResult} */
  function lintIfc(text) {
    const { problems, add } = collector();

    // Split into statements (";"-terminated), ignoring comments and string contents
    const statements = [];
    let buf = '';
    let start = 1;
    let line = 1;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') {
        line++;
        buf += ' ';
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        const stop = end === -1 ? text.length : end + 2;
        if (end === -1) add(line, 'Comment is never closed');
        for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
        i = stop - 1;
        buf += ' ';
        continue;
      }
      if (!buf.trim() && !/\s/.test(c)) start = line;
      if (c === "'") {
        let j = i + 1;
        for (; j < text.length; j++) {
          if (text[j] === "'") {
            if (text[j + 1] === "'") j++;
            else break;
          } else if (text[j] === '\n') line++;
        }
        if (j >= text.length) add(start, 'String is never closed');
        buf += "''";
        i = j;
        continue;
      }
      if (c === ';') {
        statements.push({ text: buf.trim(), line: start });
        buf = '';
        continue;
      }
      buf += c;
    }
    if (buf.trim()) add(start, 'Statement is not terminated with ";"');

    // Structure: ISO-10303-21; HEADER; ... ENDSEC; DATA; ... ENDSEC; END-ISO-10303-21;
    const ids = new Map(); // id -> line
    const refs = []; // [id, line]
    const headerSeen = new Set();
    let section = 'start';
    let entities = 0;

    for (const s of statements) {
      const upper = s.text.toUpperCase();
      if (section === 'start') {
        if (upper !== 'ISO-10303-21') add(s.line, 'File must start with "ISO-10303-21;"');
        section = 'pre';
        if (upper === 'ISO-10303-21') continue;
      }
      if (upper === 'HEADER') {
        section = 'header';
        continue;
      }
      if (upper === 'DATA' || /^DATA\s*\(/.test(upper)) {
        section = 'data';
        continue;
      }
      if (upper === 'ENDSEC') {
        if (section !== 'header' && section !== 'data') add(s.line, '"ENDSEC;" without an open section');
        section = 'between';
        continue;
      }
      if (upper === 'END-ISO-10303-21') {
        section = 'end';
        continue;
      }

      if (section === 'end') {
        add(s.line, 'Content after "END-ISO-10303-21;"');
        continue;
      }

      const open = (s.text.match(/\(/g) || []).length;
      const close = (s.text.match(/\)/g) || []).length;
      if (open !== close) add(s.line, `Unbalanced parentheses (${open} "(" vs ${close} ")")`);

      if (section === 'header') {
        const type = (upper.match(/^([A-Z_][A-Z0-9_]*)\s*\(/) || [])[1];
        if (!type) add(s.line, 'Malformed header entry');
        else headerSeen.add(type);
        continue;
      }
      if (section !== 'data') {
        add(s.line, 'Statement outside of HEADER / DATA sections');
        continue;
      }

      const m = s.text.match(/^#(\d+)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)?\s*\(([\s\S]*)\)$/);
      if (!m) {
        add(s.line, 'Malformed entity instance (expected "#id=IFCTYPE(...);")');
        continue;
      }
      entities++;
      if (ids.has(m[1])) add(s.line, `Duplicate id #${m[1]} (first defined on line ${ids.get(m[1])})`);
      else ids.set(m[1], s.line);
      for (const r of m[3].matchAll(/#(\d+)/g)) refs.push([r[1], s.line]);
    }

    if (section !== 'end') add(line, 'No "END-ISO-10303-21;" at the end of the file');
    for (const h of ['FILE_DESCRIPTION', 'FILE_NAME', 'FILE_SCHEMA']) {
      if (!headerSeen.has(h)) add(1, `Header lacks ${h}`, 'warning');
    }
    for (const [id, refLine] of refs) {
      if (!ids.has(id)) add(refLine, `Reference to undefined instance #${id}`);
    }

    problems.sort((a, b) => a.line - b.line);
    return { problems, info: `${entities.toLocaleString()} entities` };
  }

  // Power Query M: brackets, strings, comments and let / in pairs
  /** @param {string} text @returns {LintResult} */
  function lintM(text) {
    const { problems, add } = collector();
    const PAIRS = { ')': '(', ']': '[', '}': '{' };
    const stack = []; // [char, line]
    const lets = []; // lines of "let" that still need their "in"
    let line = 1;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') {
        line++;
        continue;
      }
      if (c === '/' && text[i + 1] === '/') {
        const end = text.indexOf('\n', i);
        i = (end === -1 ? text.length : end) - 1;
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        const start = line;
        const end = text.indexOf('*/', i + 2);
        const stop = end === -1 ? text.length : end + 2;
        if (end === -1) add(start, 'Comment is never closed');
        for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
        i = stop - 1;
        continue;
      }
      if (c === '"') {
        const start = line;
        let j = i + 1;
        for (; j < text.length; j++) {
          if (text[j] === '"') {
            if (text[j + 1] === '"') j++;
            else break;
          } else if (text[j] === '\n') line++;
        }
        if (j >= text.length) add(start, 'Text is never closed with "');
        i = j;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') {
        stack.push([c, line]);
        continue;
      }
      if (c === ')' || c === ']' || c === '}') {
        const top = stack.pop();
        if (!top) add(line, `Unexpected "${c}"`);
        else if (top[0] !== PAIRS[c]) add(line, `"${c}" does not match "${top[0]}" opened on line ${top[1]}`);
        continue;
      }
      if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_.#]/.test(text[i - 1] || '')) {
        const word = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];
        if (word === 'let') lets.push(line);
        else if (word === 'in' && !lets.pop()) add(line, '"in" without its "let"');
        i += word.length - 1;
      }
    }

    for (const [c, l] of stack) add(l, `"${c}" is never closed`);
    for (const l of lets) add(l, '"let" without its "in"');
    problems.sort((a, b) => a.line - b.line);
    return { problems };
  }

  const LINTERS = { json: lintJson, xml: lintXml, yaml: lintYaml, ifc: lintIfc, m: lintM };

  // ---------------------------------------------------------------------------
  // Render: tokens -> one <div> per line, with line numbers and problem marks
  // ---------------------------------------------------------------------------

  // Whitespace markers (CSS only, copied text unchanged): · per space, → per tab
  /** @param {string} html @returns {string} */
  function markWhitespace(html) {
    if (!SHOW_WHITESPACE) return html;
    return html.replace(/ +|\t/g, (ws) =>
      ws === '\t' ? '<span class="tp-tab">\t</span>' : `<span class="tp-sp">${ws}</span>`,
    );
  }

  // Big views in blocks of CHUNK_LINES: only blocks near visible area are filled
  const CHUNK_LINES = 200;

  // Fill blocks when they come near visible part of `root`, empties them when far away
  /** @param {HTMLElement} root @param {HTMLElement[]} blocks @param {(b: HTMLElement) => void} fill @param {(b: HTMLElement) => void} empty @returns {IntersectionObserver} */
  function watchBlocks(root, blocks, fill, empty) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? fill : empty)(e.target);
      },
      { root, rootMargin: '1500px 0px' },
    );
    blocks.forEach((b) => io.observe(b));
    return io;
  }

  // CSV text -> rows of cells; row.raw keeps original text for unedited rows
  /** @param {string} text @param {string} sep @returns {Array<string[] & { raw: string }>} */
  function parseCsv(text, sep) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    let start = 0;
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

  // Quote styles as in Python's csv module ('none' can break file)
  const QUOTE_MODES = {
    minimal: 'Quotes: only when needed',
    all: 'Quotes: all cells',
    nonnumeric: 'Quotes: all but numbers',
    none: 'Quotes: none',
  };
  const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

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
   * @param {HTMLElement} content @param {string[]} header @param {Array<string[] & { raw?: string }>} rows
   * @param {{ state: { sort: { col: number, dir: number }|null, filters: Map<number, { values: Set<string>|null, text: string }> },
   *   editable?: boolean, onEdit?: () => void, sep?: string }} opts
   * @returns {LineView & { csvText: () => string }}
   */
  function mountTable(content, header, rows, opts) {
    const { state } = opts;
    content.querySelectorAll(':scope > .tp-plus, :scope > .tp-col-widths').forEach((n) => n.remove()); // earlier table
    state.widths ||= new Map(); // column -> width in px (column edge drag)
    const widthStyle = document.createElement('style');
    widthStyle.className = 'tp-col-widths';
    const tableId = Math.random().toString(36).slice(2);
    const applyWidths = () => {
      widthStyle.textContent = [...state.widths]
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
        const line = opts.colour
          ? ` style="border-bottom-color: var(--tp-${CSV_COLOURS[c % CSV_COLOURS.length]})"`
          : '';
        cells +=
          `<th data-c="${c}"${drag}${line}><span class="tp-sort">${esc(header[c] ?? '')}${sort}</span>` +
          `<button class="tp-filter${active}" data-c="${c}" title="Filter">▾</button>${bin}` +
          `<span class="tp-resize" data-c="${c}" title="Drag to change the width"></span></th>`;
      }
      return `<thead><tr>${cells}</tr></thead>`;
    };

    const colourOf = (c) => (opts.colour ? ` class="tp-${CSV_COLOURS[c % CSV_COLOURS.length]}"` : '');
    const rowHtml = (i, pos) => {
      const r = rows[i];
      const edit = opts.editable ? ' contenteditable="plaintext-only"' : '';
      let cells = '';
      for (let c = 0; c < cols; c++) {
        const t = esc(r[c] ?? '');
        cells += `<td data-r="${i}" data-c="${c}"${colourOf(c)} title="${t}"${edit}>${t}</td>`;
      }
      const drag = opts.editable ? ' draggable="true" title="Drag to move this row"' : '';
      return `<tr${pos % 2 ? ' class="tp-stripe"' : ''}><td class="tp-rn" data-row="${i}"${drag}>${(i + 1).toLocaleString()}</td>${cells}</tr>`;
    };

    // Structure edits use file's order (sort and filters off first)
    const moveItem = (list, from, to) => {
      const [item] = list.splice(from, 1);
      list.splice(to > from ? to - 1 : to, 0, item);
    };
    const structure = (act, at, to) => {
      state.sort = null;
      state.filters.clear();
      if (act.startsWith('col-')) state.widths.clear(); // columns shift: widths start fresh
      if (act === 'row-insert') {
        rows.splice(at, 0, new Array(cols).fill(''));
      } else if (act === 'row-move') {
        if (at === to || at + 1 === to) return;
        moveItem(rows, at, to);
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
          moveItem(r, at, to);
        }
        allEdited = true;
      }
      build();
      opts.onEdit?.();
    };

    const ROW_HEIGHT = 23;
    const spacer = (h) => `<tr class="tp-spacer"><td colspan="${cols + 1}" style="height:${h}px"></td></tr>`;

    const build = () => {
      io?.disconnect();
      const view = viewRows();
      table.innerHTML = headHtml();
      const blocks = [];
      for (let from = 0; from < view.length; from += CHUNK_LINES) {
        const body = document.createElement('tbody');
        body.dataset.from = from;
        body.dataset.count = Math.min(CHUNK_LINES, view.length - from);
        body.innerHTML = spacer(+body.dataset.count * ROW_HEIGHT);
        table.append(body);
        blocks.push(body);
      }
      const fill = (b) => {
        if (b.dataset.on) return;
        b.innerHTML = view
          .slice(+b.dataset.from, +b.dataset.from + +b.dataset.count)
          .map((i, k) => rowHtml(i, +b.dataset.from + k))
          .join('');
        b.dataset.on = '1';
      };
      const empty = (b) => {
        if (!b.dataset.on || b.contains(document.activeElement)) return; // keep cell being edited
        b.innerHTML = spacer(b.getBoundingClientRect().height);
        delete b.dataset.on;
      };
      io = watchBlocks(content, blocks, fill, empty);
    };

    // Sort: click column title
    table.addEventListener('click', (e) => {
      if (e.target.closest('.tp-resize')) return; // end of width change, not sort
      const del = e.target.closest('.tp-col-delete');
      if (del) return void structure('col-delete', +del.dataset.c);
      const btn = e.target.closest('.tp-filter');
      if (btn) return void openFilter(btn, +btn.dataset.c);
      const th = e.target.closest('th[data-c]');
      if (!th) return;
      const col = +th.dataset.c;
      const s = state.sort;
      state.sort = !s || s.col !== col ? { col, dir: 1 } : s.dir > 0 ? { col, dir: -1 } : null;
      build();
    });

    // Filter panel: unique values with checkboxes, plus "contains" text field
    let panel = null;
    const closePanel = () => {
      panel?.remove();
      panel = null;
      document.removeEventListener('pointerdown', outside, true);
    };
    const outside = (e) => {
      if (panel && !panel.contains(e.target) && !e.target.closest('.tp-filter')) closePanel();
    };
    const openFilter = (btn, c) => {
      closePanel();
      const f = state.filters.get(c) || { values: null, text: '' };
      const counts = new Map();
      for (const r of rows) counts.set(r[c] ?? '', (counts.get(r[c] ?? '') || 0) + 1);
      const cmp = new Intl.Collator(undefined, { numeric: true }).compare;
      const values = [...counts.keys()].sort(cmp).slice(0, 1000);
      panel = document.createElement('div');
      panel.className = 'tp-filter-panel';
      panel.innerHTML = `
        <input type="text" placeholder="contains …" value="${esc(f.text)}">
        <label><input type="checkbox" data-all> <em>all</em></label>
        <div class="tp-filter-list">${values
          .map(
            (val, i) => `
          <label><input type="checkbox" data-i="${i}"${!f.values || f.values.has(val) ? ' checked' : ''}>
          ${esc(val || '(empty)')} <span>${counts.get(val)}</span></label>`,
          )
          .join('')}
        </div>
        ${counts.size > values.length ? `<small>first ${values.length} of ${counts.size} values</small>` : ''}
      `;
      const r = btn.getBoundingClientRect();
      const box = content.getBoundingClientRect();
      panel.style.left = `${Math.max(0, Math.min(r.left - box.left, box.width - 240))}px`;
      panel.style.top = `${r.bottom - box.top + 2}px`;
      content.parentElement.append(panel);
      document.addEventListener('pointerdown', outside, true);

      const boxes = [...panel.querySelectorAll('[data-i]')];
      const all = panel.querySelector('[data-all]');
      const input = panel.querySelector('input[type="text"]');
      all.checked = boxes.every((b) => b.checked);
      const apply = () => {
        const checked = boxes.filter((b) => b.checked).map((b) => values[+b.dataset.i]);
        const everything = checked.length === values.length;
        const nf = { values: everything ? null : new Set(checked), text: input.value };
        if (!nf.values && !nf.text) state.filters.delete(c);
        else state.filters.set(c, nf);
        build();
      };
      all.onchange = () => {
        boxes.forEach((b) => (b.checked = all.checked));
        apply();
      };
      panel.querySelector('.tp-filter-list').onchange = () => {
        all.checked = boxes.every((b) => b.checked);
        apply();
      };
      input.oninput = () => {
        const t = input.value.toLowerCase();
        boxes.forEach(
          (b) => (b.parentElement.style.display = values[+b.dataset.i].toLowerCase().includes(t) ? '' : 'none'),
        );
        apply();
      };
      input.focus();
    };

    // Write mode: drag row numbers / column titles to move; "+" at edges to insert
    if (opts.editable) {
      let dragging = null; // { kind: 'row'|'col', from }
      const dropTarget = (e) => {
        if (!dragging) return null;
        const el = dragging.kind === 'row' ? e.target.closest('td.tp-rn[data-row]') : e.target.closest('th[data-c]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const i = dragging.kind === 'row' ? +el.dataset.row : +el.dataset.c;
        const after = dragging.kind === 'row' ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
        return { el, to: after ? i + 1 : i, after };
      };
      const clearMarks = () =>
        table
          .querySelectorAll('.tp-drop-before, .tp-drop-after')
          .forEach((el) => el.classList.remove('tp-drop-before', 'tp-drop-after'));
      table.addEventListener('dragstart', (e) => {
        const rn = e.target.closest?.('td.tp-rn[data-row]');
        const th = e.target.closest?.('th[data-c]');
        if (!rn && !th) return;
        if (e.target.closest?.('.tp-col-delete, .tp-filter, .tp-resize')) return void e.preventDefault();
        dragging = rn ? { kind: 'row', from: +rn.dataset.row } : { kind: 'col', from: +th.dataset.c };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-tp-move', '1');
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
        const { kind, from } = dragging;
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
      let plusAt = null;
      const EDGE = 6; // px from line that count as "on line"
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
        const rn = e.target.closest('td.tp-rn[data-row]');
        const corner = e.target.closest('th.tp-rn');
        const th = e.target.closest('th[data-c]');
        if (rn || corner) {
          const r = (rn || corner).getBoundingClientRect();
          const i = rn ? +rn.dataset.row : -1;
          if (rn && e.clientY - r.top < EDGE) return showPlus('row', i, r.left, r.top);
          if (r.bottom - e.clientY < EDGE) return showPlus('row', i + 1, r.left, r.bottom);
        } else if (th) {
          const r = th.getBoundingClientRect();
          const c = +th.dataset.c;
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
        const td = e.target.closest('td[data-r]');
        if (!td) return;
        const i = +td.dataset.r;
        while (rows[i].length < cols) rows[i].push('');
        rows[i][+td.dataset.c] = td.textContent;
        edited.add(rows[i]);
        opts.onEdit?.();
      });
      table.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && e.target.closest('td[data-r]')) {
          e.preventDefault();
          e.target.blur();
        }
      });
    }

    const extras = [...content.querySelectorAll(':scope > .tp-plus')];
    content.replaceChildren(table, widthStyle, ...extras);
    applyWidths();
    build();

    // Column widths: drag lower right edge of title (upper part has "+")
    table.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.tp-resize');
      if (!handle) return;
      e.preventDefault();
      e.stopPropagation();
      const c = +handle.dataset.c;
      const startX = e.clientX;
      const startW = handle.parentElement.getBoundingClientRect().width;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        state.widths.set(c, Math.max(40, Math.round(startW + ev.clientX - startX)));
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
        const sep = opts.format?.sep || opts.sep;
        const quote = opts.format?.quote || 'minimal';
        const all = allEdited || !!opts.format?.sep || !!opts.format?.quote;
        return [header, ...rows]
          .map((r) =>
            all || edited.has(r) || r.raw === undefined ? r.map((v) => csvQuote(v ?? '', sep, quote)).join(sep) : r.raw,
          )
          .join('\n');
      },
    };
  }

  /** @param {HTMLElement} content @param {string[]} lineHtml @returns {LineView} */
  function mountLines(content, lineHtml) {
    const holder = document.createElement('div');
    holder.className = 'tp-lines';
    content.replaceChildren(holder);
    const lineHeight = parseFloat(getComputedStyle(content).lineHeight) || 19;

    const chunks = [];
    for (let from = 0; from < lineHtml.length; from += CHUNK_LINES) {
      const box = document.createElement('div');
      const count = Math.min(CHUNK_LINES, lineHtml.length - from);
      box.style.height = `${count * lineHeight}px`;
      box.dataset.from = from;
      box.dataset.count = count;
      holder.append(box);
      chunks.push(box);
    }

    const fill = (box) => {
      if (box.dataset.on) return;
      const from = +box.dataset.from;
      box.innerHTML = lineHtml.slice(from, from + +box.dataset.count).join('');
      box.style.height = '';
      box.dataset.on = '1';
    };

    const empty = (box) => {
      if (!box.dataset.on) return;
      box.style.height = `${box.getBoundingClientRect().height}px`; // keep its place
      box.replaceChildren();
      delete box.dataset.on;
    };

    const io = watchBlocks(content, chunks, fill, empty);

    return {
      stop: () => io.disconnect(),
      show: (line) => {
        const box = chunks[Math.floor((line - 1) / CHUNK_LINES)];
        if (box) fill(box);
      },
    };
  }

  /** @param {Token[]} tokens @param {Map<number, Problem[]>} problemsByLine @param {Map<number, number>} [truncated] @returns {string[]} one HTML string per line */
  function renderLines(tokens, problemsByLine, truncated = new Map()) {
    const out = [];
    let n = 1;
    let cur = '';

    const flush = () => {
      const p = problemsByLine.get(n);
      const cls = p ? (p.some((x) => x.severity === 'error') ? ' tp-err' : ' tp-warn') : '';
      const title = p ? ` title="${esc(p.map((x) => x.msg).join('\n'))}"` : '';
      const cut = truncated.get(n);
      const tail = cut ? `<span class="tp-trunc"> … ${cut.toLocaleString()} more characters</span>` : '';
      out.push(
        `<div class="tp-line${cls}" data-line="${n}"${title}>` +
          `<span class="tp-ln">${n}</span><span class="tp-code">${cur || ' '}${tail}</span></div>`,
      );
      n++;
      cur = '';
    };
    for (const [cls, val] of tokens) {
      const parts = val.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i) flush();
        if (parts[i]) {
          const html = markWhitespace(esc(parts[i]));
          cur += cls ? `<span class="tp-${cls}">${html}</span>` : html;
        }
      }
    }
    flush();
    return out; // one HTML string per line
  }

  // ---------------------------------------------------------------------------
  // Viewer: popup (default), vertical split (preview right), horizontal split (preview below)
  // ---------------------------------------------------------------------------

  // Mode icons: filled part is where preview goes
  const SPLIT_V_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7z" fill="currentColor"/>
    </svg>
  `;

  const POPUP_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor"/>
    </svg>
  `;

  // Palette: syntax colours
  const COLOUR_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2
               0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.4-9-7.4z"/>
      <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor"/>
      <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor"/>
      <circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>
    </svg>
  `;

  const REFRESH_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
      <polyline points="21 3 21 9 15 9"/>
    </svg>
  `;

  // Cache all: filled top part, arrow down to whole frame
  // Half-filled circle: light / dark
  const THEME_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>
    </svg>
  `;

  // Grid: table view
  // Lines of text (text view)
  const TEXT_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M4 6h16M4 10h16M4 14h11M4 18h14"/>
    </svg>
  `;
  // Cube (3D view)
  const CUBE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z"/>
      <path d="M3.5 7.25L12 12l8.5-4.75M12 12v9.5"/>
    </svg>
  `;
  const TABLE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <path d="M3 9h18M3 14.5h18M9.5 9v11M15.5 9v11"/>
      <path d="M3 4h18v5H3z" fill="currentColor" stroke="none" opacity=".35"/>
    </svg>
  `;

  // Cloud with arrow: upload
  const UPLOAD_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 18a4.5 4.5 0 0 1-.8-8.9A6 6 0 0 1 17.8 8a4 4 0 0 1-.8 10"/>
      <path d="M12 12v8M9 15l3-3 3 3"/>
    </svg>
  `;

  // Three dots: more options
  const MORE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>
    </svg>
  `;

  // Small bin: delete table column
  const BIN_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>
    </svg>
  `;

  const SAVE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
      <path d="M7 3v5h8V3"/>
      <rect x="7" y="13" width="10" height="8"/>
    </svg>
  `;

  // Pen: write mode
  const WRITE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>
    </svg>
  `;

  // Cancel: circle with diagonal slash (⊘)
  const STOP_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <path d="M5.6 5.6l12.8 12.8"/>
    </svg>
  `;

  const CLEAR_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="4 7 20 7"/>
      <path d="M9 7V4h6v3"/>
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/>
    </svg>
  `;

  const LOAD_ALL_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4z" fill="currentColor"/>
      <path d="M12 12v6"/>
      <polyline points="9 15 12 18 15 15"/>
    </svg>
  `;

  const SETTINGS_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M19.12 10.41 L21.52 10.76 L21.52 13.24 L19.12 13.59 L18.16 15.91 L19.61 17.85 L17.85 19.61 L15.91 18.16 L13.59 19.12 L13.24 21.52 L10.76 21.52 L10.41 19.12 L8.09 18.16 L6.15 19.61 L4.39 17.85 L5.84 15.91 L4.88 13.59 L2.48 13.24 L2.48 10.76 L4.88 10.41 L5.84 8.09 L4.39 6.15 L6.15 4.39 L8.09 5.84 L10.41 4.88 L10.76 2.48 L13.24 2.48 L13.59 4.88 L15.91 5.84 L17.85 4.39 L19.61 6.15 L18.16 8.09Z"/><circle cx="12" cy="12" r="3"/></svg>`; // gear
  const PROPS_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>`;
  const WRAP_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M3 12h15a3 3 0 0 1 0 6h-4"/>
      <polyline points="16 16 14 18 16 20"/>
      <line x1="3" y1="18" x2="10" y2="18"/>
    </svg>
  `;

  const SPLIT_H_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 12h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor"/>
    </svg>
  `;

  let viewer = null; // single open viewer, if any

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

  /** @returns {Viewer} */
  function createViewer() {
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
    box.className = `tp-viewer tp-${lastTheme}`;

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
    // Main row: [layout ▾] [edit] [cache all] [stop] [save] [upload] File: name [table] [3D] … [⋯] [copy] [✕]
    const layoutBtn = button(SPLIT_H_SVG, 'Layout: below the list / right of the list / popup', 10);
    const writeBtn = button(WRITE_SVG, 'Edit (beta, text files only)', 46, ROW1, { disabled: true, pressed: false });
    const loadAllBtn = button(LOAD_ALL_SVG, 'Cache the whole file', 82, ROW1, { disabled: true });
    const stopBtn = button(STOP_SVG, 'Stop caching', 118, ROW1, { disabled: true }); // also: cancel changes
    const saveBtn = button(SAVE_SVG, 'Save: keep the changes, ready for upload (Ctrl+S)', 154, ROW1, {
      disabled: true,
    });
    const uploadBtn = button(UPLOAD_SVG, 'Upload the saved changes to SharePoint', 190, ROW1, { disabled: true });
    // View switch (status bar, bottom right): Text | Table | 3D
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
    const tableBtn = viewBtn(TABLE_SVG, 'Table', 'Table view (CSV, Parquet)');
    const view3dBtn = viewBtn(CUBE_SVG, '3D', '3D view (IFC, IFCZIP)');
    const moreBtn = button(MORE_SVG, 'More', 0);
    moreBtn.style.left = '';
    moreBtn.style.right = '86px';

    // Menu entries (icon + label); toggles show check mark when on
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
    const themeBtn = item(THEME_SVG, 'Dark mode', { pressed: lastTheme === 'dark' });
    const colourBtn = item(COLOUR_SVG, 'Syntax colours');
    const wrapBtn = item(WRAP_SVG, 'Wrap long lines');
    const propsBtn = item(PROPS_SVG, 'Show properties');
    const refreshBtn = item(REFRESH_SVG, 'Reload this file');
    const clearBtn = item(CLEAR_SVG, 'Clear this file from the cache', { disabled: true });
    const clearAllBtn = item(CLEAR_SVG, 'Clear all files from the cache', { disabled: memoryCache.size === 0 });
    const settingsBtn = item(SETTINGS_SVG, 'Full settings …');
    const readBtn = document.createElement('button'); // read mode = edit button not pressed

    // Small drop-down under its button; closes on any click outside or on entry
    const menu = (anchor, entries, alignRight = false) => {
      const m = document.createElement('div');
      m.className = 'tp-menu';
      m.hidden = true;
      m.append(...entries);
      const close = () => {
        m.hidden = true;
        document.removeEventListener('pointerdown', outside, true);
      };
      const outside = (e) => {
        if (!m.contains(e.target) && !anchor.contains(e.target)) close();
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
        if (e.target.closest('.tp-menu-item')) close();
      });
      return m;
    };
    const layoutMenu = menu(layoutBtn, [hBtn, vBtn, pBtn]);
    const moreMenu = menu(
      moreBtn,
      [settingsBtn, themeBtn, colourBtn, wrapBtn, propsBtn, refreshBtn, clearBtn, clearAllBtn],
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
        <strong>File:</strong> <span class="tp-title-name"></span>
      </div>
    `;
    // Note: tooltip on header
    header.title =
      'Note: this viewer is primarily for text files. Parquet files may also be viewed. ' +
      'Write mode is only partially supported.';
    const titleName = title.querySelector('.tp-title-name');

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
    const version = typeof GM_info !== 'undefined' ? GM_info.script.version : '';
    const logo = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(LOGO) ? LOGO.replace(/\s+/g, '') : '';
    brand.innerHTML = `
      ${logo ? `<img src="${logo}" alt="" style="height:18px; width:auto; display:block">` : ''}
      ${version ? `<span>v${esc(version)}</span>` : ''}
    `;
    brand.title = `Sharepoint Previewer${version ? ` v${version}` : ''}`;

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
    const setMetaLines = (n) => {
      metaLines = Math.max(1, Math.min(6, n));
      savePref('tp-preview-meta-lines', String(metaLines));
      const h = lastProps ? metaLines * 15 : -4; // hidden: header ends under buttons
      metaLine.style.display = lastProps ? '' : 'none';
      metaGrip.style.display = lastProps ? '' : 'none';
      propsBtn.setAttribute('aria-pressed', String(lastProps));
      metaLine.style.height = `${h}px`;
      metaLine.style.webkitLineClamp = String(metaLines);
      header.style.setProperty('--tp-lint-top', `${44 + h + 4}px`); // not on lint: its style is observed
      const lintShown = lint.style.display !== 'none' && lint.style.display !== '';
      header.style.height = `${44 + h + 6 + (lintShown ? 18 : 0)}px`; // room for check line only when shown
    };
    metaGrip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const start = metaLines;
      metaGrip.setPointerCapture(e.pointerId);
      metaGrip.classList.add('tp-drag');
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
    metaGrip.ondblclick = () => setMetaLines(metaLines > 1 ? 1 : 6); // quick open / close

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
    setMetaLines(metaLines);
    new MutationObserver(() => setMetaLines(metaLines)).observe(lint, { attributes: true, attributeFilter: ['style'] });

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
      if (+gutter.dataset.lines === n) return;
      gutter.dataset.lines = n;
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
    csvBar.innerHTML = `
      <select class="tp-csv-sep" title="Delimiter of the saved file"></select>
      <select class="tp-csv-quote" title="Quote style of the saved file">
        <option value="">Quotes: as in the file</option>
        ${Object.entries(QUOTE_MODES)
          .map(([k, t]) => `<option value="${k}">${t}</option>`)
          .join('')}
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
    const progressBar = progress.firstElementChild;
    const progressFill = progressBar.firstElementChild;
    const progressText = progress.lastElementChild;
    // Status bar (fixed height): cache state left, view switch right
    const statusBar = document.createElement('div');
    statusBar.className = 'tp-statusbar';
    const views = document.createElement('div');
    views.className = 'tp-views';
    views.append(textBtn, tableBtn, view3dBtn);
    statusBar.append(progress, views);
    box.append(header, csvBar, content, stage3d, editorWrap, loadMoreBtn, statusBar, splitter);

    // Keep panel's events away from SharePoint's handlers (split mode: inside its DOM)
    for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown', 'keydown', 'keyup', 'contextmenu', 'wheel']) {
      box.addEventListener(type, (e) => e.stopPropagation());
    }

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
      readBtn,
      writeBtn,
      textBtn,
      tableBtn,
      view3dBtn,
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

    // Popup: drag header (not its buttons, menus or properties grip) to move window
    header.addEventListener('pointerdown', (e) => {
      if (v.mode !== 'popup' || e.button !== 0) return;
      if (e.target.closest('button, select, input, textarea, a, .tp-menu, .tp-meta-grip, .tp-lint')) return;
      if (metaLine.contains(e.target)) return; // properties stay selectable
      startMove(e, box, POPUP_POS_KEY);
    });

    const onEscape = (e) => {
      if (e.key === 'Escape' && viewer === v) {
        e.stopPropagation();
        closeViewer();
      }
    };

    // Window resized -> recompute horizontal split (it uses pixel positions)
    const onResize = () => {
      if (viewer === v && !v.selfResize && v.mode !== 'popup') layoutPage(v.mode);
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
      lastTheme = lastTheme === 'dark' ? 'light' : 'dark';
      savePref(THEME_KEY, lastTheme);
      box.classList.remove('tp-dark', 'tp-light');
      box.classList.add(`tp-${lastTheme}`);
      themeBtn.setAttribute('aria-pressed', String(lastTheme === 'dark'));
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
    writeBtn.onclick = () => (v.writeMode ? readBtn.onclick() : enterWrite(v));
    // 3D choice remembered for next IFC files (also across reloads)
    const set3d = (on) => {
      last3d = on;
      savePref('tp-preview-3d', on ? '1' : '0');
    };
    view3dBtn.onclick = () => {
      if (v.view3d) return;
      set3d(true);
      toggle3d(v);
    };
    textBtn.onclick = () => {
      if (v.view3d) {
        set3d(false);
        close3d(v);
      }
      if (tableView(v)) toggleTable();
      updateViews(v);
    };
    tableBtn.onclick = () => {
      if (v.view3d) {
        set3d(false);
        close3d(v);
      }
      if (!lastTable) toggleTable();
      updateViews(v);
    };
    const toggleTable = () => {
      if (v.writeMode && v.dirty) {
        alert('Please save your changes first, then switch the view.');
        return void flash(saveBtn);
      }
      close3d(v); // back to text / table
      lastTable = !lastTable;
      savePref('tp-preview-table', lastTable ? '1' : '0');
      applyColour(); // each view has its own colour choice
      if (v.writeMode) {
        // edit on in other view (table <-> text), on saved text
        exitWriteView(v);
        enterWrite(v);
      } else {
        v.rerender?.();
      }
    };
    readBtn.onclick = () => {
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
      const key = tableView(v) ? 'table' : 'text';
      colourPrefs[key] = !colourPrefs[key];
      savePref(key === 'table' ? COLOUR_TABLE_KEY : COLOUR_KEY, colourPrefs[key] ? '1' : '0');
      applyColour();
      v.rerender?.();
      // Saved edit not yet checked: check now that colours are on
      if (colourOn(v) && v.source?.needsLint) v.relint?.();
    };
    applyColour();

    const applyWrap = () => {
      content.classList.toggle('tp-wrap', lastWrap);
      wrapBtn.setAttribute('aria-pressed', String(lastWrap));
    };
    propsBtn.onclick = () => {
      lastProps = !lastProps;
      savePref(PROPS_KEY, lastProps ? '1' : '0');
      setMetaLines(metaLines);
    };
    wrapBtn.onclick = () => {
      lastWrap = !lastWrap;
      savePref(WRAP_KEY, lastWrap ? '1' : '0');
      applyWrap();
    };
    applyWrap();

    copyBtn.onclick = async () => {
      try {
        if (v.source && !v.source.done) {
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

  /** @param {HTMLElement} el @param {string|null} original @returns {void} */
  const restoreStyle = (el, original) => {
    if (original === null) el.removeAttribute('style');
    else el.setAttribute('style', original);
  };

  // List's card: scroll area plus its frame and scrollbars, no command bar
  /** @returns {HTMLElement|null} (also sets listRegion.scroller) */
  function listRegion() {
    const grid = document.querySelector('[role="grid"], [role="treegrid"]');
    let scroller = grid;
    for (let el = grid; el && el !== document.body; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.clientHeight > 100) {
        scroller = el;
        break;
      }
    }
    if (!scroller) return null;

    // Go up while parent only adds thin frame
    const SLACK = 24;
    const s = scroller.getBoundingClientRect();
    let card = scroller;
    for (let el = scroller.parentElement; el && el !== document.body; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      const thin =
        r.top >= s.top - SLACK &&
        r.left >= s.left - SLACK &&
        r.right <= s.right + SLACK &&
        r.bottom <= s.bottom + SLACK;
      if (!thin) break;
      card = el;
    }
    listRegion.scroller = scroller;
    return card;
  }

  // Visible right / bottom edge of list, incl. scrollbars drawn just outside it
  /** @param {HTMLElement} card @param {HTMLElement} scroller @returns {{ right: number, bottom: number }} */
  function listEdges(card, scroller) {
    const c = scroller.getBoundingClientRect();
    const REACH = 30;
    let right = c.right;
    let bottom = c.bottom;
    const root = card.parentElement || card;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n === scroller ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.contains(scroller) || n.closest('.tp-cell, .tp-head')) continue; // frames around list don't count
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const besideRight = r.top < c.bottom && r.bottom > c.top && r.left < c.right && r.right > c.right;
      const besideBelow = r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.bottom;
      if (besideRight && r.right <= c.right + REACH) right = Math.max(right, r.right);
      if (besideBelow && r.bottom <= c.bottom + REACH) bottom = Math.max(bottom, r.bottom);
    }
    return { right, bottom };
  }

  /** @returns {void} */
  function restorePage() {
    const v = viewer;
    v.regionObserver?.disconnect();
    v.regionObserver = null;
    v.containerObserver?.disconnect();
    v.containerObserver = null;
    restoreStyle(document.body, v.originalBodyStyle);
    if (v.region) {
      restoreStyle(v.region, v.regionStyle);
      v.region = null;
    }
    if (v.dock) {
      restoreStyle(v.dock, v.dockStyle);
      v.dock = null;
    }
    if (v.anchor) {
      v.anchor = null;
      document.documentElement.append(v.box); // back out of SharePoint's container
    }
    if (v.anchorParent) {
      restoreStyle(v.anchorParent, v.anchorParentStyle);
      v.anchorParent = null;
    }
  }

  // List share of space (splitter); remembered, setting is start value
  const splitFraction = (() => {
    const start = { vertical: 1 - DEFAULT_PREVIEW_SIZE, horizontal: 1 - DEFAULT_PREVIEW_SIZE };
    try {
      const kept = JSON.parse(loadPref('tp-preview-split', 'null'));
      for (const m of ['vertical', 'horizontal']) if (kept?.[m] >= 0.1 && kept[m] <= 0.9) start[m] = kept[m];
    } catch {}
    return start;
  })();

  // Element that really scrolls list vertically (prefers one that overflows)
  /** @param {Element} grid @returns {HTMLElement|null} */
  function verticalScroller(grid) {
    let bounded = null;
    for (let el = grid.parentElement; el && el !== document.body; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      if (el.clientHeight < 100 || el.getBoundingClientRect().height > window.innerHeight + 1) continue;
      if (el.scrollHeight > el.clientHeight + 1) return el;
      bounded = bounded || el;
    }
    return bounded;
  }

  // SharePoint's wrapper around file list: <div role="" style="display: contents;">
  /** @param {Element} grid @returns {HTMLElement|null} */
  function listWrapper(grid) {
    for (let el = grid.parentElement; el && el !== document.body; el = el.parentElement) {
      if (el.getAttribute('role') === '' && el.style.display === 'contents') return el;
    }
    return null;
  }

  // Space for horizontal split: scroller's visible area before it was shrunk
  /** @param {Viewer} v @returns {{ top: number, bottom: number, left: number, right: number }} */
  function dockArea(v) {
    const d = v.dockBase;
    return {
      top: Math.max(0, d.top),
      bottom: Math.min(window.innerHeight, d.bottom),
      left: d.left,
      right: d.right,
    };
  }

  /** @param {number} n @returns {string} */
  const px = (n) => `${Math.max(0, Math.round(n))}px`;

  // Keep split panel next to (vertical) or below (horizontal) shrunk list
  /** @returns {void} */
  function syncPanel() {
    const v = viewer;
    if (!v || v.mode === 'popup') return;
    const s = v.box.style;

    if (v.mode === 'horizontal' && v.anchor) {
      // In page after list wrapper, below shortened list
      if (v.box.previousElementSibling !== v.anchor) v.anchor.after(v.box);
      const sr = v.scroller.getBoundingClientRect();
      const edge = listEdges(v.region, v.scroller);
      const p = v.anchorParent;
      const pr = p.getBoundingClientRect();
      s.left = `${Math.round(sr.left - pr.left - p.clientLeft + p.scrollLeft)}px`;
      s.top = `${Math.round(edge.bottom + SPLIT_GAP - pr.top - p.clientTop + p.scrollTop)}px`;
      s.width = px(edge.right - sr.left);
      s.height = px(v.anchorSpace * (1 - splitFraction.horizontal) - 2 * SPLIT_GAP);
      return;
    }

    if (v.mode === 'horizontal' && v.dock) {
      // Fill space below shrunk scroller
      const area = dockArea(v);
      const d = v.dock.getBoundingClientRect();
      const g = v.grid.getBoundingClientRect();
      const edge = listEdges(v.dock, v.dock);
      s.left = px(Math.max(g.left, d.left));
      s.right = px(window.innerWidth - Math.min(g.right, edge.right, d.right));
      s.top = px(d.bottom + SPLIT_GAP);
      s.bottom = px(window.innerHeight - area.bottom + SPLIT_GAP);
      return;
    }

    if (v.mode === 'vertical' && v.region) {
      // Align with visible list (scroll area + its scrollbars), not card frame around it
      const sr = v.scroller.getBoundingClientRect();
      const edge = listEdges(v.region, v.scroller);

      if (v.anchor) {
        // In page after list wrapper: moves with list
        if (v.box.previousElementSibling !== v.anchor) v.anchor.after(v.box);
        const p = v.anchorParent;
        const pr = p.getBoundingClientRect();
        s.left = `${Math.round(edge.right + SPLIT_GAP - pr.left - p.clientLeft + p.scrollLeft)}px`;
        s.top = `${Math.round(sr.top - pr.top - p.clientTop + p.scrollTop)}px`;
        s.width = px(v.base.right - edge.right - SPLIT_GAP);
        s.height = px(edge.bottom - sr.top);
        return;
      }

      s.left = px(edge.right + SPLIT_GAP);
      s.right = px(window.innerWidth - v.base.right);
      s.top = px(sr.top);
      s.bottom = px(window.innerHeight - edge.bottom);
      return;
    }

    // Fallback (list not found): whole page was shrunk
    const f = splitFraction[v.mode];
    s.left = v.mode === 'vertical' ? `calc(${f * 100}vw + ${SPLIT_GAP}px)` : `${SPLIT_GAP}px`;
    s.top = v.mode === 'horizontal' ? `calc(${f * 100}vh + ${SPLIT_GAP}px)` : `${SPLIT_GAP}px`;
    s.right = `${SPLIT_GAP}px`;
    s.bottom = `${SPLIT_GAP}px`;
  }

  /** @returns {void} */
  function applySplit() {
    const v = viewer;
    const f = splitFraction[v.mode];
    const vertical = v.mode === 'vertical';
    if (vertical && v.region) {
      const size = `${Math.round(v.base.width * f)}px`;
      const st = v.region.style;
      st.width = size;
      st.maxWidth = size;
      st.minWidth = '0';
      st.flex = 'none';
    } else if (v.mode === 'horizontal' && v.anchor) {
      // List (card) gets shorter; panel goes into freed space below it
      const height = `${Math.round(v.anchorSpace * f)}px`;
      const st = v.region.style;
      st.height = height;
      st.maxHeight = height;
      st.minHeight = '0';
      st.flex = 'none';
    } else if (v.mode === 'horizontal' && v.dock) {
      const area = dockArea(v);
      const height = `${Math.round((area.bottom - area.top) * f)}px`;
      const st = v.dock.style;
      st.height = height;
      st.maxHeight = height;
      st.minHeight = '0';
      st.flex = 'none';
    } else {
      // Fallback (no list): shrink whole page (transform: <body> holds fixed parts)
      const st = document.body.style;
      st.position = 'fixed';
      st.left = '0';
      st.top = '0';
      st.width = vertical ? `${f * 100}vw` : '100vw';
      st.height = vertical ? '100vh' : `${f * 100}vh`;
      st.overflow = 'hidden';
      st.transform = 'translateZ(0)';
    }
    syncPanel();
  }

  // Let SharePoint re-measure its lists (ignored by our own resize handler)
  /** @returns {void} */
  function notifyResize() {
    const v = viewer;
    v.selfResize = true;
    window.dispatchEvent(new Event('resize'));
    v.selfResize = false;
    // List can also move (not just resize) while SharePoint re-flows
    requestAnimationFrame(syncPanel);
    setTimeout(syncPanel, 300);
  }

  // Make room for split panel (top bar, command bar, navigation untouched)
  /** @param {'popup'|'horizontal'|'vertical'} mode @returns {void} */
  function layoutPage(mode) {
    const v = viewer;
    restorePage();

    if (mode !== 'popup') {
      const region = listRegion();
      const scroller = listRegion.scroller;
      v.grid = document.querySelector('[role="grid"], [role="treegrid"]');

      if (mode === 'vertical' && region) {
        v.region = region;
        v.regionStyle = region.getAttribute('style');
        v.base = region.getBoundingClientRect(); // natural size, before it gets smaller
        v.scroller = scroller;
        v.regionObserver = new ResizeObserver(syncPanel);
        v.regionObserver.observe(region);

        // Preferred: after list wrapper (<div role="" style="display: contents;">)
        const anchor = v.grid && listWrapper(v.grid);
        if (anchor) {
          const parent = anchor.parentElement;
          v.anchor = anchor;
          v.anchorParent = parent;
          v.anchorParentStyle = parent.getAttribute('style');
          if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
          const st = v.box.style;
          st.position = 'absolute';
          st.right = st.bottom = '';
          st.margin = '0';
          anchor.after(v.box);
        }
      } else if (mode === 'horizontal' && v.grid) {
        // Preferred: after list wrapper; its container sizes list
        const anchor = region && listWrapper(v.grid);
        const dock = anchor ? null : verticalScroller(v.grid);
        if (anchor) {
          v.region = region;
          v.regionStyle = region.getAttribute('style');
          v.base = region.getBoundingClientRect(); // natural size, before it gets shorter
          v.scroller = scroller;
          // Space to share: list's visible height (list may be taller than window)
          v.anchorSpace = Math.min(v.base.height, window.innerHeight - Math.max(0, v.base.top));
          v.regionObserver = new ResizeObserver(syncPanel);
          v.regionObserver.observe(region);

          const parent = anchor.parentElement;
          v.anchor = anchor;
          v.anchorParent = parent;
          v.anchorParentStyle = parent.getAttribute('style');
          if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
          const st = v.box.style;
          st.position = 'absolute';
          st.right = st.bottom = '';
          st.margin = '0';
          anchor.after(v.box);
        } else if (dock) {
          v.dock = dock;
          v.dockStyle = dock.getAttribute('style');
          v.dockBase = dock.getBoundingClientRect(); // before it gets smaller
          v.regionObserver = new ResizeObserver(syncPanel);
          v.regionObserver.observe(dock);
        }
      }
      applySplit();
      watchContainer(v);
    }
    notifyResize();
  }

  // SharePoint's side panels change width without window resize: lay out anew
  /** @param {Viewer} v @returns {void} */
  function watchContainer(v) {
    const el = v.anchorParent || v.region?.parentElement || v.dock?.parentElement;
    if (!el) return;
    let width = Math.round(el.getBoundingClientRect().width);
    let queued = false;
    v.containerObserver = new ResizeObserver(() => {
      const now = Math.round(el.getBoundingClientRect().width);
      if (Math.abs(now - width) < 2 || queued) return; // only width: heights change with split itself
      width = now;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (viewer === v && v.mode !== 'popup') layoutPage(v.mode);
      });
    });
    v.containerObserver.observe(el);
  }

  // Splitter drag (left edge in vertical mode, top edge in horizontal mode)
  /** @param {PointerEvent} e @returns {void} */
  function startDrag(e) {
    const v = viewer;
    if (!v || v.mode === 'popup') return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('tp-drag');
    const vertical = v.mode === 'vertical';

    let queued = false;

    const onMove = (ev) => {
      let f;
      if (vertical && v.region) {
        f = (ev.clientX - v.region.getBoundingClientRect().left) / v.base.width;
      } else if (!vertical && v.anchor) {
        f = (ev.clientY - v.region.getBoundingClientRect().top) / v.anchorSpace;
      } else if (!vertical && v.dock) {
        const area = dockArea(v);
        f = (ev.clientY - area.top) / (area.bottom - area.top);
      } else {
        f = vertical ? ev.clientX / window.innerWidth : ev.clientY / window.innerHeight;
      }
      splitFraction[v.mode] = Math.min(0.9, Math.max(0.1, f));
      savePref('tp-preview-split', JSON.stringify(splitFraction));
      if (!queued) {
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          if (viewer === v) applySplit();
        });
      }
    };

    const onUp = () => {
      handle.classList.remove('tp-drag');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (viewer === v) notifyResize();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  // Card look, like SharePoint's own list card: grey border, round corners, soft shadow
  const CARD_CSS = `
    border: 1px solid var(--tp-edge);
    border-radius: 8px;
  `;

  const BOX_CSS = {
    popup: `
      position: fixed;
      left: 10vw;
      top: 10vh;
      width: 80vw;
      height: 80vh;
      ${CARD_CSS}
      box-shadow: 0 8px 32px rgba(0,0,0,.35);
    `,
    vertical: `
      position: fixed;
      left: 50vw;
      right: 0;
      top: 0;
      bottom: 0;
      ${CARD_CSS}
      box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.11);
    `,
    horizontal: `
      position: fixed;
      left: 0;
      right: 0;
      top: 50vh;
      bottom: 0;
      ${CARD_CSS}
      box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.11);
    `,
  };

  /** @param {'popup'|'horizontal'|'vertical'} mode @returns {void} */
  function setMode(mode) {
    const v = viewer;
    if (!v) return;
    v.mode = mode;
    lastMode = mode;
    savePref('tp-preview-mode', mode);

    v.box.style.cssText = `
      ${BOX_CSS[mode]}
      z-index: ${mode === 'popup' ? 2147483001 : 10}; /* popup: above SharePoint's panels; split: just above the page, below SharePoint menus */
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    `;
    v.backdrop.style.display = mode === 'popup' ? 'block' : 'none';
    v.header.style.cursor = mode === 'popup' ? 'move' : ''; // popup: drag header to move it
    if (mode === 'popup') placeMoved(v.box, POPUP_POS_KEY);
    v.splitter.className = `tp-splitter tp-splitter-${mode}`;
    v.backdrop.classList.toggle('tp-overlay', mode === 'popup');

    v.layoutBtn.innerHTML = { horizontal: SPLIT_H_SVG, vertical: SPLIT_V_SVG, popup: POPUP_SVG }[mode];
    for (const [btn, m] of [
      [v.hBtn, 'horizontal'],
      [v.vBtn, 'vertical'],
      [v.pBtn, 'popup'],
    ]) {
      const active = mode === m;
      btn.setAttribute('aria-pressed', String(active));
    }

    layoutPage(mode);
  }

  // Busy (cache in progress): drives stop button
  /** @param {Viewer} v @param {boolean} on @returns {void} */
  function setBusy(v, on) {
    v.busy = on;
    v.stopBtn.disabled = !on && !v.writeMode;
    if (!on) showCached(v);
  }

  // Cache progress (bottom left): bar and "42% (1.2 MB of 2.9 MB)
  // Idle: how much of the open file is cached; greyed without file
  /** @param {Viewer} v @returns {void} */
  function showCached(v) {
    const src = v.source;
    if (!src) {
      showProgress(v, 0, 1);
      v.progressText.textContent = 'nothing cached';
      v.progress.classList.add('tp-off');
      return;
    }
    const total = src.total || (src.done ? src.loaded : 0);
    // all bytes here (Parquet: also when not all rows are shown yet)
    const full = src.done || (total > 0 && src.loaded >= total);
    showProgress(v, full ? total : src.loaded, total);
    v.progressText.textContent = full ? `fully cached (${formatBytes(total)})` : `${v.progressText.textContent} cached`;
    // calm colour when nothing runs: blue only while caching
    v.progress.classList.toggle('tp-full', full); // only when truly complete (% is floored)
    v.progress.classList.toggle('tp-idle', !full);
    if (!full && !v.loadAllBtn.disabled) {
      const icon = LOAD_ALL_SVG.replace(/\s+/g, ' ').trim();
      v.progressText.insertAdjacentHTML(
        'beforeend',
        ` · Click <span class="tp-inline-icon tp-click" title="Cache the whole file">${icon}</span> to fully cache file`,
      );
      v.progressText.querySelector('.tp-click').onclick = () => v.loadAllBtn.click();
    }
  }

  /** @param {Viewer} v @param {number} loaded @param {number} total @returns {void} */
  function showProgress(v, loaded, total) {
    const share = total ? Math.min(1, loaded / total) : 0;
    v.progress.classList.remove('tp-off', 'tp-full', 'tp-idle');
    v.progressFill.style.width = `${(share * 100).toFixed(1)}%`;
    v.progressBar.style.display = total ? '' : 'none';
    v.progressText.textContent = total
      ? `${Math.floor(share * 100)}% (${formatBytes(loaded)} of ${formatBytes(total)})`
      : `Caching … ${formatBytes(loaded)}`;
  }

  // ---------------------------------------------------------------------------
  // Read / write mode
  // ---------------------------------------------------------------------------

  /** @param {Viewer} v @returns {boolean} */
  const canWrite = (v) => !!(v.source && !v.source.isParquet && !v.source.isZip); // archives: read only

  /** @param {Viewer} v @returns {Promise<void>} */
  async function enterWrite(v) {
    const src = v.source;
    if (v.writeMode || !canWrite(v)) return;
    if (src.total > LARGE_FILE_BYTES) {
      alert(
        'This file is too large to edit in the previewer.\n' +
          'Please download it, edit it outside, and upload it again yourself.',
      );
      return;
    }
    if (!src.done) {
      if (!confirm('To edit, the whole file has to be cached first. Cache it now?')) return;
      if (!(await v.loadAll()) || !src.done) return;
    }
    close3d(v); // edits happen in text
    v.writeMode = true;
    v.dirty = false;
    v.uploadBtn.disabled = v.staged == null; // saved changes stay uploadable
    if (v.lang === 'csv' && lastTable) {
      // CSV in table view: edit cells directly
      src.crlf = src.text.includes('\r\n');
      src.trailingNewline = /\n$/.test(src.text);
      v.tableEditing = true;
      setupCsvBar(v, csvSeparator(src.text));
      v.csvBar.style.display = 'flex';
      v.rerender?.(); // also shows chosen format in metadata
      v.saveBtn.disabled = true;
      if (csvFormat.sep || csvFormat.quote) markEdited(v); // remembered format: file changes when saved
      v.stopBtn.disabled = false;
      v.stopBtn.title = 'Cancel changes';
      v.readBtn.setAttribute('aria-pressed', 'false');
      v.writeBtn.setAttribute('aria-pressed', 'true');
      return;
    }
    src.crlf = src.text.includes('\r\n'); // Windows line ends are restored on save
    v.editor.value = src.text;
    v.updateGutter();
    v.editorWrap.style.display = '';
    v.content.style.display = 'none';
    v.loadMoreBtn.style.display = 'none';
    v.saveBtn.disabled = true;
    v.stopBtn.disabled = false;
    v.stopBtn.title = 'Cancel changes';
    v.readBtn.setAttribute('aria-pressed', 'false');
    v.writeBtn.setAttribute('aria-pressed', 'true');
    v.editor.focus();
  }

  // Pending: unsaved edits (v.dirty), saved not uploaded (v.staged)

  // Ask before pending changes lost; false = user keeps them
  /** @param {Viewer} v @returns {boolean} */
  function confirmDiscard(v) {
    if (!v.dirty && v.staged == null) return true;
    const btn = v.dirty ? v.saveBtn : v.uploadBtn;
    flash(btn);
    const question = v.dirty
      ? 'You have unsaved changes. Discard them?'
      : 'Your saved changes have not been uploaded and will be lost. Discard them?';
    if (!confirm(question)) {
      flash(btn); // show where to click
      return false;
    }
    discardEdits(v);
    return true;
  }

  // Drop pending changes; show file as cached
  /** @param {Viewer} v @returns {void} */
  function discardEdits(v) {
    const src = v.source;
    if (src && src.originalText != null) {
      src.text = src.originalText;
      src.originalText = null;
      src.lintResult = null;
      v.text = src.text;
    }
    v.dirty = false;
    v.staged = null;
    v.saveBtn.disabled = true;
    v.uploadBtn.disabled = true;
  }

  // ---------------------------------------------------------------------------
  // 3D view (IFC / IFCZIP), ifc-lite from VIEWER_3D_FOLDER on first use, SHA-256 checked.
  // Model stays in browser.
  // ---------------------------------------------------------------------------
  let ifcLibrary = null; // Promise<{ lib, wasm }> once started
  let ifcLibraryReady = false; // loaded (then IFC files open in 3D again if it was chosen)
  const view3dPoses = new Map(); // file url -> camera of its last 3D view (while this page is open)
  let last3d = loadPref('tp-preview-3d', '0') === '1'; // 3D view chosen by user

  /** @param {ArrayBuffer} buf @returns {Promise<string>} */
  async function sha256(buf) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Library (once per page)
  /** @param {(s: string) => void} onStatus @returns {Promise<{ lib: { init: Function, GeometryProcessor: *, Renderer: * }, wasm: Uint8Array }>} */
  function loadIfcLibrary(onStatus) {
    ifcLibrary ||= (async () => {
      if (!VIEWER_3D_FOLDER) throw new Error('VIEWER_3D_FOLDER is not set at the top of the script');
      const file = async (name, hash) => {
        const site = (location.pathname.match(/^\/(?:sites|teams|personal)\/[^/]+/i) || [''])[0]; // current site
        const folder = VIEWER_3D_FOLDER.startsWith('/') ? VIEWER_3D_FOLDER : `${site}/${VIEWER_3D_FOLDER}`;
        const url = `${folder.replace(/\/$/, '')}/${name}`.split('/').map(encodeURIComponent).join('/');
        if (new URL(url, location.href).origin !== location.origin)
          throw new Error('VIEWER_3D_FOLDER must be in this SharePoint');
        onStatus(`caching ${name} …`);
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`${name}: error ${res.status}`);
        const buf = await res.arrayBuffer();
        if ((await sha256(buf)) !== hash) throw new Error(`${name} does not match its checksum: not used`);
        return buf;
      };
      const [js, wasm] = await Promise.all([
        file('ifc-lite-3d.js', VIEWER_3D_JS_SHA256),
        file('ifc-lite_bg.wasm', VIEWER_3D_WASM_SHA256),
      ]);
      // Read IfcLite back in same function (sandbox may have another global)
      const lib = new Function(`${new TextDecoder().decode(js)}\n;return globalThis.IfcLite;`)();
      if (!lib) throw new Error('3D library did not start');
      ifcLibraryReady = true;
      return { lib, wasm: new Uint8Array(wasm) };
    })();
    ifcLibrary.catch(() => {
      ifcLibrary = null; // later click tries again
    });
    return ifcLibrary;
  }

  // IFC bytes in canvas; returns { pose(), dispose() }
  /** @param {*} lib @param {Uint8Array} wasm @param {HTMLCanvasElement} canvas @param {Uint8Array} ifcBytes @param {(s: string) => void} onStatus @returns {Promise<{ dispose: () => void }>} */
  async function open3dModel(lib, wasm, canvas, ifcBytes, onStatus, pose) {
    onStatus('3D engine start …');
    await (lib.ready ||= lib.init({ module_or_path: wasm })); // once per page
    // Canvas in CSS pixels, width multiple of 64 (WebGPU), set before renderer starts
    const size = () => {
      const r = canvas.getBoundingClientRect();
      return [
        Math.min(8192, Math.max(64, Math.floor(r.width / 64) * 64)),
        Math.min(8192, Math.max(1, Math.floor(r.height))),
      ];
    };
    [canvas.width, canvas.height] = size();
    const renderer = new lib.Renderer(canvas);
    const geometry = new lib.GeometryProcessor();
    // Retry: right after release browser may refuse new GPU device
    const startRenderer = async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await renderer.init();
        } catch (err) {
          if (attempt >= 5) throw err;
          await new Promise((r) => setTimeout(r, 200 * attempt));
        }
      }
    };
    await Promise.all([startRenderer(), geometry.init()]);
    onStatus('geometry build …');
    const result = await geometry.process(ifcBytes);
    renderer.loadGeometry(result);
    const camera = renderer.getCamera();
    // Whole model in view (bounds after ifc-lite's shift of far-off coordinates)
    const fit = () => {
      const b = result.coordinateInfo?.shiftedBounds;
      const extent = b && Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
      if (extent > 0 && Number.isFinite(extent)) {
        camera.fitBoundsAdaptive(
          { min: b.min, max: b.max },
          { viewportShortPx: Math.min(canvas.width, canvas.height) },
        );
      } else renderer.fitToView();
      renderer.requestRender();
    };
    fit();
    if (pose) {
      // view this file had when it was last shown
      camera.setPosition(pose.position.x, pose.position.y, pose.position.z);
      camera.setTarget(pose.target.x, pose.target.y, pose.target.z);
      camera.setUp(pose.up.x, pose.up.y, pose.up.z);
      renderer.requestRender();
    }
    onStatus(`${result.meshes.length.toLocaleString()} objects · ${result.totalTriangles.toLocaleString()} triangles`);

    let drag = null;
    const down = (e) => {
      drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.pan) camera.pan(dx, dy);
      else camera.orbit(dx, dy);
      renderer.requestRender();
    };
    const up = () => {
      drag = null;
    };
    const wheel = (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      camera.zoom(e.deltaY, false, e.clientX - r.left, e.clientY - r.top, canvas.width, canvas.height);
      renderer.requestRender();
    };
    const noMenu = (e) => e.preventDefault();
    const resize = new ResizeObserver(() => {
      renderer.resize(...size());
      renderer.requestRender();
    });
    resize.observe(canvas);

    // Draw loop: renders when asked to, and while camera still moves (inertia)
    let last = performance.now();
    let frame = 0;
    const loop = (now) => {
      const moving = camera.update(now - last);
      last = now;
      if (renderer.consumeRenderRequest() || moving) renderer.render();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const events = [
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointercancel', up],
      ['wheel', wheel],
      ['dblclick', fit],
      ['contextmenu', noMenu],
    ];
    for (const [type, fn] of events)
      canvas.addEventListener(type, fn, type === 'wheel' ? { passive: false } : undefined);
    return {
      pose: () => ({
        position: { ...camera.getPosition() },
        target: { ...camera.getTarget() },
        up: { ...camera.getUp() },
      }),
      dispose() {
        cancelAnimationFrame(frame);
        resize.disconnect();
        for (const [type, fn] of events) canvas.removeEventListener(type, fn);
        renderer.destroy();
      },
    };
  }

  // Switch 3D view on / off for open IFC file
  /** @param {Viewer} v @returns {Promise<void>} */
  async function toggle3d(v) {
    if (v.view3d) return close3d(v);
    const src = v.source;
    if (!src || v.view3dBtn.disabled) return;
    if (!navigator.gpu) {
      alert('3D view needs WebGPU (current Chrome or Edge).');
      return;
    }
    if (v.writeMode && v.dirty) {
      alert('Please save your changes first, then switch the view.');
      return void flash(v.saveBtn);
    }
    if (!src.done && !(await v.loadAll())) return; // 3D view needs whole file
    if (!src.done) return;
    if ((src.ifcBytes ? src.ifcBytes.length : src.text.length) > MAX_3D_BYTES) {
      alert(`3D view: only for IFC files up to ${formatBytes(MAX_3D_BYTES)}.`);
      return;
    }
    const file = v.file;
    const state = { disposed: false, handle: null };
    v.view3d = state;
    updateViews(v);
    v.content.style.display = 'none';
    v.editorWrap.style.display = 'none';
    v.loadMoreBtn.style.display = 'none';
    v.stage3d.style.display = 'block';
    const status = (s) => {
      v.status3d.textContent = s;
    };
    try {
      const { lib, wasm } = await loadIfcLibrary(status);
      if (state.disposed || v.file !== file) return;
      const bytes = src.ifcBytes || new TextEncoder().encode(v.writeMode ? (v.staged ?? src.text) : src.text);
      const handle = await open3dModel(lib, wasm, v.canvas3d, bytes, status, view3dPoses.get(file.url));
      if (state.disposed) handle.dispose();
      else state.handle = handle;
    } catch (err) {
      if (!state.disposed) status(`3D view failed: ${err.message}`);
    }
  }

  /** @param {Viewer} v @returns {void} */
  function close3d(v) {
    const state = v.view3d;
    if (!state) return;
    state.disposed = true;
    if (state.handle && v.file) view3dPoses.set(v.file.url, state.handle.pose()); // for next time
    state.handle?.dispose();
    v.view3d = null;
    updateViews(v);
    v.stage3d.style.display = 'none';
    v.status3d.textContent = '';
    if (v.writeMode && !v.tableEditing) v.editorWrap.style.display = '';
    else v.content.style.display = '';
    v.rerender?.();
  }

  // Back to read view (keeps saved changes, drops unsaved edits)
  /** @param {Viewer} v @returns {void} */
  function exitWriteView(v) {
    v.writeMode = false;
    v.dirty = false;
    v.tableEditing = false;
    v.csvBar.style.display = 'none'; // metadata is redrawn by rerender below
    v.editorWrap.style.display = 'none';
    v.editor.value = '';
    v.content.style.display = '';
    v.saveBtn.disabled = true;
    v.uploadBtn.disabled = v.staged == null;
    v.stopBtn.title = 'Stop caching';
    v.stopBtn.disabled = !v.busy;
    v.readBtn.setAttribute('aria-pressed', 'true');
    v.writeBtn.setAttribute('aria-pressed', 'false');
    v.rerender?.();
  }

  // Text being edited: text box, or CSV table
  /** @param {Viewer} v @returns {string} */
  function editedText(v) {
    return v.tableEditing ? v.lineView.csvText() + (v.source.trailingNewline ? '\n' : '') : v.editor.value;
  }

  // Edited: save (again) before upload
  /** @param {Viewer} v @returns {void} */
  function markEdited(v) {
    v.dirty = true;
    v.saveBtn.disabled = false;
    v.uploadBtn.disabled = true;
  }

  // Draw attention to button: blue glow that fades out over 3 seconds
  /** @param {HTMLElement} btn @returns {void} */
  function flash(btn) {
    btn.classList.remove('tp-attn');
    void btn.offsetWidth; // restart animation
    btn.classList.add('tp-attn');
    setTimeout(() => btn.classList.remove('tp-attn'), 3000);
  }

  // Upload as user would (drop, or SharePoint's upload dialogue); no API. HEAD request
  // confirms change; otherwise user can save file locally.
  /** @param {Viewer} v @param {string} edited @returns {Promise<boolean>} true once SharePoint has the new file */
  async function uploadEdits(v, edited) {
    const src = v.source;
    const url = v.file.url;
    const folder = currentFolder();
    const dir = url.slice(0, url.lastIndexOf('/'));
    if (v.linked || !folder || dir.toLowerCase() !== folder.toLowerCase()) {
      alert(
        'Uploading only works for a file in the folder that is open in SharePoint\n' +
          '(not for search results or files reached through a link).\n' +
          "Open the file's folder and upload from there.",
      );
      return false;
    }
    if (
      src.encoding &&
      src.encoding !== 'UTF-8' &&
      !confirm(`This file is ${src.encoding}. It will be uploaded as UTF-8. Continue?`)
    ) {
      return false;
    }

    let text = edited;
    if (src.crlf) text = text.replace(/\r?\n/g, '\r\n');
    const file = new File([src.bom ? `﻿${text}` : text], v.fileName, {
      type: 'text/plain',
      lastModified: Date.now(),
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);

    // How file looks on SharePoint right now; upload changes this
    const fetchUrl = url.split('/').map(encodeURIComponent).join('/');
    const stamp = async () => {
      try {
        const r = await fetch(fetchUrl, { method: 'HEAD', credentials: 'same-origin', cache: 'reload' });
        return r.ok
          ? `${r.headers.get('etag')}|${r.headers.get('last-modified')}|${r.headers.get('content-length')}`
          : null;
      } catch {
        return null;
      }
    };
    const before = await stamp();
    // Watch for SharePoint to change file (it may first ask "replace?"): up to `ms`
    const changed = async (ms) => {
      for (const end = Date.now() + ms; Date.now() < end; ) {
        await new Promise((r) => setTimeout(r, 1500));
        const now = await stamp();
        if (now && now !== before) return true;
      }
      return false;
    };

    v.uploadBtn.disabled = true;
    v.uploadBtn.title = 'Upload in progress …';
    let done = false;

    // 1. Like drop into file list
    const target = listRegion() || document.querySelector('[role="grid"], [role="treegrid"]');
    if (target) {
      const r = target.getBoundingClientRect();
      const at = { clientX: r.left + r.width / 2, clientY: r.top + Math.min(r.height / 2, 200) };
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, ...at }));
      }
      done = await changed(20000);
    }

    // 2. Like choice in SharePoint's own upload dialogue
    if (!done) {
      const input = [...document.querySelectorAll('input[type="file"]')].find((i) => !i.closest('.tp-viewer'));
      if (input) {
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        done = await changed(20000);
      }
    }

    v.uploadBtn.title = 'Upload the saved changes to SharePoint';
    if (!done) {
      v.uploadBtn.disabled = false;
      // 3. user does it: edited file is saved locally, ready to drag into folder
      if (
        confirm(
          'SharePoint did not take the file automatically.\n\n' +
            'Download the edited file now, so you can drag it into the folder yourself?\n' +
            '(Your saved changes stay in the viewer until an upload is confirmed.)',
        )
      ) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = v.fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
      return false;
    }

    // Confirmed: uploaded text is file from now on
    src.text = text;
    src.originalText = null;
    v.text = text;
    src.lintResult = null;
    return true;
  }

  // Ctrl+S / Cmd+S: save (not upload)
  document.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's' || !viewer?.writeMode) return;
      e.preventDefault(); // no "save page" dialogue
      if (!viewer.saveBtn.disabled) viewer.saveBtn.click(); // upload is separate step
    },
    true,
  );

  // Unsaved changes: browser asks before page is left
  window.addEventListener('beforeunload', (e) => {
    if (viewer && (viewer.dirty || viewer.staged != null)) e.preventDefault();
  });

  // Previewed files in memory up to MEMORY_CACHE_BYTES (least recently viewed go first)
  const memoryCache = new Map(); // url -> { src, fileName, hops }

  /** @param {{ src: Source }} entry @returns {number} bytes */
  const keptSize = (entry) => entry.src.loaded || 0; // bytes of the file cached

  // Room for `need` more bytes in the cache; else asks to clear the other files first
  /** @param {Viewer} v @param {number} need @returns {boolean} */
  function makeRoom(v, need) {
    let used = 0;
    for (const entry of memoryCache.values()) used += keptSize(entry);
    if (used + need <= MEMORY_CACHE_BYTES) return true;
    const own = memoryCache.get(v.file?.url);
    const mine = own ? keptSize(own) : 0;
    if (mine + need > MEMORY_CACHE_BYTES) {
      alert(
        `This file is bigger than the cache limit (${formatBytes(MEMORY_CACHE_BYTES)}). Raise it in the settings to cache more.`,
      );
      return false;
    }
    if (
      !confirm(
        `The cache is full (${formatBytes(used)} of ${formatBytes(MEMORY_CACHE_BYTES)}). Clear the other cached files first, then go on?`,
      )
    )
      return false;
    for (const url of [...memoryCache.keys()]) {
      if (url === v.file?.url || memoryCache.get(url).src.fullJob) continue;
      clearedUrls.add(url);
      memoryCache.delete(url);
    }
    refreshEyes();
    return true;
  }

  /** @returns {void} */
  function trimMemory() {
    let total = 0;
    for (const entry of memoryCache.values()) total += keptSize(entry);
    for (const [url, entry] of memoryCache) {
      if (total <= MEMORY_CACHE_BYTES || memoryCache.size <= 1) break;
      if (entry.src.fullJob) continue; // still caching in the background
      total -= keptSize(entry);
      memoryCache.delete(url);
    }
    refreshEyes();
  }

  /** @param {string} url @param {{ src: Source, fileName: string, hops: string[] }} entry @returns {void} */
  function keepInMemory(url, entry) {
    memoryCache.delete(url);
    memoryCache.set(url, entry);
    trimMemory();
  }

  // Cleared files: next fetch skips (and replaces) browser's stored copy
  const clearedUrls = new Set();

  // Clear every file this previewer cached (its own memory only; nothing else is touched)
  /** @returns {void} */
  function clearAllCached() {
    if (viewer?.file && memoryCache.has(viewer.file.url)) {
      clearCached(viewer);
      if (memoryCache.has(viewer.file.url)) return; // kept: pending, user stayed
    }
    for (const url of memoryCache.keys()) clearedUrls.add(url);
    memoryCache.clear();
    refreshEyes();
  }

  /** @param {Viewer} v @returns {void} */
  function clearCached(v) {
    close3d(v);
    if (v.file) forcedUrls.delete(v.file.url); // asks again next time
    cancelLoad(v, true);
    setBusy(v, false);
    clearedUrls.add(v.file.url);
    memoryCache.delete(v.file.url);
    refreshEyes();
    if (!confirmDiscard(v)) return;
    if (v.writeMode) exitWriteView(v);
    v.loadToken++; // anything still on its way is ignored
    v.source = null;
    v.writeBtn.disabled = true;
    v.rerender = null;
    v.relint = null;
    v.text = '';
    v.copyBtn.disabled = true;
    v.loadAllBtn.disabled = true;
    v.clearBtn.disabled = true;
    v.lint.style.display = 'none';
    showPlain(v, 'Cache cleared for this file. Use refresh, or open the file again, to cache it anew.');
  }

  /** @param {Viewer} v @returns {void} */
  // Cancel the fetch; a running "cache all" goes on in the background (unless `stop`)
  /** @param {Viewer} v @param {boolean} [stop] @returns {void} */
  function cancelLoad(v, stop = false) {
    if (stop || !(v.source?.fullJob || v.opening)) v.abort?.abort();
    v.opening = false;
    v.abort = null;
    v.lintWorker?.terminate(); // cancels check in progress
    v.lintWorker = null;
  }

  /** @returns {void} */
  function closeViewer() {
    if (!viewer) return;
    setTimeout(refreshEyes); // row highlight off, once viewer is gone
    if (!confirmDiscard(viewer)) return; // pending: keep viewer open
    if (viewer.writeMode) exitWriteView(viewer);
    cancelLoad(viewer);
    viewer.lineView?.stop();
    close3d(viewer);
    if (viewer.mode !== 'popup') layoutPage('popup');
    restorePage();
    viewer.removeListeners();
    viewer.backdrop.remove();
    viewer.box.remove();
    viewer = null;
  }

  /** @param {Viewer} v @param {string} message @returns {void} */
  function showPlain(v, message) {
    v.lint.style.display = 'none';
    v.loadMoreBtn.style.display = 'none';
    v.lineView?.stop();
    v.lineView = null;
    // notices: italic, grey (dark) / red (light)
    v.content.innerHTML = `<div class="tp-lines tp-notice">${renderLines([['', message]], new Map()).join('')}</div>`;
  }

  /** @param {Viewer} v @param {string} lang @returns {void} */
  function showLintWait(v, lang) {
    v.lint.style.display = 'block';
    v.lint.className = 'tp-lint tp-lint-wait';
    v.lint.innerHTML = `<div class="tp-lint-summary">… ${lang.toUpperCase()}: check in progress</div>`;
  }

  /** @param {Viewer} v @param {string} lang @param {LintResult} result @param {(line: number) => void} goToLine @returns {void} */
  function renderLint(v, lang, result, goToLine) {
    const { problems, info } = result;
    const label = lang.toUpperCase();
    const lint = v.lint;
    lint.style.display = 'block';
    lint.className = `tp-lint ${problems.length ? 'tp-lint-bad' : 'tp-lint-ok'}`;

    if (!problems.length) {
      lint.innerHTML = `<div class="tp-lint-summary">✓ ${label}: no problems${info ? ` · ${esc(info)}` : ''}</div>`;
      return;
    }

    const errors = problems.filter((p) => p.severity === 'error').length;
    const warnings = problems.length - errors;
    const parts = [];
    if (errors) parts.push(`${errors.toLocaleString()} error${errors > 1 ? 's' : ''}`);
    if (warnings) parts.push(`${warnings.toLocaleString()} warning${warnings > 1 ? 's' : ''}`);
    const capped = problems.length >= MAX_PROBLEMS ? ` (first ${MAX_PROBLEMS} shown)` : '';

    lint.innerHTML = `
      <button class="tp-lint-summary" type="button">✗ ${label}: ${parts.join(', ')}${capped} ▾</button>
      <div class="tp-lint-list" style="display:none">
        ${problems
          .map(
            (p) => `
          <div class="tp-lint-item tp-sev-${p.severity}" data-line="${p.line}">
            <b>Line ${p.line}</b>${esc(p.msg)}
          </div>
        `,
          )
          .join('')}
      </div>
    `;
    const list = lint.querySelector('.tp-lint-list');
    lint.querySelector('.tp-lint-summary').onclick = () => {
      list.style.display = list.style.display === 'none' ? 'block' : 'none';
    };
    list.onclick = (e) => {
      const item = e.target.closest('.tp-lint-item');
      if (item) goToLine(+item.dataset.line);
    };
  }

  // ---------------------------------------------------------------------------
  // Checks in Web Worker (XML on page: needs DOMParser); fallback: page
  // ---------------------------------------------------------------------------

  let lintWorkerUrl = null;
  let workersBlocked = false;

  /** @param {Viewer} v @param {string} lang @param {string} text @returns {Promise<LintResult>|null} */
  function startLintWorker(v, lang, text) {
    if (workersBlocked || !['json', 'yaml', 'ifc', 'm'].includes(lang)) return null;
    try {
      if (!lintWorkerUrl) {
        const src = `
          const MAX_PROBLEMS = ${MAX_PROBLEMS};
          const YAML_KEY_RE = ${YAML_KEY_RE};
          const lineAt = ${lineAt};
          ${stripYamlComment}
          ${collector}
          ${lintJson}
          ${lintYaml}
          ${lintIfc}
          ${lintM}
          const LINTERS = { json: lintJson, yaml: lintYaml, ifc: lintIfc, m: lintM };
          onmessage = (e) => {
            try {
              postMessage({ ok: true, result: LINTERS[e.data.lang](e.data.text) });
            } catch (err) {
              postMessage({ ok: false, error: err.message });
            }
          };
        `;
        lintWorkerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      }
      const worker = new Worker(lintWorkerUrl);
      v.lintWorker = worker;
      return new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          worker.terminate();
          if (e.data.ok) resolve(e.data.result);
          else reject(new Error(e.data.error));
        };
        worker.onerror = (e) => {
          e.preventDefault();
          worker.terminate();
          workersBlocked = true;
          reject(Object.assign(new Error('worker unavailable'), { fallback: true }));
        };
        worker.postMessage({ lang, text });
      });
    } catch {
      workersBlocked = true;
      return null;
    }
  }

  /** @param {Viewer} v @param {string} lang @param {string} text @returns {Promise<LintResult>} */
  async function lintFile(v, lang, text) {
    const linter = LINTERS[lang];

    const onPage = () => {
      try {
        return linter(text);
      } catch (err) {
        return { problems: [{ line: 1, msg: `Check failed: ${err.message}`, severity: 'warning' }] };
      }
    };
    const job = startLintWorker(v, lang, text);
    if (!job) {
      await nextFrame(); // let text appear before page is busy with check
      return onPage();
    }
    try {
      return await job;
    } catch (err) {
      if (err.fallback) return onPage();
      return { problems: [{ line: 1, msg: `Check failed: ${err.message}`, severity: 'warning' }] };
    }
  }

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------

  /** @returns {Promise<void>} */
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  /** @param {number} n @returns {string} */
  const formatBytes = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  };

  // Dates from file's own response headers
  /** @param {Response} response @param {string} cd Content-Disposition @returns {{ modified: string|null }} */
  function responseDates(response, cd) {
    const iso = (v) => {
      const d = v ? new Date(v.replace(/^"|"$/g, '')) : null;
      // "2026-10-24 08:35:13 UTC" (list dates are local time, so UTC is named)
      return d && !Number.isNaN(d.getTime()) ? `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC` : null;
    };
    return {
      modified: iso(response.headers.get('last-modified') || (cd.match(/modification-date="?([^";]+)/i) || [])[1]),
      created: iso((cd.match(/creation-date="?([^";]+)/i) || [])[1]),
    };
  }

  // Open file in chunks of MAX_BYTES, same origin only (nothing is sent elsewhere).
  // Ranges if supported, else paused transfer. Returns { error } | { binary } | source.
  /** @param {string} url @param {() => AbortSignal} getSignal @param {boolean} reload @param {(loaded: number, total: number) => void} onProgress @returns {Promise<Source|{ error: string }|{ binary: true, name?: string }>} */
  async function openSource(url, getSignal, reload, onProgress) {
    if (new URL(url, location.href).origin !== location.origin) {
      return { error: 'Not opened: the link points outside this SharePoint' };
    }
    const request = (from) =>
      fetch(url, {
        credentials: 'same-origin',
        cache: reload ? 'reload' : 'default', // 'reload': fresh copy, which also updates cache
        headers: { Range: `bytes=${from}-${from + MAX_BYTES - 1}` },
        signal: getSignal(),
      });

    let response = await request(0);
    if (response.status === 416) response = await fetch(url, { credentials: 'same-origin', signal: getSignal() }); // empty file
    if (!response.ok) return { error: `Error ${response.status} on caching` };

    // File name from SharePoint (share links have none in URL)
    const cd = response.headers.get('content-disposition') || '';
    const cdName = (cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1];
    const name = cdName ? decodeURIComponent(cdName) : (cd.match(/filename="?([^";]+)"?/i) || [])[1];

    // Obvious binary types: stop before anything is cached
    if (BINARY_TYPE_RE.test(response.headers.get('content-type') || '')) {
      response.body?.cancel();
      return { binary: true, name };
    }

    const ranged = response.status === 206;
    const src = {
      name,
      dates: responseDates(response, cd),
      total: ranged
        ? +(response.headers.get('content-range') || '').split('/')[1] || 0
        : +response.headers.get('content-length') || 0,
      loaded: 0,
      done: false,
      text: '',
    };
    let decoder = null; // chosen from first bytes
    let reader = null; // open transfer (when SharePoint ignores ranges)

    // Add bytes to text; false = binary data (only first bytes decide)
    const feed = (bytes) => {
      if (!decoder) {
        const encoding = sniffText(bytes);
        if (!encoding) return false;
        decoder = new TextDecoder(encoding);
        src.encoding = encoding.toUpperCase();
        src.bom = encoding === 'utf-8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      }
      src.loaded += bytes.length;
      src.text += decoder.decode(bytes, { stream: true });
      onProgress(src.loaded, src.total);
      return true;
    };

    const finish = () => {
      src.done = true;
      if (decoder) src.text += decoder.decode();
    };

    // Read `budget` bytes (after `skip`); 'more' | 'end' | 'binary'
    const read = async (res, budget, skip = 0) => {
      if (!res.body) {
        const all = new Uint8Array(await res.arrayBuffer()).subarray(skip);
        return feed(all) ? 'end' : 'binary';
      }
      const r = res.body.getReader();
      let got = 0;
      while (got < budget) {
        const { done, value } = await r.read();
        if (done) return 'end';
        let chunk = value;
        if (skip) {
          const drop = Math.min(skip, chunk.length);
          skip -= drop;
          chunk = chunk.subarray(drop);
          if (!chunk.length) continue;
        }
        if (!feed(chunk)) {
          r.cancel();
          return 'binary';
        }
        got += chunk.length;
      }
      reader = r; // budget reached: keep rest of this transfer for later
      return 'more';
    };

    const first = await read(response, MAX_BYTES);
    if (first === 'binary') return { binary: true, name };
    if (ranged) {
      reader?.cancel();
      reader = null;
      if (src.total && src.loaded >= src.total) finish();
    } else if (first === 'end') {
      finish();
    }

    src.more = async () => {
      if (src.done) return;
      let state;
      if (reader) {
        // Resume paused transfer; if it was cut off, new request
        const r = reader;
        reader = null;
        const signal = getSignal(); // current one: aborted only by stop from now on
        try {
          state = await read({ body: { getReader: () => r } }, MAX_BYTES);
        } catch (err) {
          if (signal.aborted) throw err; // stopped by user now
          state = null;
        }
      }
      if (!state) {
        // Next range (if SharePoint suddenly sends whole file, skip what we have)
        const res = await request(src.loaded);
        if (res.status === 416) {
          finish(); // nothing left (size was unknown)
          return;
        }
        if (!res.ok) throw new Error(`Error ${res.status} on caching`);
        state = await read(res, MAX_BYTES, res.status === 206 ? 0 : src.loaded);
        if (res.status === 206) {
          reader?.cancel();
          reader = null;
        }
      }
      if (state === 'end' || (src.total && src.loaded >= src.total)) finish();
    };

    src.loadAll = async () => {
      while (!src.done) {
        const before = src.loaded;
        await src.more();
        if (!src.done && src.loaded === before) throw new Error('no progress from SharePoint');
      }
    };
    return src;
  }

  // Content types that are never plain text
  const BINARY_TYPE_RE =
    /^(image|audio|video|font)\/|^application\/(pdf|zip|x-zip|gzip|x-gzip|x-7z|x-rar|x-tar|msword|vnd\.ms-|vnd\.openxmlformats|vnd\.oasis)/i;

  // Signatures of common binary files (PDF, ZIP/Office, PNG, JPEG, GIF, ...)
  const BINARY_MAGIC = [
    [0x25, 0x50, 0x44, 0x46], // %PDF
    [0x50, 0x4b, 0x03, 0x04], // ZIP, docx/xlsx/pptx
    [0x89, 0x50, 0x4e, 0x47], // PNG
    [0xff, 0xd8, 0xff], // JPEG
    [0x47, 0x49, 0x46, 0x38], // GIF
    [0xd0, 0xcf, 0x11, 0xe0], // old Office (doc/xls)
    [0x1f, 0x8b], // gzip
    [0x37, 0x7a, 0xbc, 0xaf], // 7z
    [0x52, 0x61, 0x72, 0x21], // RAR
  ];

  // First bytes -> text encoding, or null for binary
  /** @param {Uint8Array} bytes @returns {string|null} encoding, or null for binary data */
  function sniffText(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    if (BINARY_MAGIC.some((sig) => sig.every((b, i) => bytes[i] === b))) return null;
    const head = bytes.subarray(0, SNIFF_BYTES);
    if (head.includes(0)) return null; // NUL bytes do not occur in text
    return 'utf-8';
  }

  // ---------------------------------------------------------------------------
  // Parquet (read only, no library): footer and needed column parts by range, rows as CSV
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // .ifczip: ZIP with one IFC file, unpacked by browser (read only)
  // ---------------------------------------------------------------------------
  const ZIP_RE = /\.ifczip$/i;
  const MAX_ZIP_BYTES = 256 * 1024 * 1024; // archive size limit

  // Entries of ZIP archive from its central directory
  /** @param {Uint8Array} bytes @returns {{ name: string, method: number, size: number, packed: number, offset: number }[]} */
  function zipEntries(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error('not a ZIP archive');
    const count = dv.getUint16(end + 10, true);
    let p = dv.getUint32(end + 16, true);
    const names = new TextDecoder();
    const entries = [];
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('damaged ZIP directory');
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      entries.push({
        name: names.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
        method: dv.getUint16(p + 10, true),
        packed: dv.getUint32(p + 20, true),
        size: dv.getUint32(p + 24, true),
        offset: dv.getUint32(p + 42, true),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  // Bytes of one entry: stored (0) or deflated (8)
  /** @param {Uint8Array} bytes @param {{ method: number, packed: number, offset: number }} entry @returns {Promise<Uint8Array>} */
  async function zipEntryBytes(bytes, entry) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const at = entry.offset;
    if (dv.getUint32(at, true) !== 0x04034b50) throw new Error('damaged ZIP entry');
    const start = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true);
    const packed = bytes.subarray(start, start + entry.packed);
    if (entry.method === 0) return packed;
    if (entry.method !== 8) throw new Error(`ZIP compression ${entry.method} is not supported`);
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** @param {string} url @param {() => AbortSignal} getSignal @param {boolean} reload @param {(loaded: number, total: number) => void} onProgress @returns {Promise<Source|{ error: string }>} */
  async function openZipSource(url, getSignal, reload, onProgress, force = false) {
    if (new URL(url, location.href).origin !== location.origin) {
      return { error: 'Not opened: the link points outside this SharePoint' };
    }
    const res = await fetch(url, {
      credentials: 'same-origin',
      cache: reload ? 'reload' : 'default',
      signal: getSignal(),
    });
    if (!res.ok) return { error: `Error ${res.status} on caching` };
    const total = +res.headers.get('content-length') || 0;
    if (total > MAX_ZIP_BYTES) return { error: `Archive larger than ${formatBytes(MAX_ZIP_BYTES)}: not opened` };
    if (total > MAX_BYTES && !force) {
      res.body?.cancel(); // asks first
      return {
        deferred: 'IFCZIP',
        size: total,
        dates: responseDates(res, res.headers.get('content-disposition') || ''),
      };
    }
    const parts = [];
    let loaded = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
    const bytes = new Uint8Array(loaded);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    let entries;
    try {
      entries = zipEntries(bytes);
    } catch (err) {
      return { error: `Not a valid .ifczip (${err.message})` };
    }
    const entry = entries.find((e) => /\.ifc$/i.test(e.name));
    if (!entry) return { error: 'No .ifc file inside this archive' };
    const raw = await zipEntryBytes(bytes, entry);
    const encoding = sniffText(raw);
    if (!encoding) return { binary: true };
    const text = new TextDecoder(encoding).decode(raw);
    return {
      total: loaded,
      loaded,
      done: true,
      isZip: true,
      zipBytes: bytes, // kept for 3D view
      ifcBytes: raw,
      encoding: encoding.toUpperCase(),
      dates: responseDates(res, res.headers.get('content-disposition') || ''),
      info: [['archive', `ZIP, ${entry.name} (${formatBytes(raw.length)} unpacked)`]],
      text,
      more: async () => {},
      loadAll: async () => {},
    };
  }

  const PARQUET_RE = /\.parquet$/i;
  const CODEC_NAMES = ['none', 'SNAPPY', 'GZIP', 'LZO', 'BROTLI', 'LZ4', 'ZSTD', 'LZ4_RAW'];
  const utf8 = new TextDecoder();

  // Thrift compact protocol (Parquet metadata): structs keyed by field id
  /** @param {Uint8Array} bytes @param {number} [start] @returns {{ struct: () => Object<number, *>, pos: () => number }} */
  function thriftReader(bytes, start = 0) {
    let pos = start;

    const byte = () => {
      if (pos >= bytes.length) throw new RangeError('end of data');
      return bytes[pos++];
    };

    const varint = () => {
      let r = 0n;
      let shift = 0n;
      let b;
      do {
        b = byte();
        r |= BigInt(b & 0x7f) << shift;
        shift += 7n;
      } while (b & 0x80);
      return r;
    };
    const zigzag = (n) => (n >> 1n) ^ -(n & 1n);
    const small = (n) => (n >= -(2n ** 53n) && n <= 2n ** 53n ? Number(n) : n);

    function value(type) {
      switch (type) {
        case 1:
          return true;
        case 2:
          return false;
        case 3: {
          const b = byte();
          return b > 127 ? b - 256 : b;
        }
        case 4:
        case 5:
        case 6:
          return small(zigzag(varint()));
        case 7: {
          if (pos + 8 > bytes.length) throw new RangeError('end of data');
          const v = new DataView(bytes.buffer, bytes.byteOffset + pos, 8).getFloat64(0, true);
          pos += 8;
          return v;
        }
        case 8: {
          const len = Number(varint());
          if (pos + len > bytes.length) throw new RangeError('end of data');
          const v = bytes.subarray(pos, pos + len);
          pos += len;
          return v;
        }
        case 9:
        case 10: {
          const h = byte();
          let size = h >> 4;
          const elem = h & 15;
          if (size === 15) size = Number(varint());
          const out = [];
          for (let i = 0; i < size; i++) out.push(elem === 1 || elem === 2 ? byte() === 1 : value(elem));
          return out;
        }
        case 11: {
          const size = Number(varint());
          const out = new Map();
          if (size) {
            const kv = byte();
            for (let i = 0; i < size; i++) out.set(value(kv >> 4), value(kv & 15));
          }
          return out;
        }
        case 12:
          return struct();
        default:
          throw new Error(`unknown Thrift type ${type}`);
      }
    }

    function struct() {
      const out = {};
      let id = 0;
      for (;;) {
        const h = byte();
        if (h === 0) return out;
        const delta = h >> 4;
        id = delta ? id + delta : Number(zigzag(varint()));
        out[id] = value(h & 15);
      }
    }

    return { struct, pos: () => pos };
  }

  /** @param {Uint8Array} bytes @returns {{ createdBy: string, numRows: number, schema: Object[], rowGroups: Object[] }} */
  function parseFooter(bytes) {
    const m = thriftReader(bytes).struct();
    const text = (b) => (b ? utf8.decode(b) : '');
    return {
      createdBy: m[6] ? text(m[6]) : '',
      numRows: Number(m[3] || 0),
      schema: (m[2] || []).map((e) => ({
        type: e[1],
        typeLength: e[2],
        repetition: e[3],
        name: text(e[4]),
        children: e[5] || 0,
        converted: e[6],
        scale: e[7],
        logical: e[10],
      })),
      rowGroups: (m[4] || []).map((rg) => ({
        numRows: Number(rg[3] || 0),
        columns: (rg[1] || []).map((c) => {
          const md = c[3] || {};
          return {
            codec: md[4] || 0,
            numValues: Number(md[5] || 0),
            size: Number(md[7] || 0),
            dataOffset: Number(md[9] || 0),
            dictOffset: md[11] != null ? Number(md[11]) : null,
          };
        }),
      })),
    };
  }

  // Leaf columns with their nesting depth (definition / repetition levels)
  /** @param {Object[]} schema @returns {Object[]} leaf columns with path, maxDef, maxRep */
  function leafColumns(schema) {
    const leaves = [];
    let i = 1;

    const walk = (path, maxDef, maxRep, count) => {
      for (let k = 0; k < count && i < schema.length; k++) {
        const e = schema[i++];
        const def = maxDef + (e.repetition ? 1 : 0); // OPTIONAL (1) and REPEATED (2) add level
        const rep = maxRep + (e.repetition === 2 ? 1 : 0);
        const p = [...path, e.name];
        if (e.children) walk(p, def, rep, e.children);
        else leaves.push({ ...e, path: p, maxDef: def, maxRep: rep });
      }
    };
    walk([], 0, 0, schema[0] ? schema[0].children : 0);
    return leaves;
  }

  /** @param {number} max @returns {number} */
  const bitWidth = (max) => 32 - Math.clz32(max);
  /** @param {Uint8Array} b @param {number} pos @returns {number} */
  const u32 = (b, pos) => (b[pos] | (b[pos + 1] << 8) | (b[pos + 2] << 16) | (b[pos + 3] << 24)) >>> 0;

  // --- Decompression (Snappy, LZ4 raw and ZSTD are built in; GZIP uses browser) ---

  /** @param {Uint8Array} src @returns {Uint8Array} */
  function unsnappy(src) {
    let pos = 0;
    let len = 0;
    let shift = 0;
    let b;
    do {
      b = src[pos++];
      len += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    const out = new Uint8Array(len);
    let op = 0;
    while (pos < src.length) {
      const tag = src[pos++];
      const kind = tag & 3;
      if (kind === 0) {
        let n = tag >> 2;
        if (n >= 60) {
          const bytes = n - 59;
          n = 0;
          for (let i = 0; i < bytes; i++) n += src[pos++] * 2 ** (8 * i);
        }
        n += 1;
        out.set(src.subarray(pos, pos + n), op);
        pos += n;
        op += n;
        continue;
      }
      let n;
      let off;
      if (kind === 1) {
        n = ((tag >> 2) & 7) + 4;
        off = ((tag >> 5) << 8) | src[pos++];
      } else if (kind === 2) {
        n = (tag >> 2) + 1;
        off = src[pos] | (src[pos + 1] << 8);
        pos += 2;
      } else {
        n = (tag >> 2) + 1;
        off = u32(src, pos);
        pos += 4;
      }
      for (let i = 0; i < n; i++, op++) out[op] = out[op - off];
    }
    return out;
  }

  /** @param {Uint8Array} src @param {number} outLen @returns {Uint8Array} */
  function unlz4(src, outLen) {
    const out = new Uint8Array(outLen);
    let ip = 0;
    let op = 0;
    while (ip < src.length) {
      const token = src[ip++];
      let lit = token >> 4;
      if (lit === 15) {
        let b;
        do {
          b = src[ip++];
          lit += b;
        } while (b === 255);
      }
      out.set(src.subarray(ip, ip + lit), op);
      ip += lit;
      op += lit;
      if (ip >= src.length) break;
      const off = src[ip] | (src[ip + 1] << 8);
      ip += 2;
      let m = token & 15;
      if (m === 15) {
        let b;
        do {
          b = src[ip++];
          m += b;
        } while (b === 255);
      }
      m += 4;
      for (let i = 0; i < m; i++, op++) out[op] = out[op - off];
    }
    return out;
  }

  // ZSTD (RFC 8878), no dictionaries (unused by Parquet)

  // Backward bitstream (ZSTD Huffman / FSE): from last set bit; past start = 0
  /** @param {Uint8Array} bytes @param {number} start @param {number} end @returns {{ read(n: number): number, peek(n: number): number, skip(n: number): void, overflow(): boolean, done(): boolean }} */
  function backReader(bytes, start, end) {
    const last = bytes[end - 1];
    if (!last) throw new Error('ZSTD: damaged bitstream');
    let pos = (end - start - 1) * 8 + (31 - Math.clz32(last)); // just below end marker
    const bit = (p) => (p < 0 ? 0 : (bytes[start + (p >> 3)] >> (p & 7)) & 1);

    const take = (p, n) => {
      let v = 0;
      for (let i = 0; i < n; ) {
        const q = p + i;
        if (q < 0) {
          i++;
          continue;
        }
        const off = q & 7;
        const width = Math.min(8 - off, n - i);
        v += ((bytes[start + (q >> 3)] >> off) & ((1 << width) - 1)) * 2 ** i;
        i += width;
      }
      return v;
    };
    return {
      read(n) {
        pos -= n;
        return n ? take(pos, n) : 0;
      },
      peek(n) {
        return take(pos - n, n);
      },
      skip(n) {
        pos -= n;
      },
      overflow: () => pos < 0,
      done: () => pos === 0,
      bit,
    };
  }

  // FSE table description (forward bits) -> normalised counts; returns them and position after
  /** @param {Uint8Array} bytes @param {number} pos @param {number} maxSymbol @returns {{ counts: number[], log: number, pos: number }} */
  function readFseCounts(bytes, pos, maxSymbol) {
    let bitPos = pos * 8;

    const read = (n) => {
      let v = 0;
      for (let i = 0; i < n; i++, bitPos++) v |= ((bytes[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
      return v;
    };

    const peek = (n) => {
      const keep = bitPos;
      const v = read(n);
      bitPos = keep;
      return v;
    };
    const log = read(4) + 5;
    let remaining = (1 << log) + 1;
    let threshold = 1 << log;
    let nbBits = log + 1;
    const counts = [];
    let previousZero = false;
    while (remaining > 1 && counts.length <= maxSymbol) {
      if (previousZero) {
        let repeat;
        do {
          repeat = read(2);
          for (let i = 0; i < repeat; i++) counts.push(0);
        } while (repeat === 3);
      }
      if (counts.length > maxSymbol) break;
      const max = 2 * threshold - 1 - remaining;
      let count;
      if (peek(nbBits - 1) < max) {
        count = read(nbBits - 1);
      } else {
        count = read(nbBits);
        if (count >= threshold) count -= max;
      }
      count--;
      remaining -= count < 0 ? -count : count;
      counts.push(count);
      previousZero = count === 0;
      while (remaining < threshold) {
        nbBits--;
        threshold >>= 1;
      }
    }
    if (remaining !== 1) throw new Error('ZSTD: damaged FSE table');
    return { counts, log, pos: (bitPos + 7) >> 3 };
  }

  // Decode table from normalised counts: { symbol, nbBits, baseline }
  /** @param {number[]} counts @param {number} log @returns {Array<{ symbol: number, nbBits: number, baseline: number }>} */
  function buildFseTable(counts, log) {
    const size = 1 << log;
    const symbols = new Array(size);
    const next = [];
    let high = size - 1;
    counts.forEach((c, s) => {
      if (c === -1) {
        symbols[high--] = s;
        next[s] = 1;
      } else {
        next[s] = c;
      }
    });
    const step = (size >> 1) + (size >> 3) + 3;
    let pos = 0;
    counts.forEach((c, s) => {
      for (let i = 0; i < c; i++) {
        symbols[pos] = s;
        do pos = (pos + step) & (size - 1);
        while (pos > high);
      }
    });
    const table = new Array(size);
    for (let u = 0; u < size; u++) {
      const s = symbols[u];
      const state = next[s]++;
      const nbBits = log - (31 - Math.clz32(state));
      table[u] = { symbol: s, nbBits, baseline: (state << nbBits) - size };
    }
    table.log = log;
    return table;
  }

  // Predefined distributions (RFC 8878, 3.1.1.3.2.2)
  const LL_DEFAULT = buildFseTable(
    [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1],
    6,
  );
  const ML_DEFAULT = buildFseTable(
    [
      1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
    ],
    6,
  );
  const OF_DEFAULT = buildFseTable(
    [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1],
    5,
  );

  // Literal and match length codes: [baseline, extra bits]
  const LL_CODES = [];
  for (let c = 0; c < 16; c++) LL_CODES.push([c, 0]);
  LL_CODES.push(
    [16, 1],
    [18, 1],
    [20, 1],
    [22, 1],
    [24, 2],
    [28, 2],
    [32, 3],
    [40, 3],
    [48, 4],
    [64, 6],
    [128, 7],
    [256, 8],
    [512, 9],
    [1024, 10],
    [2048, 11],
    [4096, 12],
    [8192, 13],
    [16384, 14],
    [32768, 15],
    [65536, 16],
  );
  const ML_CODES = [];
  for (let c = 0; c < 32; c++) ML_CODES.push([c + 3, 0]);
  ML_CODES.push(
    [35, 1],
    [37, 1],
    [39, 1],
    [41, 1],
    [43, 2],
    [47, 2],
    [51, 3],
    [59, 3],
    [67, 4],
    [83, 4],
    [99, 5],
    [131, 7],
    [259, 8],
    [515, 9],
    [1027, 10],
    [2051, 11],
    [4099, 12],
    [8195, 13],
    [16387, 14],
    [32771, 15],
    [65539, 16],
  );

  // Huffman description -> decode table (index = next maxBits bits)
  /** @param {Uint8Array} bytes @param {number} pos @returns {{ table: { symbol: Uint8Array, bits: Uint8Array, maxBits: number }, pos: number }} */
  function readHuffmanTable(bytes, pos) {
    const header = bytes[pos++];
    let weights;
    if (header < 128) {
      // Weights are FSE-compressed, decoded with two interleaved states
      const end = pos + header;
      const { counts, log, pos: at } = readFseCounts(bytes, pos, 255);
      const table = buildFseTable(counts, log);
      const r = backReader(bytes, at, end);
      let s1 = r.read(log);
      let s2 = r.read(log);
      weights = [];

      const step = (s) => {
        const e = table[s];
        weights.push(e.symbol);
        return e.baseline + r.read(e.nbBits);
      };
      for (;;) {
        s1 = step(s1);
        if (r.overflow()) {
          weights.push(table[s2].symbol);
          break;
        }
        s2 = step(s2);
        if (r.overflow()) {
          weights.push(table[s1].symbol);
          break;
        }
      }
      pos = end;
    } else {
      // Direct 4-bit weights
      const count = header - 127;
      weights = [];
      for (let i = 0; i < count; i++) {
        const b = bytes[pos + (i >> 1)];
        weights.push(i % 2 ? b & 15 : b >> 4);
      }
      pos += (count + 1) >> 1;
    }

    // Last weight is implied: it makes total power of two
    let total = 0;
    for (const w of weights) if (w) total += 1 << (w - 1);
    const maxBits = 32 - Math.clz32(total);
    const rest = (1 << maxBits) - total;
    weights.push(32 - Math.clz32(rest));

    const size = 1 << maxBits;
    const symbol = new Uint8Array(size);
    const bits = new Uint8Array(size);
    let at = 0;
    for (let w = 1; w <= maxBits; w++) {
      weights.forEach((wt, s) => {
        if (wt !== w) return;
        const len = 1 << (w - 1);
        symbol.fill(s, at, at + len);
        bits.fill(maxBits + 1 - w, at, at + len);
        at += len;
      });
    }
    return { table: { symbol, bits, maxBits }, pos };
  }

  /** @param {Uint8Array} bytes @param {number} start @param {number} end @param {{ symbol: Uint8Array, bits: Uint8Array, maxBits: number }} huf @param {Uint8Array} out @param {number} outPos @param {number} count @returns {void} */
  function huffmanStream(bytes, start, end, huf, out, outPos, count) {
    const r = backReader(bytes, start, end);
    const { symbol, bits, maxBits } = huf;
    for (let i = 0; i < count; i++) {
      const idx = r.peek(maxBits);
      out[outPos + i] = symbol[idx];
      r.skip(bits[idx]);
    }
    if (!r.done()) throw new Error('ZSTD: damaged literals');
  }

  // One compressed block: literals, then sequences that copy literals and earlier output
  /** @param {Uint8Array} src @param {number} pos @param {number} end @param {Uint8Array} out @param {number} op @param {Object} st frame state @returns {number} new output position */
  function zstdBlock(src, pos, end, out, op, st) {
    // --- Literals section ---
    const b0 = src[pos];
    const type = b0 & 3;
    const format = (b0 >> 2) & 3;
    let regen;
    let compressed = 0;
    let streams = 1;
    if (type < 2) {
      if (format === 0 || format === 2) {
        regen = b0 >> 3;
        pos += 1;
      } else if (format === 1) {
        regen = (b0 >> 4) + (src[pos + 1] << 4);
        pos += 2;
      } else {
        regen = (b0 >> 4) + (src[pos + 1] << 4) + (src[pos + 2] << 12);
        pos += 3;
      }
    } else {
      const b1 = src[pos + 1];
      const b2 = src[pos + 2];
      if (format < 2) {
        streams = format === 0 ? 1 : 4;
        regen = (b0 >> 4) | ((b1 & 0x3f) << 4);
        compressed = (b1 >> 6) | (b2 << 2);
        pos += 3;
      } else if (format === 2) {
        streams = 4;
        regen = (b0 >> 4) | (b1 << 4) | ((b2 & 3) << 12);
        compressed = (b2 >> 2) | (src[pos + 3] << 6);
        pos += 4;
      } else {
        streams = 4;
        regen = (b0 >> 4) | (b1 << 4) | ((b2 & 0x3f) << 12);
        compressed = (b2 >> 6) | (src[pos + 3] << 2) | (src[pos + 4] << 10);
        pos += 5;
      }
    }

    let literals;
    if (type === 0) {
      literals = src.subarray(pos, pos + regen);
      pos += regen;
    } else if (type === 1) {
      literals = new Uint8Array(regen).fill(src[pos]);
      pos += 1;
    } else {
      const litEnd = pos + compressed;
      if (type === 2) {
        const t = readHuffmanTable(src, pos);
        st.huf = t.table;
        pos = t.pos;
      } else if (!st.huf) {
        throw new Error('ZSTD: missing Huffman table');
      }
      literals = new Uint8Array(regen);
      if (streams === 1) {
        huffmanStream(src, pos, litEnd, st.huf, literals, 0, regen);
      } else {
        const sizes = [
          src[pos] | (src[pos + 1] << 8),
          src[pos + 2] | (src[pos + 3] << 8),
          src[pos + 4] | (src[pos + 5] << 8),
        ];
        const seg = Math.ceil(regen / 4);
        let at = pos + 6;
        for (let i = 0; i < 4; i++) {
          const size = i < 3 ? sizes[i] : litEnd - at;
          huffmanStream(src, at, at + size, st.huf, literals, i * seg, i < 3 ? seg : regen - 3 * seg);
          at += size;
        }
      }
      pos = litEnd;
    }

    // --- Sequences section ---
    let nbSeq = src[pos++];
    if (nbSeq >= 128) {
      if (nbSeq === 255) {
        nbSeq = src[pos] + (src[pos + 1] << 8) + 0x7f00;
        pos += 2;
      } else {
        nbSeq = ((nbSeq - 128) << 8) + src[pos++];
      }
    }
    let lit = 0;
    if (nbSeq) {
      const modes = src[pos++];

      const table = (mode, def, maxSymbol, key) => {
        if (mode === 0) st[key] = def;
        else if (mode === 1) {
          // RLE: every sequence uses same code
          st[key] = Object.assign([{ symbol: src[pos++], nbBits: 0, baseline: 0 }], { log: 0 });
        } else if (mode === 2) {
          const { counts, log, pos: at } = readFseCounts(src, pos, maxSymbol);
          st[key] = buildFseTable(counts, log);
          pos = at;
        } else if (!st[key]) throw new Error('ZSTD: missing sequence table');
        return st[key];
      };
      const llT = table(modes >> 6, LL_DEFAULT, 35, 'll');
      const ofT = table((modes >> 4) & 3, OF_DEFAULT, 31, 'of');
      const mlT = table((modes >> 2) & 3, ML_DEFAULT, 52, 'ml');

      const r = backReader(src, pos, end);
      let ll = r.read(llT.log);
      let of = r.read(ofT.log);
      let ml = r.read(mlT.log);
      const rep = st.rep;
      for (let i = 0; i < nbSeq; i++) {
        const ofCode = ofT[of].symbol;
        const [mlBase, mlBits] = ML_CODES[mlT[ml].symbol];
        const [llBase, llBits] = LL_CODES[llT[ll].symbol];
        const ofValue = 2 ** ofCode + r.read(ofCode);
        const matchLen = mlBase + r.read(mlBits);
        const litLen = llBase + r.read(llBits);

        let offset;
        if (ofValue > 3) {
          offset = ofValue - 3;
          rep[2] = rep[1];
          rep[1] = rep[0];
          rep[0] = offset;
        } else {
          const idx = ofValue - 1 + (litLen === 0 ? 1 : 0);
          if (idx === 0) {
            offset = rep[0];
          } else {
            offset = idx === 3 ? rep[0] - 1 : rep[idx];
            if (idx !== 1) rep[2] = rep[1];
            rep[1] = rep[0];
            rep[0] = offset;
          }
        }

        out.set(literals.subarray(lit, lit + litLen), op);
        op += litLen;
        lit += litLen;
        if (offset > op) throw new Error('ZSTD: damaged match offset');
        for (let k = 0; k < matchLen; k++, op++) out[op] = out[op - offset];

        if (i < nbSeq - 1) {
          ll = llT[ll].baseline + r.read(llT[ll].nbBits);
          ml = mlT[ml].baseline + r.read(mlT[ml].nbBits);
          of = ofT[of].baseline + r.read(ofT[of].nbBits);
        }
      }
    }
    out.set(literals.subarray(lit), op);
    return op + literals.length - lit;
  }

  /** @param {Uint8Array} src @param {number} outLen @returns {Uint8Array} */
  function unzstd(src, outLen) {
    const out = new Uint8Array(outLen);
    let pos = 0;
    let op = 0;
    while (pos < src.length) {
      const magic = u32(src, pos);
      pos += 4;
      if ((magic & 0xfffffff0) === 0x184d2a50) {
        pos += 4 + u32(src, pos); // skippable frame
        continue;
      }
      if (magic !== 0xfd2fb528) throw new Error('ZSTD: not a ZSTD frame');
      const fhd = src[pos++];
      const single = (fhd >> 5) & 1;
      const fcsFlag = fhd >> 6;
      const dictFlag = fhd & 3;
      if (!single) pos++; // window descriptor
      pos += [0, 1, 2, 4][dictFlag];
      pos += [single ? 1 : 0, 2, 4, 8][fcsFlag];
      const st = { rep: [1, 4, 8] };
      for (let last = 0; !last; ) {
        const h = src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16);
        pos += 3;
        last = h & 1;
        const type = (h >> 1) & 3;
        const size = h >> 3;
        if (type === 0) {
          out.set(src.subarray(pos, pos + size), op);
          op += size;
          pos += size;
        } else if (type === 1) {
          out.fill(src[pos], op, op + size);
          op += size;
          pos += 1;
        } else if (type === 2) {
          op = zstdBlock(src, pos, pos + size, out, op, st);
          pos += size;
        } else {
          throw new Error('ZSTD: damaged block');
        }
      }
      if ((fhd >> 2) & 1) pos += 4; // checksum (not verified)
    }
    return op === out.length ? out : out.subarray(0, op);
  }

  /** @param {number} codec @param {Uint8Array} data @param {number} outLen @returns {Promise<Uint8Array>} */
  async function decompress(codec, data, outLen) {
    if (codec === 0) return data;
    if (codec === 1) return unsnappy(data);
    if (codec === 2) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (codec === 7) return unlz4(data, outLen);
    if (codec === 6) return unzstd(data, outLen);
    throw new Error(`compression ${CODEC_NAMES[codec] || codec} is not supported by this viewer`);
  }

  // --- Values ---

  // RLE / bit-packed hybrid (levels, dictionary indices, booleans)
  /** @param {Uint8Array} bytes @param {number} pos @param {number} end @param {number} width @param {number} count @param {number[]} out @returns {number[]} */
  function readHybrid(bytes, pos, end, width, count, out) {
    const byteWidth = (width + 7) >> 3;
    let n = 0;
    while (n < count && pos < end) {
      let header = 0;
      let shift = 0;
      let b;
      do {
        b = bytes[pos++];
        header += (b & 0x7f) * 2 ** shift;
        shift += 7;
      } while (b & 0x80);
      if (header % 2) {
        const groups = Math.floor(header / 2);
        const start = pos;
        let bit = 0;
        for (let i = 0; i < groups * 8; i++, bit += width) {
          let v = 0;
          for (let k = 0; k < width; k++) {
            const at = bit + k;
            v |= ((bytes[start + (at >> 3)] >> (at & 7)) & 1) << k;
          }
          if (n < count) out[n++] = v;
        }
        pos = start + groups * width;
      } else {
        const run = Math.floor(header / 2);
        let v = 0;
        for (let k = 0; k < byteWidth; k++) v |= bytes[pos++] << (8 * k);
        for (let i = 0; i < run && n < count; i++) out[n++] = v;
      }
    }
    return out;
  }

  // DELTA_BINARY_PACKED; returns values and position after them
  /** @param {Uint8Array} bytes @param {number} pos @param {boolean} big @returns {{ values: Array<number|bigint>, pos: number }} */
  function readDelta(bytes, pos, big) {
    const uvar = () => {
      let r = 0n;
      let s = 0n;
      let b;
      do {
        b = bytes[pos++];
        r |= BigInt(b & 0x7f) << s;
        s += 7n;
      } while (b & 0x80);
      return r;
    };
    const zigzag = (n) => (n >> 1n) ^ -(n & 1n);
    const blockSize = Number(uvar());
    const minis = Number(uvar());
    const total = Number(uvar());
    let value = zigzag(uvar());
    const perMini = blockSize / minis;
    if (!(perMini > 0 && perMini % 8 === 0) || total < 0) throw new Error('damaged delta-encoded values');
    const values = total ? [value] : [];
    while (values.length < total) {
      const minDelta = zigzag(uvar());
      const widths = bytes.subarray(pos, pos + minis);
      pos += minis;
      for (let m = 0; m < minis && values.length < total; m++) {
        const w = widths[m];
        const start = pos;
        for (let i = 0, bit = 0; i < perMini; i++, bit += w) {
          let d = 0n;
          for (let k = 0; k < w; k++) {
            const at = bit + k;
            if ((bytes[start + (at >> 3)] >> (at & 7)) & 1) d |= 1n << BigInt(k);
          }
          if (values.length < total) {
            value += minDelta + d;
            values.push(value);
          }
        }
        pos = start + (perMini * w) / 8;
      }
    }
    return {
      values: values.map((v) => (big ? BigInt.asIntN(64, v) : Number(BigInt.asIntN(32, v)))),
      pos,
    };
  }

  // INT96 (old timestamp format): nanoseconds of day + Julian day
  /** @param {DataView} dv @param {number} pos @returns {Date} */
  function int96Date(dv, pos) {
    const nanos = dv.getBigInt64(pos, true);
    const day = dv.getInt32(pos + 8, true);
    return new Date((day - 2440588) * 86400000 + Number(nanos / 1000000n));
  }

  /** @param {number} type @param {Uint8Array} bytes @param {number} pos @param {number} n @param {number} typeLength @returns {{ values: Array<*>, pos: number }} */
  function readPlain(type, bytes, pos, n, typeLength) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      switch (type) {
        case 0:
          out[i] = ((bytes[pos + (i >> 3)] >> (i & 7)) & 1) === 1;
          break;
        case 1:
          out[i] = dv.getInt32(pos, true);
          pos += 4;
          break;
        case 2:
          out[i] = dv.getBigInt64(pos, true);
          pos += 8;
          break;
        case 3:
          out[i] = int96Date(dv, pos);
          pos += 12;
          break;
        case 4:
          out[i] = dv.getFloat32(pos, true);
          pos += 4;
          break;
        case 5:
          out[i] = dv.getFloat64(pos, true);
          pos += 8;
          break;
        case 6: {
          const len = dv.getInt32(pos, true);
          out[i] = bytes.subarray(pos + 4, pos + 4 + len);
          pos += 4 + len;
          break;
        }
        default:
          out[i] = bytes.subarray(pos, pos + typeLength);
          pos += typeLength;
      }
    }
    if (type === 0) pos += Math.ceil(n / 8);
    return { values: out, pos };
  }

  const TYPE_WIDTH = { 1: 4, 2: 8, 4: 4, 5: 8 };

  /** @param {Object} st column state @param {number} encoding @param {Uint8Array} data @param {number} pos @param {number} n @returns {Array<*>} */
  function decodeValues(st, encoding, data, pos, n) {
    const { type, typeLength } = st.col;
    switch (encoding) {
      case 0:
        return readPlain(type, data, pos, n, typeLength).values;
      case 2:
      case 8: {
        if (!st.dict) throw new Error('dictionary page missing');
        const idx = readHybrid(data, pos + 1, data.length, data[pos], n, new Array(n));
        return idx.map((i) => st.dict[i]);
      }
      case 3: {
        const len = u32(data, pos);
        return readHybrid(data, pos + 4, pos + 4 + len, 1, n, new Array(n)).map((v) => v === 1);
      }
      case 5:
        return readDelta(data, pos, type === 2).values;
      case 6: {
        const lens = readDelta(data, pos, false);
        let at = lens.pos;
        return lens.values.slice(0, n).map((len) => data.subarray(at, (at += len)));
      }
      case 7: {
        const prefixes = readDelta(data, pos, false);
        const suffixes = readDelta(data, prefixes.pos, false);
        let at = suffixes.pos;
        let prev = new Uint8Array(0);
        return suffixes.values.slice(0, n).map((len, i) => {
          const value = new Uint8Array(prefixes.values[i] + len);
          value.set(prev.subarray(0, prefixes.values[i]));
          value.set(data.subarray(at, at + len), prefixes.values[i]);
          at += len;
          prev = value;
          return value;
        });
      }
      case 9: {
        const w = TYPE_WIDTH[type] || typeLength;
        const joined = new Uint8Array(n * w);
        for (let i = 0; i < n; i++) for (let k = 0; k < w; k++) joined[i * w + k] = data[pos + k * n + i];
        return readPlain(type, joined, 0, n, typeLength).values;
      }
      default:
        throw new Error(`Parquet encoding ${encoding} is not supported by this viewer`);
    }
  }

  // --- Display text of value (dates, decimals, strings, ...) ---

  /** @param {Uint8Array} b @returns {bigint} */
  const bytesToBigInt = (b) => {
    let v = 0n;
    for (const x of b) v = (v << 8n) | BigInt(x);
    return b.length && b[0] & 0x80 ? v - (1n << BigInt(b.length * 8)) : v;
  };

  /** @param {bigint} v @param {number} scale @returns {string} */
  const decimalText = (v, scale) => {
    if (!scale) return v.toString();
    const neg = v < 0n;
    const digits = (neg ? -v : v).toString().padStart(scale + 1, '0');
    return `${neg ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  };

  /** @param {Uint8Array} b @returns {string} */
  const hexText = (b) =>
    [...b.subarray(0, 32)].map((x) => x.toString(16).padStart(2, '0')).join('') + (b.length > 32 ? '…' : '');

  /** @param {number|bigint} v @param {number} unit 1 ms, 2 µs, 3 ns @param {boolean} withDate @returns {string} */
  function timeText(v, unit, withDate) {
    const per = { 1: 1n, 2: 1000n, 3: 1000000n }[unit] || 1n;
    const big = BigInt(v);
    const ms = Number(big / per);
    const rest = big % per;
    try {
      let iso = new Date(ms).toISOString();
      if (rest) iso = iso.replace('Z', `${String(rest < 0n ? -rest : rest).padStart(per === 1000n ? 3 : 6, '0')}Z`);
      return withDate ? iso : iso.slice(11, -1);
    } catch {
      return big.toString();
    }
  }

  /** @param {Object|undefined} u @returns {number} */
  const unitOf = (u) => (u ? Number(Object.keys(u)[0]) : 1);

  /** @param {Object} col @param {*} v @returns {string|null} */
  function valueText(col, v) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return JSON.stringify(v.map((x) => valueText(col, x)));
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
    const lt = col.logical || {};
    const ct = col.converted;
    const scale = lt[5]?.[1] ?? col.scale ?? 0;

    if (v instanceof Uint8Array) {
      if (lt[5] || ct === 5) return decimalText(bytesToBigInt(v), scale);
      if (lt[14] && v.length === 16) {
        const h = hexText(v);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      }
      if (lt[1] || ct === 0 || lt[4] || ct === 4 || lt[12] || ct === 19) return utf8.decode(v);
      const s = utf8.decode(v);
      return s.includes('�') || /[\x00-\x08]/.test(s) ? `0x${hexText(v)}` : s;
    }
    if (typeof v === 'number' || typeof v === 'bigint') {
      if (lt[5] || ct === 5) return decimalText(BigInt(v), scale);
      if (lt[6] || ct === 6) return new Date(Number(v) * 86400000).toISOString().slice(0, 10);
      if (lt[8]) return timeText(v, unitOf(lt[8][2]), true);
      if (ct === 9 || ct === 10) return timeText(v, ct === 9 ? 1 : 2, true);
      if (lt[7]) return timeText(v, unitOf(lt[7][2]), false);
      if (ct === 7 || ct === 8) return timeText(v, ct === 7 ? 1 : 2, false);
      if ((lt[10] && lt[10][2] === false) || (ct >= 11 && ct <= 14)) {
        return typeof v === 'bigint' ? BigInt.asUintN(64, v).toString() : String(v >>> 0);
      }
    }
    return String(v);
  }

  /** @param {string|null} s @returns {string} */
  const csvCell = (s) => (s === null ? '' : /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

  // --- Read ---

  // Parquet source like openSource(): text = rows as CSV, more() = PARQUET_ROWS more
  /** @param {string} url @param {() => AbortSignal} getSignal @param {boolean} reload @param {(loaded: number, total: number) => void} onProgress @returns {Promise<Source|{ error: string }>} */
  async function openParquetSource(url, getSignal, reload, onProgress, force = false) {
    if (new URL(url, location.href).origin !== location.origin) {
      return { error: 'Not opened: the link points outside this SharePoint' };
    }
    let whole = null; // whole file, if SharePoint ignores partial requests
    let size = 0;
    let fetched = 0;

    // Bytes [from, to) of file
    const read = async (from, to) => {
      if (whole) return whole.subarray(from, to);
      const res = await fetch(url, {
        credentials: 'same-origin',
        cache: reload ? 'reload' : 'default',
        headers: { Range: `bytes=${from}-${to - 1}` },
        signal: getSignal(),
      });
      if (!res.ok) throw new Error(`Error ${res.status} on caching`);
      const buf = new Uint8Array(await res.arrayBuffer());
      fetched += buf.length;
      onProgress(fetched, size);
      if (res.status === 206) return buf;
      whole = buf;
      return whole.subarray(from, to);
    };

    // Size from 4-byte request (or whole file, if ranges are ignored)
    const res = await fetch(url, {
      credentials: 'same-origin',
      cache: reload ? 'reload' : 'default',
      headers: { Range: 'bytes=0-3' },
      signal: getSignal(),
    });
    if (!res.ok) return { error: `Error ${res.status} on caching` };
    const dates = responseDates(res, res.headers.get('content-disposition') || '');
    if (res.status === 206) {
      size = Number((res.headers.get('content-range') || '').split('/')[1]) || 0;
      fetched += (await res.arrayBuffer()).byteLength;
    } else {
      whole = new Uint8Array(await res.arrayBuffer());
      size = whole.length;
      fetched = size;
    }
    if (size < 12) return { error: 'Not a Parquet file' };
    if (!whole && size > MAX_BYTES && !force) return { deferred: 'Parquet', size, dates }; // asks first

    // Footer: last 64 KB usually hold all of it (asked for by exact position)
    let tail = await read(Math.max(0, size - 65536), size);
    if (!whole && tail.length >= size) whole = tail; // small file: all of it is here already
    if (utf8.decode(tail.subarray(tail.length - 4)) !== 'PAR1') return { error: 'Not a Parquet file' };
    const footerLen = u32(tail, tail.length - 8);
    let footer;
    if (footerLen + 8 <= tail.length) {
      footer = tail.subarray(tail.length - 8 - footerLen, tail.length - 8);
    } else {
      footer = await read(size - 8 - footerLen, size - 8);
    }
    tail = null;

    const meta = parseFooter(footer);
    const leaves = leafColumns(meta.schema);
    const names = leaves.map((c) => c.path.join('.').replace(/\.(list\.(element|item)|array|bag)$/, ''));

    // Column chunk, cached piece by piece as its pages are read
    const chunk = (start, stated) => {
      const length = Math.max(0, Math.min(stated, size - start)); // never past end of file
      const c = { length, buf: new Uint8Array(0) };
      c.ensure = async (n) => {
        n = Math.min(n, length);
        if (c.buf.length >= n) return;
        const want = Math.min(length, Math.max(n, c.buf.length * 2, 64 * 1024));
        const more = await read(start + c.buf.length, start + want);
        if (!more.length) throw new Error('column data ends early (damaged file?)');
        const joined = new Uint8Array(c.buf.length + more.length);
        joined.set(c.buf);
        joined.set(more, c.buf.length);
        c.buf = joined;
      };
      return c;
    };

    // Per column: rows decoded so far, and where read stopped
    const states = leaves.map((col, idx) => ({ col, idx, rg: 0, rows: [], cur: null, chunk: null, ended: false }));

    const endRow = (st) => {
      if (st.cur) st.rows.push(st.cur.length || !st.curNull ? st.cur : null);
      st.cur = null;
    };

    const addValues = (st, reps, defs, values, n) => {
      const { maxDef, maxRep, repetition } = st.col;
      let vi = 0;
      for (let i = 0; i < n; i++) {
        const def = defs ? defs[i] : maxDef;
        const v = def === maxDef ? values[vi++] : null;
        if (!maxRep) {
          st.rows.push(v);
          continue;
        }
        if ((reps ? reps[i] : 0) === 0) {
          endRow(st);
          st.cur = [];
          st.curNull = def === 0;
        }
        if (def === maxDef) st.cur.push(v);
        else if (def === maxDef - 1 && repetition === 1) st.cur.push(null);
      }
    };

    const readPage = async (st) => {
      const c = st.chunk;
      let header;
      let at;
      for (let want = 2048; ; want *= 4) {
        await c.ensure(st.pos + want);
        try {
          const t = thriftReader(c.buf, st.pos);
          header = t.struct();
          at = t.pos();
          break;
        } catch (err) {
          if (!(err instanceof RangeError)) throw err;
          if (c.buf.length >= c.length) {
            st.pos = c.length; // nothing readable left in this column part
            return;
          }
        }
      }
      const size = header[3] || 0;
      await c.ensure(at + size);
      const raw = c.buf.subarray(at, at + size);
      st.pos = at + size;
      const { col } = st;

      if (header[1] === 2) {
        const data = await decompress(st.codec, raw, header[2]);
        st.dict = readPlain(col.type, data, 0, header[7][1], col.typeLength).values;
        return;
      }
      if (header[1] !== 0 && header[1] !== 3) return; // index pages: nothing to show

      const v2 = header[1] === 3;
      const h = v2 ? header[8] : header[5];
      const n = h[1];
      let reps = null;
      let defs = null;
      let data;
      let pos = 0;
      if (v2) {
        const repLen = h[6] || 0;
        const defLen = h[5] || 0;
        if (col.maxRep) reps = readHybrid(raw, 0, repLen, bitWidth(col.maxRep), n, new Array(n));
        if (col.maxDef) defs = readHybrid(raw, repLen, repLen + defLen, bitWidth(col.maxDef), n, new Array(n));
        const rest = raw.subarray(repLen + defLen);
        data = h[7] === false ? rest : await decompress(st.codec, rest, header[2] - repLen - defLen);
      } else {
        data = await decompress(st.codec, raw, header[2]);
        if (col.maxRep) {
          const len = u32(data, pos);
          reps = readHybrid(data, pos + 4, pos + 4 + len, bitWidth(col.maxRep), n, new Array(n));
          pos += 4 + len;
        }
        if (col.maxDef) {
          const len = u32(data, pos);
          defs = readHybrid(data, pos + 4, pos + 4 + len, bitWidth(col.maxDef), n, new Array(n));
          pos += 4 + len;
        }
      }
      const present = defs ? defs.filter((d) => d === col.maxDef).length : n;
      const values = decodeValues(st, v2 ? h[4] : h[2], data, pos, present);
      addValues(st, reps, defs, values, n);
      st.read += n;
    };

    // Read pages of one column until it has `target` rows (or file ends)
    const fillColumn = async (st, target) => {
      while (st.rows.length < target && !st.ended) {
        if (!st.chunk) {
          const rg = meta.rowGroups[st.rg];
          if (!rg) {
            endRow(st);
            st.ended = true;
            break;
          }
          const cc = rg.columns[st.idx];
          const start = cc.dictOffset > 0 && cc.dictOffset < cc.dataOffset ? cc.dictOffset : cc.dataOffset;
          st.chunk = chunk(start, cc.size);
          st.codec = cc.codec;
          st.total = cc.numValues;
          st.read = 0;
          st.pos = 0;
          st.dict = null;
        }
        if (st.read >= st.total || st.pos >= st.chunk.length) {
          endRow(st);
          st.chunk = null;
          st.rg++;
          continue;
        }
        const before = st.pos;
        await readPage(st);
        if (st.pos <= before) throw new Error(`column "${st.col.name}" could not be read (damaged file?)`);
      }
    };

    const codecs = [...new Set(meta.rowGroups.flatMap((rg) => rg.columns.map((c) => CODEC_NAMES[c.codec] || c.codec)))];
    const src = {
      total: size,
      loaded: fetched,
      done: false,
      isParquet: true,
      wholeLines: true,
      dates,
      info: [
        ['shape', `${meta.numRows.toLocaleString()} rows × ${leaves.length} columns`],
        ['row groups', meta.rowGroups.length],
        ['compression', codecs.join(', ')],
        ['written by', meta.createdBy],
      ],
      text: '',
      rows: 0,
    };
    const lines = [names.map(csvCell).join(',')];
    let target = 0;

    const fill = async (n) => {
      target = Math.min(n, meta.numRows);
      await Promise.all(states.map((st) => fillColumn(st, target)));
      const count = Math.min(target, ...states.map((st) => st.rows.length));
      for (let r = lines.length - 1; r < count; r++) {
        lines.push(states.map((st) => csvCell(valueText(st.col, st.rows[r]))).join(','));
      }
      src.rows = count;
      src.text = lines.join('\n');
      src.loaded = fetched;
      src.done = count >= meta.numRows || states.every((st) => st.ended);
    };

    src.label = () =>
      `${src.rows.toLocaleString()} of ${meta.numRows.toLocaleString()} rows · ${leaves.length} columns`;
    src.nextLabel = `Show next ${PARQUET_ROWS} rows`;
    src.more = () => fill(target + PARQUET_ROWS);
    src.loadAll = () => fill(meta.numRows);

    if (!leaves.length) return { error: 'Parquet file without columns' };
    await fill(PARQUET_ROWS);
    return src;
  }

  // ---------------------------------------------------------------------------
  // Links: .url shortcut files ("[InternetShortcut] URL=...") point to another file
  // ---------------------------------------------------------------------------

  /** @param {string} name @param {string} text @returns {{ display: string, name: string, fetchUrl: string }|null} */
  function linkTarget(name, text) {
    if (!/\.url$/i.test(name) && !/^\s*\[InternetShortcut\]/i.test(text)) return null;
    const m = text.match(/^\s*URL\s*=\s*(\S+)\s*$/im);
    if (!m) return null;

    let target;
    try {
      target = new URL(m[1], location.href);
    } catch {
      return null;
    }
    const display = decodeURIComponent(target.href);

    if (target.hostname === location.hostname) {
      const params = target.searchParams;
      // Viewer pages (.../AllItems.aspx?id=/sites/X/file.txt, Doc.aspx?id=...)
      const id = params.get('id');
      if (/\.aspx$/i.test(target.pathname) && id) {
        return {
          display,
          name: id.split('/').pop(),
          fetchUrl: id.split('/').map(encodeURIComponent).join('/'),
        };
      }
      // Direct links: /:t:/r/sites/X/file.txt?web=1 -> /sites/X/file.txt
      const direct = target.pathname.match(/^\/:[a-z]:\/r(\/.*)$/i);
      if (direct) {
        return { display, name: decodeURIComponent(direct[1]).split('/').pop(), fetchUrl: direct[1] };
      }
      // Share links: /:t:/s/... or /:t:/g/... -> raw file
      if (/^\/:[a-z]:\/[sg]\//i.test(target.pathname)) {
        params.delete('web');
        params.set('download', '1');
        return { display, name: '', fetchUrl: target.href };
      }
    }
    // Other sites not followed (openSource() refuses other origins)
    const last = decodeURIComponent(target.pathname).split('/').pop();
    return { display, name: last, fetchUrl: target.href };
  }

  // File's path from row's links (search results mix folders)
  /** @param {Element} row @param {string} name @returns {string|null} */
  function rowFilePath(row, name) {
    const host = location.hostname;

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

  // View choices: settings are start values, last choice is remembered (localStorage)
  let lastTable = loadPref('tp-preview-table', '1') === '1';

  // Lines of metadata shown (drag grip below it)
  let metaLines = Math.max(1, Math.min(6, Number(loadPref('tp-preview-meta-lines', '1')) || 1));
  let lastProps = loadPref('tp-preview-properties', '1') === '1';

  // Layout: popup / vertical / horizontal
  let lastMode = ['popup', 'vertical', 'horizontal'].includes(loadPref('tp-preview-mode', ''))
    ? loadPref('tp-preview-mode', '')
    : DEFAULT_MODE;

  // Settings remembered in browser (localStorage): light / dark, colours, line wrap
  /** @param {string} key @param {string|null} fallback @returns {string|null} */
  function loadPref(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** @param {string} key @returns {void} */
  function removePref(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  /** @param {string} key @param {string} value @returns {void} */
  function savePref(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  const THEME_KEY = 'tp-preview-theme';
  const COLOUR_KEY = 'tp-preview-colours-text';
  const WRAP_KEY = 'tp-preview-wrap';
  const PROPS_KEY = 'tp-preview-properties'; // properties line shown (default) or hidden
  const CSV_SEP_KEY = 'tp-preview-csv-sep'; // '' = as in file
  const CSV_QUOTE_KEY = 'tp-preview-csv-quote'; // '' = as in file
  // Delimiter / quote style chosen in write mode ('' = keep file's own)
  const csvFormat = { sep: loadPref(CSV_SEP_KEY, '') || '', quote: loadPref(CSV_QUOTE_KEY, '') || '' };
  if (!(csvFormat.sep in SEPARATOR_NAMES)) csvFormat.sep = '';
  if (csvFormat.quote && !QUOTE_MODES[csvFormat.quote]) csvFormat.quote = '';

  // Fill and wires delimiter / quote selects; `fileSep` is file's own delimiter
  /** @param {Viewer} v @param {string} fileSep @returns {void} */
  function setupCsvBar(v, fileSep) {
    const sepSel = v.csvBar.querySelector('.tp-csv-sep');
    const quoteSel = v.csvBar.querySelector('.tp-csv-quote');
    const fill = () => {
      sepSel.innerHTML =
        `<option value="">Delimiter: as in the file (${SEPARATOR_NAMES[fileSep]})</option>` +
        Object.entries(SEPARATOR_NAMES)
          .map(([x, n]) => `<option value="${x}">Delimiter: ${n}</option>`)
          .join('');
      sepSel.value = csvFormat.sep;
      quoteSel.value = csvFormat.quote;
    };
    fill();
    const changed = () => {
      savePref(CSV_SEP_KEY, csvFormat.sep);
      savePref(CSV_QUOTE_KEY, csvFormat.quote);
      fill();
      markEdited(v);
      v.updateMeta?.();
    };
    sepSel.onchange = () => {
      csvFormat.sep = sepSel.value;
      changed();
    };
    quoteSel.onchange = () => {
      csvFormat.quote = quoteSel.value;
      changed();
    };
  }
  let lastTheme = ['light', 'dark'].includes(loadPref(THEME_KEY)) ? loadPref(THEME_KEY) : THEME;
  const COLOUR_TABLE_KEY = 'tp-preview-colours-table';
  const colourPrefs = {
    text: loadPref(COLOUR_KEY, DEFAULT_COLOURS ? '1' : '0') === '1',
    table: loadPref(COLOUR_TABLE_KEY, DEFAULT_TABLE_COLOURS ? '1' : '0') === '1',
  };

  /** @param {Viewer} v @returns {boolean} */
  const tableView = (v) => ['csv', 'parquet'].includes(v.lang) && lastTable;

  // View switch state (pressed = current view) and idle cache bar
  /** @param {Viewer} v @returns {void} */
  function updateViews(v) {
    const table = !v.view3d && tableView(v);
    const shown = !!v.source && !v.source.deferred; // content on screen
    v.textBtn.disabled = !shown;
    v.textBtn.setAttribute('aria-pressed', String(shown && !v.view3d && !table));
    v.tableBtn.setAttribute('aria-pressed', String(table && !v.tableBtn.disabled));
    v.view3dBtn.setAttribute('aria-pressed', String(!!v.view3d));
    if (!v.busy) showCached(v);
  }

  // Colours on in view now shown (table view: CSV / Parquet with table button on)
  /** @param {Viewer} v @returns {boolean} */
  function colourOn(v) {
    return tableView(v) ? colourPrefs.table : colourPrefs.text;
  }
  let lastWrap = loadPref(WRAP_KEY, DEFAULT_WRAP ? '1' : '0') === '1';

  /** @param {Element|null} row @returns {Promise<void>} */
  // Opens a file (following .url links): { src } or { message }, plus final name and hops
  /** @returns {Promise<{ src: Source|null, message: string|null, fileName: string, hops: string[] }>} */
  async function openFile(fetchUrl, fileName, hops, getSignal, reload, onProgress, onLink, force) {
    hops = [...hops];
    for (let hop = 0; ; hop++) {
      const result = PARQUET_RE.test(fileName)
        ? await openParquetSource(fetchUrl, getSignal, reload, onProgress, force)
        : ZIP_RE.test(fileName)
          ? await openZipSource(fetchUrl, getSignal, reload, onProgress, force)
          : await openSource(fetchUrl, getSignal, reload, onProgress);
      if (result.deferred) return { src: null, deferred: result, message: null, fileName, hops };
      if (result.error) return { src: null, message: `${result.error}\n${hops.join('\n→ ')}`, fileName, hops };
      if (result.binary) {
        return {
          src: null,
          message: 'Not a plain text file: use the standard SharePoint preview, or download the file.',
          fileName,
          hops,
        };
      }
      if (hop > 0 && result.name) fileName = result.name;
      const target = FOLLOW_LINKS && hop < MAX_LINK_HOPS && result.done ? linkTarget(fileName, result.text) : null;
      if (!target) return { src: result, message: null, fileName, hops };
      hops.push(target.display);
      fileName = target.name;
      fetchUrl = target.fetchUrl;
      onLink(`Link → ${target.display}`);
    }
  }
  const pendingOpens = new Map(); // url -> first fetch still running { promise, relay, ctl }
  const forcedUrls = new Set(); // big Parquet / IFCZIP files the user chose to cache in full
  const knownSizes = new Map(); // url -> file size seen before (shown right away next time)

  // Same file, any encoding / case of path
  /** @param {string} a @param {string} b @returns {boolean} */
  function sameFile(a, b) {
    const norm = (x) => {
      try {
        x = decodeURIComponent(x);
      } catch {}
      return x.replace(/\/+$/, '').toLowerCase();
    };
    return norm(a) === norm(b);
  }

  // Header eye: viewer without file (look around, settings, ...). Same toggle as row eyes:
  // again on the empty viewer = close; with a file open = switch to empty.
  /** @returns {void} */
  function openEmptyViewer() {
    if (viewer && !viewer.file) return void closeViewer();
    if (!viewer) {
      viewer = createViewer();
      setMode(lastMode);
    }
    showEmpty(viewer);
  }

  // Viewer back to no file; false if user keeps pending changes
  /** @param {Viewer} v @returns {boolean} */
  function showEmpty(v) {
    if (!confirmDiscard(v)) return false;
    close3d(v);
    if (v.writeMode) exitWriteView(v);
    cancelLoad(v);
    setBusy(v, false);
    v.loadToken++; // ignore anything still on its way
    v.file = null;
    v.source = null;
    v.rerender = null;
    v.relint = null;
    v.text = '';
    for (const b of [v.copyBtn, v.loadAllBtn, v.writeBtn, v.tableBtn, v.view3dBtn, v.clearBtn]) b.disabled = true;
    updateViews(v);
    v.titleName.textContent = '–';
    v.titleName.title = '';
    v.metaLine.innerHTML = '';
    v.metaLine.title = '';
    showPlain(v, 'No file opened. Click the eye-icon next to files to preview them.');
    refreshEyes();
    return true;
  }

  async function openPreview(row) {
    const name = row && rowName(row);
    if (!name) {
      alert('Preview: could not find the file name in this row.');
      return;
    }
    const folder = currentFolder();
    const url = rowFilePath(row, name) || (folder && `${folder}/${name}`);
    if (url && viewer?.file && sameFile(viewer.file.url, url)) return void closeViewer(); // eye of open file: same as close
    if (url) showFile(name, url, false);
  }

  // Load file into viewer; `reload` skips browser's cache (refresh button)
  /** @param {string} name @param {string} url @param {boolean} reload @returns {Promise<void>} */
  async function showFile(name, url, reload) {
    const encodedUrl = url.split('/').map(encodeURIComponent).join('/');

    // Reuse open viewer (e.g. in split mode, click through files one after another)
    if (!viewer) {
      viewer = createViewer();
      setMode(lastMode);
    }
    const v = viewer;
    if (!confirmDiscard(v)) return; // pending in open file: stay
    close3d(v);
    if (v.writeMode) exitWriteView(v);
    cancelLoad(v); // previous file may still be on its way
    const token = ++v.loadToken;
    const current = () => viewer === v && token === v.loadToken; // not closed / replaced
    v.file = { name, url };
    refreshEyes(); // highlight its row

    if (clearedUrls.delete(url)) reload = true; // cleared before: skip stored copy once
    v.userStopped = false;

    v.titleName.textContent = name;
    v.titleName.title = url;
    // what is known before the content: format, then size (from the first response)
    const earlyFormat = PARQUET_RE.test(name) ? 'Parquet' : LANG_NAMES[langOf(name)] || 'Text';
    const earlyMeta = (total) => {
      const parts = [
        total ? `size: ${formatBytes(total)} (${total.toLocaleString()} bytes)` : '',
        `format: ${earlyFormat}`,
      ];
      v.metaLine.innerHTML = `<strong>Properties:</strong> ${esc(parts.filter(Boolean).join(' · '))}`;
    };
    earlyMeta(knownSizes.get(url) || 0);
    v.metaLine.title = '';
    v.text = '';
    v.copyBtn.disabled = true;
    v.loadAllBtn.disabled = true;
    v.writeBtn.disabled = true;
    v.tableBtn.disabled = true;
    v.view3dBtn.disabled = true;
    updateViews(v);
    v.clearBtn.disabled = false;
    setBusy(v, true);
    showPlain(v, '');
    showProgress(v, 0, 0);
    v.content.focus();

    // First chunk (close cancels); .url link files are followed
    let src = null;
    let message = null; // shown instead of file (errors, binary files)
    let deferred = null; // big Parquet / IFCZIP: waits for "cache all"
    const forced = forcedUrls.has(url); // "cache all" was asked for
    let fileName = name; // name of file actually shown (after links are followed)
    const fetchUrl = encodedUrl;
    const hops = [url];
    v.abort = new AbortController();
    // relay: progress and signal of this file's source, also once another file is shown
    const relay = { fn: null, controller: null };
    const getSignal = () => (relay.controller || (v.abort ||= new AbortController())).signal;
    let rendered = false; // once text is shown, progress goes to "Cache next" bar

    let metaSize = 0;
    const progress = (loaded, total) => {
      if (!current()) return;
      if (total) loaded = Math.min(loaded, total); // overlapping reads may count twice
      showProgress(v, loaded, total);
      if (!rendered && total && total !== metaSize) earlyMeta((metaSize = total));
      // all bytes in, view still built (e.g. Parquet rows decoded)
      if (total && loaded >= total) v.progressText.textContent += ' · preparing view …';
    };
    relay.fn = progress; // the showFile that shows this source now
    const relayed = (loaded, total) => relay.fn(loaded, total);
    if (reload && memoryCache.delete(url)) refreshEyes(); // refresh: fetch anew
    const kept = memoryCache.get(url);
    // New file and the cache at its limit: clear the others first (OK / Cancel)
    if (!kept && !pendingOpens.has(url) && !makeRoom(v, Math.min(MAX_BYTES, knownSizes.get(url) || MAX_BYTES))) {
      setBusy(v, false);
      showPlain(
        v,
        'Not opened: the cache is full. Clear cached files (⋯ menu) or raise the cache limit in the settings.',
      );
      return;
    }
    if (kept) {
      // Previewed before while this page is open: reuse it, nothing is fetched
      memoryCache.delete(url);
      memoryCache.set(url, kept); // most recently viewed last
      src = kept.src;
      if (src.relay) src.relay.fn = progress;
      fileName = kept.fileName;
      hops.push(...kept.hops.slice(1));
    } else
      try {
        // The first fetch (Parquet / IFCZIP: often the whole file) goes on when the user moves
        // to another file; coming back joins it instead of starting anew
        let pending = pendingOpens.get(url);
        if (pending) pending.relay.fn = progress;
        else {
          const ctl = new AbortController();
          relay.controller = ctl;
          pending = {
            relay,
            ctl,
            promise: openFile(
              fetchUrl,
              fileName,
              hops,
              getSignal,
              reload,
              relayed,
              (m) => current() && showPlain(v, m),
              forcedUrls.has(url),
            ),
          };
          pendingOpens.set(url, pending);
          refreshEyes(); // half open while it caches
          pending.promise
            .then(
              (r) => {
                if (r.src) {
                  r.src.relay = relay;
                  keepInMemory(url, { src: r.src, fileName: r.fileName, hops: [...r.hops] });
                }
              },
              () => {},
            )
            .finally(() => {
              relay.controller = null;
              pendingOpens.delete(url);
              refreshEyes();
            });
        }
        v.abort = pending.ctl;
        v.opening = true;
        const r = await pending.promise;
        src = r.src;
        deferred = r.deferred;
        message = r.message;
        fileName = r.fileName;
        hops.splice(0, hops.length, ...r.hops);
      } catch (err) {
        if (err.name === 'AbortError') {
          if (current() && v.userStopped) showPlain(v, 'Caching stopped. Use refresh to cache this file again.');
          return;
        }
        message = `Caching failed: ${err.message}\n${hops.join('\n→ ')}`;
      }
    if (current()) v.opening = false;
    if (current()) setBusy(v, false);
    if (hops.length > 1) {
      v.titleName.textContent = `${name} → ${fileName}`;
      v.titleName.title = hops.join('\n→ ');
    }
    v.abort = null;

    if (!current()) return;

    if (deferred) {
      // Big Parquet / IFCZIP: only on request (whole file); "cache all" opens it in full
      v.source = { total: deferred.size, loaded: 0, done: false, dates: deferred.dates, deferred: true };
      knownSizes.set(url, deferred.size);
      v.text = '';
      v.copyBtn.disabled = true;
      v.writeBtn.disabled = true;
      v.rerender = null;
      v.relint = null;
      v.loadAllBtn.disabled = false;
      v.loadAll = async () => {
        forcedUrls.add(url);
        await showFile(name, url, false);
        return true;
      };
      showPlain(
        v,
        `To show this ${deferred.deferred} file (${formatBytes(deferred.size)}), the whole file has to be cached first.\nClick ⟦icon⟧ to do this.`,
      );
      const icon = LOAD_ALL_SVG.replace(/\s+/g, ' ').trim(); // no line breaks (the text is pre-formatted)
      const line2 = v.content.querySelectorAll('.tp-code')[1];
      line2.innerHTML = line2.innerHTML.replace('⟦icon⟧', `<span class="tp-inline-icon">${icon}</span>`);
      v.metaLine.innerHTML = `<strong>Properties:</strong> size: ${formatBytes(deferred.size)} · format: ${deferred.deferred}`;
      updateViews(v);
      return;
    }
    v.copyBtn.disabled = false;

    if (!src) {
      v.text = message;
      v.source = null;
      v.writeBtn.disabled = true;
      v.rerender = null;
      v.relint = null;
      v.loadAllBtn.disabled = true;
      showPlain(v, message);
      return;
    }

    // Copy gets whole file: rest is cached first if needed
    v.source = src;
    v.fileName = fileName;
    v.lang = PARQUET_RE.test(fileName) ? 'parquet' : langOf(fileName);
    v.linked = hops.length > 1;
    v.writeBtn.disabled = !canWrite(v);
    v.tableBtn.disabled = !(PARQUET_RE.test(fileName) || langOf(fileName) === 'csv');
    const ifcSize = src.ifcBytes ? src.ifcBytes.length : src.total;
    const tooBig = ifcSize > MAX_3D_BYTES;
    v.view3dBtn.disabled = langOf(fileName) !== 'ifc' || tooBig;
    v.view3dBtn.title = tooBig
      ? `3D view: only for IFC files up to ${formatBytes(MAX_3D_BYTES)}`
      : '3D view (IFC, IFCZIP)';
    updateViews(v);
    v.text = src.text;

    const lang = PARQUET_RE.test(fileName) ? 'csv' : langOf(fileName); // Parquet rows come as CSV
    const highlight = HIGHLIGHTERS[lang] || ((t) => [['', t]]);
    let problemsByLine = new Map();
    let lines = [];

    // Cached lines; unfinished last line waits (unless there is no break at all)
    const loadedLines = () => {
      let t = src.text;
      if (!src.done && !src.wholeLines && t.includes('\n')) t = t.slice(0, t.lastIndexOf('\n'));
      return t.split(/\r?\n/);
    };

    // Table view: sort and filters stay while this file is open (also across "Cache next")
    const tableState = { sort: null, filters: new Map() };

    // Metadata line: dates, size, format and, for tables, their shape
    const isParquet = PARQUET_RE.test(fileName);

    const updateMeta = () => {
      const d = src.dates || {};
      const info = [
        // from the file's own response only (no list columns, no API)
        ['created', d.created],
        ['modified', d.modified || 'n/a'],
        ['size', src.total ? `${formatBytes(src.total)} (${src.total.toLocaleString()} bytes)` : null],
        ['format', isParquet ? 'Parquet' : `${LANG_NAMES[lang] || 'Text'}${src.encoding ? `, ${src.encoding}` : ''}`],
      ];
      if (!isParquet && lang !== 'csv') info.push(['indent', indentation(src.text)]);
      if (isParquet || src.isZip) info.push(...src.info);
      else if (lang === 'csv') {
        const sep = csvSeparator(src.text);
        const header = src.text.slice(0, (src.text.indexOf('\n') + 1 || src.text.length + 1) - 1);
        const cols = header ? header.split(sep).length : 0;
        const rows = Math.max(0, lines.filter((l) => l.trim()).length - 1);
        const to =
          v.tableEditing && csvFormat.sep && csvFormat.sep !== sep ? ` → ${SEPARATOR_NAMES[csvFormat.sep]}` : '';
        info.push(['delimiter', `${SEPARATOR_NAMES[sep]}${to}`]);
        if (v.tableEditing && csvFormat.quote)
          info.push(['quotes', QUOTE_MODES[csvFormat.quote].replace('Quotes: ', '')]);
        info.push(['shape', `${src.done ? '' : '≥ '}${rows.toLocaleString()} rows × ${cols} columns`]);
      }
      const shown = info.filter(([, x]) => x !== null && x !== undefined && x !== '');
      v.metaLine.innerHTML = `<strong>Properties:</strong> ${esc(shown.map(([k, x]) => `${k}: ${x}`).join(' · '))}`;
      v.metaLine.title = shown.map(([k, x]) => `${k}: ${x}`).join('\n');
    };

    // Very long lines (e.g. minified files) are cut for display; copy still gets everything
    const render = () => {
      rendered = true;
      lines = loadedLines();
      v.content.style.setProperty('--tp-ln-w', `${String(lines.length).length + 1}ch`);
      const scrollTop = v.content.scrollTop;
      const truncated = new Map();
      const visible = lines.map((line, i) => {
        if (line.length <= MAX_LINE_CHARS) return line;
        truncated.set(i + 1, line.length - MAX_LINE_CHARS);
        return line.slice(0, MAX_LINE_CHARS);
      });
      v.lineView?.stop();
      if (lastTable && lang === 'csv') {
        const sep = csvSeparator(src.text);
        const rows = parseCsv(src.done ? src.text.replace(/\r?\n$/, '') : lines.join('\n'), sep);
        v.lineView = mountTable(v.content, rows[0] || [], rows.slice(1), {
          state: tableState,
          sep,
          editable: v.tableEditing,
          colour: colourOn(v),
          format: v.tableEditing ? csvFormat : null,
          onEdit: () => markEdited(v),
        });
      } else {
        const tokens = (colourOn(v) ? highlight : (t) => [['', t]])(visible.join('\n'));
        v.lineView = mountLines(v.content, renderLines(tokens, problemsByLine, truncated));
      }
      v.content.scrollTop = scrollTop;

      updateMeta();
      v.loadMoreBtn.style.display = src.done ? 'none' : 'block';
      v.loadMoreBtn.disabled = false;
      v.loadAllBtn.disabled = src.done;
      if (!v.busy) showCached(v); // the "fully cache" hint needs the button state
      const of = src.total ? ` of ${formatBytes(src.total)}` : '';
      v.loadMoreBtn.textContent = src.label
        ? `${src.label()} · ${src.nextLabel}`
        : `${lines.length.toLocaleString()} lines · ${formatBytes(src.loaded)}${of} cached · ` +
          `Cache next ${formatBytes(MAX_BYTES)}`;
    };

    const goToLine = (n) => {
      n = Math.max(1, Math.min(n, lines.length));
      v.lineView?.show(n);
      const el = v.content.querySelector(`[data-line="${n}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('tp-flash');
      setTimeout(() => el.classList.remove('tp-flash'), 1500);
    };

    // Problem check: needs whole file, so it runs once everything is cached
    let linted = false;

    const runLint = async () => {
      if (linted || !src.done || !LINTERS[lang]) return;
      linted = true;
      showLintWait(v, lang);
      await nextFrame();
      if (!current()) return;
      const result = src.lintResult || (await lintFile(v, lang, src.text));
      src.lintResult = result;
      v.lintWorker = null;
      if (!current()) return;
      problemsByLine = new Map();
      for (const p of result.problems) {
        if (!problemsByLine.has(p.line)) problemsByLine.set(p.line, []);
        problemsByLine.get(p.line).push(p);
      }
      renderLint(v, lang, result, goToLine);
      if (result.problems.length) render();
    };

    // Load more (one chunk, or everything), then shows it
    const load = async (all) => {
      if (src.done) return true;
      if (!all && !src.fullJob && !makeRoom(v, MAX_BYTES)) return false;
      if (src.fullJob) all = true; // join the "cache all" still running
      v.loadMoreBtn.disabled = true;
      v.loadAllBtn.disabled = true;
      v.userStopped = false;
      setBusy(v, true);
      showProgress(v, src.loaded, src.total);
      try {
        if (all) {
          // runs on when the user moves to another file; joined on return
          if (!src.fullJob) {
            src.controller = v.abort ||= new AbortController();
            if (src.relay) src.relay.controller = src.controller; // its requests: this signal
            src.fullJob = src.loadAll().finally(() => {
              src.fullJob = null;
              src.controller = null;
              if (src.relay) src.relay.controller = null;
            });
          } else v.abort = src.controller;
          await src.fullJob;
        } else await src.more();
      } catch (err) {
        if (!current()) return false;
        setBusy(v, false);
        v.abort = null;
        if (err.name === 'AbortError') {
          v.text = src.text;
          render(); // stopped: show what is cached so far, "Cache next" works again
          return false;
        }
        v.loadMoreBtn.disabled = false;
        v.loadAllBtn.disabled = false;
        v.loadMoreBtn.textContent = `Caching failed: ${err.message} · Refresh to try again`;
        return false;
      }
      trimMemory();
      if (!current()) return false;
      v.abort = null;
      setBusy(v, false);
      v.text = src.text;
      render();
      runLint();
      return true;
    };
    v.loadAll = () => load(true);
    v.rerender = render; // colours switched on / off
    v.applyColour?.(); // colour button for this file's view
    v.updateMeta = updateMeta;
    v.relint = () => {
      // forget last result and check again (in write mode: saved or cached text)
      src.lintResult = null;
      src.needsLint = false;
      linted = false;
      problemsByLine = new Map();
      runLint();
    };
    v.loadMoreBtn.onclick = () => load(false);

    if (LINTERS[lang] && !src.done) {
      v.lint.style.display = 'block';
      v.lint.className = 'tp-lint tp-lint-wait';
      v.lint.innerHTML = `<div class="tp-lint-summary">${lang.toUpperCase()}: checked once the whole file is cached</div>`;
    } else if (!LINTERS[lang]) {
      v.lint.style.display = 'none'; // TOML / plain text: colours only
    }

    // Text first, so it is readable while (possibly slow) check runs
    v.content.scrollTop = 0;
    render();
    runLint();

    // "Cache all" still running from an earlier visit (or asked for a big Parquet / IFCZIP)
    if (src.fullJob || (forced && !src.done)) load(true);

    // 3D view chosen before: show it again, but only if its library is already loaded
    if (last3d && ifcLibraryReady && !v.view3dBtn.disabled) toggle3d(v);
  }
})();
