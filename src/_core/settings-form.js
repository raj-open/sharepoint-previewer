import { COPY_SVG } from '../ui/icons.js';
import { placeMoved, startMove } from '../ui/move.js';
import { removePref, view } from './prefs.js';
import { DEFAULTS } from './settings.js';
import { esc } from './util.js';

// Settings form, opened from Tampermonkey menu: [key, label, choices or unit]
/** @type {[string, string, (string[]|string)?][]} */
const SETTING_FORM = [
  ['layout', 'Layout', ['horizontal', 'vertical', 'popup']],
  ['viewer-share', 'Viewer takes up % of screen'],
  ['theme', 'Colours', ['dark', 'light']],
  ['show-whitespace', 'Display whitespaces'],
  ['wrap-lines', 'Wrap long lines'],
  ['colours-text', 'Syntax highlighting (text view)'],
  ['colours-table', 'Syntax highlighting (table view)'],
  ['colours-sheet', 'Column colours (spreadsheets)'],
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
/** @type {Object<string, number>} */
const UNIT_BYTES = { KB: 1024, MB: 1024 * 1024 };

// Defaults by key (any setting)
/** @type {Object<string, *>} */
const defaults = DEFAULTS;

// Start-value settings for viewer choices in browser storage
/** @type {Object<string, string>} */
const REMEMBERED_BY = {
  'layout': 'tp-preview-mode',
  'viewer-share': 'tp-preview-split',
  'theme': 'tp-preview-theme',
  'wrap-lines': 'tp-preview-wrap',
  'colours-text': 'tp-preview-colours-text',
  'colours-table': 'tp-preview-colours-table',
  'colours-sheet': 'tp-preview-colours-sheet',
};
const SETTINGS_POS_KEY = 'tp-preview-settings-pos';
export const POPUP_POS_KEY = 'tp-preview-popup-pos';

/** @returns {void} */
export function openSettingsForm() {
  document.querySelector('.tp-settings')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'tp-settings';
  // Follow viewer's light / dark choice; soft colours instead of pure white
  const dark = view.theme === 'dark';
  const c = dark
    ? { bg: '#2b2b2e', fg: '#e6e6e6', field: '#1f1f22', border: '#55555a', muted: '#a8a8ad', bad: '#f1707b' }
    : { bg: '#f4f3f1', fg: '#242322', field: '#fbfaf9', border: '#c8c6c4', muted: '#605e5c', bad: '#c50f1f' };
  const font = "'Segoe UI', system-ui, -apple-system, sans-serif"; // single quotes: used inside style="…"
  const mono = 'Consolas, monospace';
  wrap.style.cssText = `position:fixed; inset:0; z-index:2147483100; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; font:13px ${font};`;
  const form = document.createElement('form');
  form.style.cssText = `background:${c.bg}; color:${c.fg}; padding:20px 24px; border-radius:10px; width:min(620px, 92vw); max-height:86vh; overflow:auto; box-shadow:0 8px 32px rgba(0,0,0,.3); font:13px ${font}; color-scheme:${dark ? 'dark' : 'light'}; user-select:text;`;
  const field = `font:13px ${font}; color:${c.fg}; background:${c.field}; padding:4px 8px; border:1px solid ${c.border}; border-radius:6px; box-sizing:border-box;`;
  const stored = Object.fromEntries(SETTING_FORM.map(([key]) => [key, GM_getValue(key, defaults[key])]));

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
    } else if (typeof defaults[key] === 'boolean') {
      input = `<input type="checkbox" name="${key}" style="margin:0; width:16px; height:16px">`;
    } else if (typeof defaults[key] === 'number') {
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
  /** @param {string} mode @param {string} text */
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
  // Parts of the form (all written in its HTML above)
  /** @param {string} selector @returns {HTMLElement} */
  const part = (selector) => /** @type {HTMLElement} */ (form.querySelector(selector));
  /** @param {string} name @returns {HTMLInputElement} input or select of a setting */
  const setting = (name) => /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
  const json = /** @type {HTMLTextAreaElement} */ (part('[data-json]'));
  const errorsEl = part('[data-errors]');
  const note = part('[data-note]');
  const saveBtn = /** @type {HTMLButtonElement} */ (part('[data-act="save"]'));
  const slider = setting('viewer-share');
  let mode = 'form';

  // Form inputs <-> stored values
  /** @param {Object<string, *>} values */
  const setForm = (values) => {
    for (const [key, , extra] of SETTING_FORM) {
      const el = setting(key);
      const value = values[key];
      if (key === 'viewer-share') {
        el.value = String(Math.round(Math.min(0.8, Math.max(0.2, value)) * 100));
        part('[data-pct]').textContent = `${el.value} %`;
      } else if (typeof defaults[key] === 'boolean') el.checked = value;
      else if (typeof defaults[key] === 'number')
        el.value = String(+(extra && UNIT_BYTES[String(extra)] ? value / UNIT_BYTES[String(extra)] : value).toFixed(2));
      else el.value = value;
    }
  };
  const readForm = () =>
    Object.fromEntries(
      SETTING_FORM.map(([key, , extra]) => {
        const el = setting(key);
        const fallback = defaults[key];
        let value;
        if (key === 'viewer-share') value = Math.min(80, Math.max(20, Number(el.value))) / 100;
        else if (typeof fallback === 'boolean') value = el.checked;
        else if (typeof fallback === 'number') {
          value = Number(el.value) * (UNIT_BYTES[String(extra)] || 1);
          if (!Number.isFinite(value) || value <= 0) value = fallback;
        } else value = el.value.trim();
        return [key, value];
      }),
    );

  // JSON text <-> stored values (LOGO last, as it is long); reasons when it is not valid
  /** @param {Object<string, *>} values */
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
    /** @type {Object<string, *>} */
    let data;
    try {
      data = JSON.parse(json.value);
    } catch (err) {
      return { errors: [`Not valid JSON: ${/** @type {Error} */ (err).message}`] };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return { errors: ['The settings must be one JSON object { … }'] };
    /** @type {string[]} */
    const errors = [];
    for (const key of Object.keys(data)) if (!(key in DEFAULTS)) errors.push(`Unknown setting "${key}"`);
    /** @type {Object<string, *>} */
    const values = {};
    for (const [key, , extra] of SETTING_FORM) {
      const value = key in data ? data[key] : stored[key];
      const type = typeof defaults[key];
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
  /** @param {string} next */
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
    b.onclick = () => setMode(b.dataset.mode ?? '');
  });
  part('[data-act="reset"]').onclick = () => {
    setForm(DEFAULTS);
    if (mode === 'json') json.value = toJson(readForm());
    update();
    note.textContent = 'Defaults filled in: Save to keep them.';
  };
  part('[data-act="copy"]').onclick = async () => {
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
    slider.value = String(Math.min(80, Math.max(20, Number(slider.value)))); // blocked below 20 %, above 80 %
    part('[data-pct]').textContent = `${slider.value} %`;
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
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };
  document.addEventListener('keydown', onKey, true);
  part('[data-act="close"]').onclick = close;
  part('[data-act="cancel"]').onclick = close;
  // click beside form closes it; selection dragged out of it doesn't
  let downOnBackdrop = false;
  wrap.onpointerdown = (e) => {
    downOnBackdrop = e.target === wrap;
  };
  wrap.onclick = (e) => {
    if (downOnBackdrop && e.target === wrap) close(); // block body: `return false` would cancel clicks
  };
  // Drag title row (not its buttons) to move window
  part('[data-drag]').addEventListener('pointerdown', (e) => {
    if (e.button === 0 && !(/** @type {HTMLElement} */ (e.target).closest('button')))
      startMove(e, form, SETTINGS_POS_KEY);
  });

  wrap.append(form);
  document.body.append(wrap);
  // JSON view as high as form view: no jump on switch
  const formHeight = part('[data-pane="form"]').getBoundingClientRect().height;
  json.style.height = `${Math.max(200, Math.round(formHeight) - 43)}px`;
  placeMoved(form, SETTINGS_POS_KEY);
}
/** Tampermonkey menu: settings form, reset to defaults. @returns {void} */
export function registerMenu() {
  GM_registerMenuCommand('Settings …', openSettingsForm);

  GM_registerMenuCommand('Reset settings to defaults', () => {
    if (!confirm('Reset all Sharepoint Previewer settings to their defaults?')) return;
    for (const [key, value] of Object.entries(DEFAULTS)) GM_setValue(key, value);
    alert('Settings reset. Reload the page to apply them.');
  });
}
