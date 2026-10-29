// Settings form: form and JSON views, validation, reset; the tab "About"

// ===========================================================================
// IMPORTS
// ===========================================================================

import { bindBrand } from '../ui/brand.ts';
import { brandHtml } from '../ui/brand.ts';
import { brandTitle } from '../ui/brand.ts';
import { COPY_SVG } from '../ui/icons.ts';
import { placeMoved } from '../ui/move.ts';
import { startMove } from '../ui/move.ts';
import { aboutHtml } from './about.ts';
import { APP_NAME } from './about.ts';
import { removePref } from './prefs.ts';
import { view } from './prefs.ts';
import type { Settings } from './settings.ts';
import type { SettingValue } from './settings.ts';
import { DEFAULTS } from './settings.ts';
import { esc } from './util.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Settings form, opened from Tampermonkey menu: [key, label, choices or unit]
const SETTING_FORM: [string, string, (string[] | string)?][] = [
    ['layout', 'Layout', ['horizontal', 'vertical', 'popup']],
    ['viewer-share', 'Viewer takes up % of screen'],
    ['theme', 'Colours', ['dark', 'light']],
    ['show-whitespace', 'Display whitespaces'],
    ['wrap-lines', 'Wrap long lines'],
    ['colours-text', 'Syntax highlighting (text view)'],
    ['colours-table', 'Syntax highlighting (table view)'],
    ['colours-log', 'Syntax highlighting (table view of logs)'],
    ['colours-sheet', 'Column colours (spreadsheets)'],
    ['spreadsheet-view', 'Spreadsheets show', ['tables', 'sheets']],
    ['spreadsheet-autoload-bytes', 'Spreadsheets: show first sheet / table at once up to', 'KB'],
    ['cache-chunk-bytes', 'Cache chunk size', 'KB'],
    ['memory-cache-bytes', 'Cache limit (all files)', 'MB'],
    ['cache-all-confirm-bytes', 'Warn full file cache if file size exceeds', 'MB'],
    ['powerbi-confirm-bytes', 'Warn Power BI if parts to read exceed', 'MB'],
    ['parquet-rows', 'Table rows shown'],
    ['max-line-chars', 'Lines cut after (characters)'],
    ['follow-links', 'Follow .url link files'],
    ['sharepoint-api', 'Use the Sharepoint API (Zen mode, search)'],
    ['viewer-3d-folder', '3D viewer folder', '/sites/…/Viewer  or  /teams/…/Viewer  (or relative to the site)'],
    ['viewer-3d-max-bytes', 'Warn 3D view if IFC size exceeds', 'MB'],
    ['logo', 'Logo (data:image/… URI, empty = no image)'],
];
const UNIT_BYTES: Record<string, number> = { KB: 1024, MB: 1024 * 1024 };

// Defaults by key (any setting)
const defaults: Settings = DEFAULTS;

// Start-value settings for viewer choices in browser storage
const REMEMBERED_BY: Record<string, string> = {
    'layout': 'tp-preview-mode',
    'viewer-share': 'tp-preview-split',
    'theme': 'tp-preview-theme',
    'wrap-lines': 'tp-preview-wrap',
    'colours-text': 'tp-preview-colours-text',
    'colours-table': 'tp-preview-colours-table',
    'colours-log': 'tp-preview-colours-log',
    'colours-sheet': 'tp-preview-colours-sheet',
    'spreadsheet-view': 'tp-preview-sheet-modes',
};
const SETTINGS_POS_KEY = 'tp-preview-settings-pos';
export const POPUP_POS_KEY = 'tp-preview-popup-pos';
export const POPUP_SIZE_KEY = 'tp-preview-popup-size';

// ===========================================================================
// METHODS
// ===========================================================================

/** @param start tab shown first: the form, the JSON, or "About" (anything else: the form) */
export function openSettingsForm(start = 'form'): void {
    document.querySelector('.tp-settings')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'tp-settings';
    // Follow viewer's light / dark choice; soft colours instead of pure white
    const dark = view.theme === 'dark';
    const c = dark
        ? {
              bg: '#2b2b2e',
              fg: '#e6e6e6',
              field: '#1f1f22',
              border: '#55555a',
              muted: '#a8a8ad',
              bad: '#f1707b',
              warn: '#e3b341',
          }
        : {
              bg: '#f4f3f1',
              fg: '#242322',
              field: '#fbfaf9',
              border: '#c8c6c4',
              muted: '#605e5c',
              bad: '#c50f1f',
              warn: '#8a5300',
          };
    const font = "'Segoe UI', system-ui, -apple-system, sans-serif"; // single quotes: used inside style="…"
    const mono = 'Consolas, monospace';
    wrap.style.cssText = `position:fixed; inset:0; z-index:2147483100; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; font:13px ${font};`;
    const form = document.createElement('form');
    form.style.cssText = `background:${c.bg}; color:${c.fg}; padding:20px 24px; border-radius:10px; width:min(980px, 94vw); max-height:92vh; overflow:auto; box-shadow:0 8px 32px rgba(0,0,0,.3); font:13px ${font}; color-scheme:${dark ? 'dark' : 'light'}; user-select:text;`;
    const field = `font:13px ${font}; color:${c.fg}; background:${c.field}; padding:4px 8px; border:1px solid ${c.border}; border-radius:6px; box-sizing:border-box;`;
    const stored: Settings = Object.fromEntries(
        SETTING_FORM.map(([key]) => [key, GM_getValue(key, defaults[key]) as SettingValue]),
    );

    // One cell per setting: label left, field right; two columns of cells when there is room, else one;
    // text settings (folder, logo) over the full width
    const cell = (wide: boolean) =>
        `display:grid; grid-template-columns:${wide ? 'minmax(0, 1fr) minmax(0, 3fr)' : 'minmax(0, 1fr) auto'}; ` +
        `gap:4px 12px; align-items:center; min-height:28px;${wide ? ' grid-column:1 / -1;' : ''}`;
    const rows = SETTING_FORM.map(([key, label, extra]) => {
        if (key === 'logo') {
            // full line, four lines high, wraps, scrolls
            return (
                `<div style="grid-column:1 / -1; display:grid; gap:4px">` +
                `<div style="user-select:text; cursor:text">${esc(label)}</div>` +
                `<textarea name="${key}" rows="4" spellcheck="false" style="${field} width:100%; ` +
                `resize:none; overflow-y:auto; word-break:break-all; font-family:${mono}; font-size:12px; line-height:16px; height:${4 * 16 + 10}px"></textarea>` +
                '</div>'
            );
        }
        let input: string;
        if (key === 'viewer-share') {
            // slider over full 0–100 %, held between 20 and 80 %
            input =
                `<input type="range" name="${key}" min="0" max="100" step="1" style="width:140px; margin:0">` +
                '<span data-pct style="margin-left:8px; min-width:3em"></span>';
        } else if (Array.isArray(extra)) {
            const options = extra.map((o) => `<option>${o}</option>`).join('');
            input = `<select name="${key}" style="${field} width:140px">${options}</select>`;
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
        const wide = typeof defaults[key] === 'string' && !Array.isArray(extra);
        return (
            `<div style="${cell(wide)}">` +
            `<span style="user-select:text; cursor:text">${esc(label)}</span>` +
            `<div style="display:flex; align-items:center; justify-content:${wide ? 'stretch' : 'flex-end'}; min-width:0">${input}</div>` +
            '</div>'
        );
    });
    const tab = (mode: string, text: string) =>
        `<button type="button" data-mode="${mode}" style="border:none; padding:4px 12px; font:12px ${font}; cursor:pointer">${text}</button>`;
    form.innerHTML = `<div data-drag title="Drag to move" style="display:flex; align-items:center; gap:12px; margin:0 0 14px; cursor:move">
      <div style="display:flex; border:1px solid ${c.border}; border-radius:6px; overflow:hidden">${tab('form', 'Form')}${tab('json', 'JSON')}${tab('about', 'About')}</div>
      <h3 style="flex:1; margin:0; font:600 16px ${font}">${APP_NAME}: settings</h3>
      <div title="${esc(brandTitle())}" style="display:flex; align-items:center; gap:8px; font:11px ${font}; opacity:.75; white-space:nowrap">${brandHtml()}</div>
      <button type="button" data-act="close" title="Close" style="width:28px; height:28px; padding:0; border:none; border-radius:6px; background:transparent; color:${c.fg}; font:18px/1 ${font}; cursor:pointer">✕</button>
    </div>
    <div data-pane="form" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(min(400px, 100%), 1fr)); gap:8px 32px">${rows.join('')}</div>
    <div data-pane="json" style="display:none">
      <div style="position:relative">
        <textarea data-json spellcheck="false" style="${field} width:100%; height:360px; resize:none; overflow-x:hidden; overflow-y:auto; white-space:pre-wrap; word-break:break-all; font:12px/17px ${mono}"></textarea>
        <button type="button" data-act="copy" title="Copy all" style="${field} position:absolute; top:6px; right:28px; width:28px; height:28px; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:.9">${COPY_SVG}</button>
      </div>
      <div data-errors style="color:${c.bad}; margin-top:6px; height:34px; overflow-y:auto; white-space:pre-line; font-size:12px; line-height:17px"></div>
    </div>
    <div data-pane="about" style="display:none; overflow-y:auto">${aboutHtml(c)}</div>
    <div data-footer style="display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-top:18px">
      <button type="button" data-act="reset" title="Fill in the defaults (saved only with Save)" style="${field} cursor:pointer; padding:5px 12px">Reset to defaults</button>
      <span data-note style="flex:1; min-width:0; color:${c.muted}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis"></span>
      <button type="button" data-act="cancel" style="${field} cursor:pointer; padding:5px 16px">Cancel</button>
      <button type="submit" data-act="save" style="${field} padding:5px 16px">Save</button>
    </div>`;
    // Parts of the form (all written in its HTML above)
    const part = (selector: string): HTMLElement => form.querySelector(selector) as HTMLElement;
    bindBrand(form);
    /** @returns input or select of a setting */
    const setting = (name: string): HTMLInputElement => form.elements.namedItem(name) as HTMLInputElement;
    const json = part('[data-json]') as HTMLTextAreaElement;
    const errorsEl = part('[data-errors]');
    const note = part('[data-note]');
    const saveBtn = part('[data-act="save"]') as HTMLButtonElement;
    const slider = setting('viewer-share');
    let mode = 'form'; // the values edited in: form or JSON
    let about = false; // the tab "About" shown (over the mode)

    // Form inputs <-> stored values
    const setForm = (values: Settings) => {
        for (const [key, , extra] of SETTING_FORM) {
            const el = setting(key);
            const value = values[key];
            if (key === 'viewer-share') {
                el.value = String(Math.round(Math.min(0.8, Math.max(0.2, Number(value))) * 100));
                part('[data-pct]').textContent = `${el.value} %`;
            } else if (typeof defaults[key] === 'boolean') el.checked = Boolean(value);
            else if (typeof defaults[key] === 'number') {
                const n = Number(value);
                el.value = String(+(extra && UNIT_BYTES[String(extra)] ? n / UNIT_BYTES[String(extra)] : n).toFixed(2));
            } else el.value = String(value);
        }
    };
    const readForm = (): Settings =>
        Object.fromEntries(
            SETTING_FORM.map(([key, , extra]) => {
                const el = setting(key);
                const fallback = defaults[key];
                let value: number | boolean | string;
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
    // (missing settings = defaults, unknown ones ignored: Save writes the completed JSON back)
    const toJson = (values: Settings) =>
        JSON.stringify(
            Object.fromEntries([
                ...SETTING_FORM.filter(([key]) => key !== 'logo').map(([key]) => [key, values[key]]),
                ['logo', values.logo],
            ]),
            null,
            2,
        );
    const readJson = (): { errors: string[]; values?: undefined } | { values: Settings; errors?: undefined } => {
        let data: Record<string, unknown>;
        try {
            data = JSON.parse(json.value);
        } catch (err) {
            return { errors: [`Not valid JSON: ${(err as Error).message}`] };
        }
        if (!data || typeof data !== 'object' || Array.isArray(data))
            return { errors: ['The settings must be one JSON object { … }'] };
        data = completeSettings(data);
        const errors: string[] = [];
        const values: Settings = {};
        for (const [key, , extra] of SETTING_FORM) {
            const type = typeof defaults[key];
            const expected = type === 'boolean' ? 'true or false' : `a ${type}`;
            if (typeof data[key] !== type) {
                errors.push(`${key}: must be ${expected}`);
                continue;
            }
            const value = data[key] as SettingValue; // type checked above
            if (Array.isArray(extra) && !extra.includes(String(value))) {
                const allowed = extra.map((o) => `"${o}"`).join(', ');
                errors.push(`${key}: must be one of ${allowed}`);
            } else if (key === 'viewer-share' && (Number(value) < 0.2 || Number(value) > 0.8))
                errors.push(`${key}: must be between 0.2 and 0.8`);
            else if (typeof value === 'number' && !(value > 0 && Number.isFinite(value)))
                errors.push(`${key}: must be greater than 0`);
            // trimmed; share rounded to whole % (as form shows it)
            values[key] =
                typeof value === 'string'
                    ? value.trim()
                    : key === 'viewer-share'
                      ? Math.round(Number(value) * 100) / 100
                      : value;
        }
        return errors.length ? { errors } : { values };
    };

    // JSON text replaced (Save, reset); border flashes briefly if it changed
    const setJson = (text: string) => {
        if (text === json.value) return;
        json.value = text;
        json.animate?.([{ borderColor: '#0078d4', boxShadow: '0 0 0 3px #0078d4' }, {}], {
            duration: 900,
            easing: 'ease-out',
        });
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
            errorsEl.style.color = c.bad;
            json.style.borderColor = errors ? c.bad : c.border;
            json.style.boxShadow = errors ? `0 0 0 1px ${c.bad}` : 'none';
        }
        const now = current();
        const on = now !== null && (JSON.stringify(now) !== saved || (mode === 'json' && json.value !== toJson(now)));
        saveBtn.disabled = !on;
        saveBtn.style.background = on ? '#0078d4' : 'transparent';
        saveBtn.style.borderColor = on ? '#0078d4' : c.border;
        saveBtn.style.borderStyle = on ? 'solid' : 'dashed';
        saveBtn.style.color = on ? '#fff' : c.muted;
        saveBtn.style.opacity = on ? '1' : '.45';
        saveBtn.style.cursor = on ? 'pointer' : 'not-allowed';
        if (changed()) note.textContent = '';
    };

    // Tabs: the pane of the mode (or "About"), its button pressed; no Save etc. under "About" (values stay as entered)
    const drawTabs = () => {
        const shown = about ? 'about' : mode;
        for (const pane of form.querySelectorAll('[data-pane]')) {
            pane.style.display = pane.dataset.pane !== shown ? 'none' : pane.dataset.pane === 'form' ? 'grid' : 'block';
        }
        for (const b of form.querySelectorAll('[data-mode]')) {
            const active = b.dataset.mode === shown;
            b.style.background = active ? '#0078d4' : 'transparent';
            b.style.color = active ? '#fff' : c.fg;
        }
        part('[data-footer]').style.visibility = about ? 'hidden' : 'visible';
    };
    // Form / JSON switch: other view takes over values entered so far; "About" leaves them as they are
    const setMode = (next: string) => {
        if (next === 'about') {
            about = true;
            return drawTabs();
        }
        about = false;
        if (next === mode) return drawTabs();
        if (next === 'form') {
            const { values, errors } = readJson();
            if (errors) {
                drawTabs();
                note.textContent = 'Fix the JSON first (see the reasons below it).';
                return;
            }
            setForm(values);
        } else {
            json.value = toJson(readForm());
        }
        mode = next;
        drawTabs();
        errorsEl.textContent = '';
        update();
    };
    form.querySelectorAll('[data-mode]').forEach((b) => {
        b.onclick = () => setMode(b.dataset.mode ?? '');
    });
    part('[data-act="reset"]').onclick = () => {
        setForm(DEFAULTS);
        if (mode === 'json') setJson(toJson(readForm()));
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

    // JSON entered: obsolete settings dropped and missing ones added on Save (warning below JSON)
    const completions = (): string[] => {
        const keys = Object.keys(JSON.parse(json.value));
        const dropped = keys.filter((key) => !(key in DEFAULTS));
        const added = Object.keys(DEFAULTS).filter((key) => !keys.includes(key));
        return [
            dropped.length ? `Unrecognised/obsolete settings dropped: ${dropped.join(', ')}` : '',
            added.length ? `Missing settings added (defaults): ${added.join(', ')}` : '',
        ].filter(Boolean);
    };

    form.onsubmit = (e) => {
        e.preventDefault();
        const values = current();
        if (!values) return;
        const fresh = JSON.stringify(values) !== saved;
        if (fresh) {
            for (const [key, value] of Object.entries(values)) {
                // changed start value replaces choice remembered from viewer
                if (value !== stored[key] && REMEMBERED_BY[key]) removePref(REMEMBERED_BY[key]);
                GM_setValue(key, value);
            }
            Object.assign(stored, values);
            saved = JSON.stringify(values);
        }
        const warnings = mode === 'json' ? completions() : [];
        if (mode === 'json') setJson(toJson(values));
        update();
        note.textContent = fresh ? 'Saved. Reload the page to apply.' : 'JSON completed: nothing new to save.';
        if (warnings.length) {
            errorsEl.style.color = c.warn;
            errorsEl.textContent = warnings.join('\n');
        }
    };

    // Close (✕, Cancel, Esc, click beside): asks first if unsaved
    const close = () => {
        if (changed() && !confirm('Close without saving your changes?')) return;
        document.removeEventListener('keydown', onKey, true);
        wrap.remove();
    };
    // Esc closes; Ctrl+S / Cmd+S saves (as in write mode), never the browser's "save page"
    const onKey = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            e.stopPropagation();
            if (!saveBtn.disabled) form.requestSubmit(saveBtn);
            return;
        }
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
    // Drag title row (not its buttons or links) to move window
    part('[data-drag]').addEventListener('pointerdown', (e) => {
        if (e.button === 0 && !(e.target as HTMLElement).closest('button, a')) startMove(e, form, SETTINGS_POS_KEY);
    });

    wrap.append(form);
    document.body.append(wrap);
    // JSON view as high as form view: no jump on switch
    const formHeight = part('[data-pane="form"]').getBoundingClientRect().height;
    json.style.height = `${Math.max(200, Math.round(formHeight) - 43)}px`;
    part('[data-pane="about"]').style.height = `${Math.max(200, Math.round(formHeight))}px`;
    if (start === 'json' || start === 'about') setMode(start);
    placeMoved(form, SETTINGS_POS_KEY);
}
/**
 * Settings as given, missing ones from defaults, unknown ones dropped (values not checked).
 */
export function completeSettings(data: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, key in data ? data[key] : defaults[key]]));
}
/** Asks, then writes every default back (applies after a reload). */
export function resetSettings(): void {
    if (!confirm('Reset all Sharepoint Previewer settings to their defaults?')) return;
    for (const [key, value] of Object.entries(DEFAULTS)) GM_setValue(key, value);
    alert('Settings reset. Reload the page to apply them.');
}
