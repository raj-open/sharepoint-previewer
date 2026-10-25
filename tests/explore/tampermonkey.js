// Tampermonkey stand-in for explorative tests (cf. ./server.mjs): GM_* API, then the userscript at DOMContentLoaded.
//
// - GM_getValue / GM_setValue: localStorage (kept across reloads; "Clear settings" in the panel empties it)
// - GM_registerMenuCommand: buttons in a small panel at the bottom left (Tampermonkey's menu)
// - GM_info.script.version: the userscript's @version

(() => {
    // ================================================================
    // CONSTANTS
    // ================================================================

    const KEY = 'tampermonkey:';
    const URL_SCRIPT = '/__explore__/userscript.js';
    const version = document.currentScript?.dataset.version ?? '';

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
            'position: fixed; left: 8px; bottom: 8px; z-index: 2147483647; padding: 4px 8px; max-width: 260px;' +
            'font: 12px sans-serif; color: #222; background: #fffbe6; border: 1px solid #d4b106; border-radius: 6px;';
        const title = document.createElement('summary');
        title.textContent = `Tampermonkey (stand-in) ${version}`;
        title.style.cursor = 'pointer';
        box.append(title);
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

    // document-idle, as Tampermonkey (@run-at)
    document.addEventListener('DOMContentLoaded', () => {
        panel();
        const el = document.createElement('script');
        el.src = URL_SCRIPT;
        document.head.append(el);
    });
})();
