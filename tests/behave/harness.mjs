// Harness for behavioural tests: Chromium (Playwright) on the fake SharePoint,
// userscript from /src/main.js injected per page load (as Tampermonkey does at document-idle).
//
// Browser once per machine: `npx playwright install chromium` (part of `just build-deps`).

import { chromium } from 'playwright';
import * as sharepoint from '../fake-sharepoint/server.mjs';
import { has3dRelease } from '../fake-sharepoint/server.mjs';
import { userscript } from '../fake-sharepoint/userscript.mjs';

export const { ORIGIN, LIBRARY, LIST_PAGE, SITE } = sharepoint;
export { has3dRelease };

// Runs in page before its own scripts: Tampermonkey API, then the userscript at DOMContentLoaded
/** @param {{ script: string, settings: Object<string, *> }} args */
function tampermonkey({ script, settings }) {
    const store = { ...settings };
    const gm = { menu: {}, alerts: [], confirms: [] };
    Object.assign(window, {
        __gm: gm,
        GM_getValue: (key, fallback) => (key in store ? store[key] : fallback),
        GM_setValue: (key, value) => {
            store[key] = value;
        },
        GM_registerMenuCommand: (label, fn) => {
            gm.menu[label] = fn;
        },
        GM_info: { script: { version: 'test' } },
        // dialogues would block the page: recorded instead (confirm answers "yes")
        alert: (msg) => void gm.alerts.push(String(msg)),
        confirm: (msg) => {
            gm.confirms.push(String(msg));
            return true;
        },
    });
    document.addEventListener('DOMContentLoaded', () => {
        const el = document.createElement('script');
        el.textContent = script;
        document.documentElement.append(el);
    });
}

/**
 * Browser with the fake SharePoint; one per test file.
 * @returns {Promise<{ open: (url?: string, opts?: { settings?: Object<string, *> }) => Promise<Session>, close: () => Promise<void> }>}
 *
 * @typedef {{ page: import('playwright').Page, requests: { url: string, method: string, range?: string }[] }} Session
 */
export async function launch() {
    const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
    const script = userscript();

    /** @param {string} [url] @param {{ settings?: Object<string, *> }} [opts] @returns {Promise<Session>} */
    const open = async (url = LIST_PAGE, { settings = {} } = {}) => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        /** @type {Session['requests']} */
        const requests = [];
        await context.route('**/*', async (route) => {
            const req = route.request();
            if (!req.url().startsWith(ORIGIN)) {
                requests.push({ url: req.url(), method: req.method() });
                return route.abort(); // nothing leaves the fake SharePoint
            }
            const headers = req.headers();
            requests.push({ url: req.url(), method: req.method(), range: headers.range });
            const reply = sharepoint.handle({ url: req.url(), method: req.method(), headers });
            await route.fulfill({ status: reply.status, headers: reply.headers, body: reply.body });
        });
        await context.addInitScript(tampermonkey, { script, settings });
        const page = await context.newPage();
        page.on('pageerror', (err) => {
            throw err;
        });
        await page.goto(new URL(url, ORIGIN).href);
        return { page, requests };
    };

    return { open, close: () => browser.close() };
}

/** @param {string} folder server-relative @returns {string} list view of that folder */
export const folderUrl = (folder) => `${LIST_PAGE}?id=${encodeURIComponent(folder)}`;

/** @param {import('playwright').Page} page @param {string} name @returns {import('playwright').Locator} */
export const row = (page, name) =>
    page.locator('[role="grid"] [role="row"]').filter({
        has: page.locator('[data-automationid="field-LinkFilename"]', {
            hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
        }),
    });

/** @param {import('playwright').Page} page @param {string} name @returns {import('playwright').Locator} eye of that file */
export const eye = (page, name) => row(page, name).locator('.tp-preview');

/** Opens a file's preview and waits until its content is shown. */
/** @param {import('playwright').Page} page @param {string} name @returns {Promise<import('playwright').Locator>} viewer */
export async function preview(page, name) {
    await eye(page, name).click();
    const viewer = page.locator('.tp-viewer');
    await viewer.locator('.tp-title-name', { hasText: name }).waitFor();
    await settled(page);
    return viewer;
}

/** Waits until the viewer is idle: nothing is being cached (progress shows the cache state). */
/** @param {import('playwright').Page} page @returns {Promise<void>} */
export async function settled(page) {
    await page.locator('.tp-viewer .tp-progress:is(.tp-full, .tp-idle, .tp-off)').waitFor();
}
