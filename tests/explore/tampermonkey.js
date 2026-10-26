// Tampermonkey stand-in for explorative tests (cf. ./server.ts): GM_* API, then the userscript at DOMContentLoaded.
//
// - GM_getValue / GM_setValue: localStorage (kept across reloads; "Clear settings" in the panel empties it);
//   settings not set (missing, empty, or an earlier default) get the server's defaults on each page load
//   (`viewer-3d-folder` of the mock Sharepoint, a test logo)
// - GM_registerMenuCommand: buttons in a small panel at the top right (where Tampermonkey's menu is)
// - GM_info.script.version: the userscript's @version

(() => {
    // ================================================================
    // CONSTANTS
    // ================================================================

    const KEY = 'tampermonkey:';
    const URL_SCRIPT = '/__explore__/userscript.js';
    const data = document.currentScript?.dataset ?? {};
    const version = data.version ?? '';
    /** @type {Object<string, *>} */
    const defaults = JSON.parse(data.defaults || '{}');
    /** @type {string[]} */
    const notes = JSON.parse(data.notes || '[]');

    /** @type {[string, () => void][]} */
    const commands = [];

    // ================================================================
    // METHODS
    // ================================================================

    // --------------------------------
    // storage
    // --------------------------------

    /** @param {string} name @param {*} fallback */
    function getValue(name, fallback) {
        try {
            const raw = localStorage.getItem(KEY + name);
            return raw === null ? fallback : JSON.parse(raw);
        } catch {
            return fallback;
        }
    }

    /** @param {string} name @param {*} value */
    function setValue(name, value) {
        try {
            localStorage.setItem(KEY + name, JSON.stringify(value));
        } catch (err) {
            console.warn('GM_setValue', name, err);
        }
    }

    function clearValues() {
        try {
            for (const name of Object.keys(localStorage)) if (name.startsWith(KEY)) localStorage.removeItem(name);
        } catch (err) {
            console.warn('clear settings', err);
        }
    }

    // --------------------------------
    // menu
    // --------------------------------

    /** @param {string} label @param {() => void} fn */
    function button(label, fn) {
        const el = document.createElement('button');
        el.type = 'button';
        el.textContent = label;
        el.style.cssText = 'display: block; width: 100%; margin: 2px 0; text-align: left; cursor: pointer;';
        el.addEventListener('click', fn);
        return el;
    }

    function panel() {
        const box = document.createElement('details');
        box.id = 'tampermonkey-explore';
        box.style.cssText =
            'position: fixed; right: 8px; top: 8px; z-index: 2147483647; padding: 4px 8px; max-width: 260px;' +
            'font: 12px sans-serif; color: #222; background: #fffbe6; border: 1px solid #d4b106; border-radius: 6px;';
        const title = document.createElement('summary');
        title.textContent = `Tampermonkey (stand-in) ${version}`;
        title.style.cursor = 'pointer';
        box.append(title);
        for (const note of notes) {
            const line = document.createElement('div');
            line.textContent = note;
            line.style.cssText = 'margin: 2px 0; color: #555; overflow-wrap: anywhere;';
            box.append(line);
        }
        for (const [label, fn] of commands) box.append(button(label, fn));
        box.append(
            button('Clear settings and reload', () => {
                clearValues();
                location.reload();
            }),
        );
        document.getElementById(box.id)?.remove();
        document.body.append(box);
    }

    /** @param {string} label @param {() => void} fn */
    function registerMenuCommand(label, fn) {
        commands.push([label, fn]);
        if (document.body) panel();
    }

    // --------------------------------
    // start
    // --------------------------------

    Object.assign(window, {
        GM_getValue: getValue,
        GM_setValue: setValue,
        GM_registerMenuCommand: registerMenuCommand,
        GM_info: { script: { version } },
    });

    // settings not set (or left empty, or still an earlier default of the explorer): the server's defaults
    const DEFAULTS_KEY = 'tampermonkey-defaults';
    /** @type {Object<string, *>} */
    let before = {};
    try {
        before = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || '{}');
    } catch {}
    for (const [name, value] of Object.entries(defaults)) {
        const now = getValue(name, undefined);
        if (now === undefined || now === '' || now === before[name]) setValue(name, value);
    }
    try {
        localStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults));
    } catch {}

    // document-idle, as Tampermonkey (@run-at)
    document.addEventListener('DOMContentLoaded', () => {
        panel();
        const el = document.createElement('script');
        el.src = URL_SCRIPT;
        document.head.append(el);
    });
})();
