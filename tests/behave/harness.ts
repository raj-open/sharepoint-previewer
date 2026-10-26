// Harness for behavioural tests: Chromium (Playwright) on the mock Sharepoint,
// userscript from /dist/userscript.js injected per page load (as Tampermonkey does at document-idle).
//
// Browser once per machine: `npx playwright install chromium` (part of `just build-deps`),
// or a browser installed already: BROWSER_CHANNEL (e.g. `chrome`, as on GitHub's runners; nothing downloaded).

import type { Locator } from 'playwright';
import type { Page } from 'playwright';
import { chromium } from 'playwright';
import * as sharepoint from '../mocks/mock-sharepoint/server.ts';
import { has3dRelease } from '../mocks/mock-sharepoint/server.ts';
import { userscript } from '../mocks/mock-sharepoint/userscript.ts';

export const { ORIGIN, LIBRARY, LIST_PAGE, SITE } = sharepoint;
export { has3dRelease };

// Browser session: page and the requests it made (range: Range header)
export type Session = { page: Page; requests: { url: string; method: string; range?: string }[] };

// Runs in page before its own scripts: Tampermonkey API, then the userscript at DOMContentLoaded
function tampermonkey({ script, settings }: { script: string; settings: Record<string, unknown> }): void {
    const store: Record<string, unknown> = { ...settings };
    const gm = {
        menu: {} as Record<string, () => void>,
        alerts: [] as string[],
        confirms: [] as string[],
        prompts: [] as string[],
        answers: [] as string[], // for prompts, in turn (none left: cancelled)
    };
    Object.assign(window, {
        __gm: gm,
        GM_getValue: (key: string, fallback?: unknown) => (key in store ? store[key] : fallback),
        GM_setValue: (key: string, value: unknown) => {
            store[key] = value;
        },
        GM_registerMenuCommand: (label: string, fn: () => void) => {
            gm.menu[label] = fn;
        },
        GM_info: { script: { version: 'test' } },
        // dialogues would block the page: recorded instead (confirm answers "yes", prompt the next of `answers`)
        alert: (msg: unknown) => void gm.alerts.push(String(msg)),
        confirm: (msg: unknown) => {
            gm.confirms.push(String(msg));
            return true;
        },
        prompt: (msg: unknown) => {
            gm.prompts.push(String(msg));
            return gm.answers.shift() ?? null;
        },
    });
    document.addEventListener('DOMContentLoaded', () => {
        const el = document.createElement('script');
        el.textContent = script;
        document.documentElement.append(el);
    });
}

/**
 * Browser with the mock Sharepoint; one per test file.
 * Default: BROWSER_CHANNEL if set (an installed browser, e.g. `chrome`), else Chromium headless shell (fast);
 * `channel: 'chromium'`: full Chromium in new headless mode (GPU compositing, e.g. WebGPU canvases in screenshots).
 */
export async function launch({
    channel = process.env.BROWSER_CHANNEL || undefined,
}: {
    channel?: string;
} = {}): Promise<{
    open: (url?: string, opts?: { settings?: Record<string, unknown> }) => Promise<Session>;
    close: () => Promise<void>;
}> {
    const browser = await chromium.launch({ channel, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
    const script = userscript();
    // Simulated uploads of this browser (one per test file), removed on close
    const uploads = sharepoint.startUploads(`behave-${process.pid}`);

    const open = async (
        url = LIST_PAGE,
        { settings = {} }: { settings?: Record<string, unknown> } = {},
    ): Promise<Session> => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const requests: Session['requests'] = [];
        await context.route('**/*', async (route) => {
            const req = route.request();
            if (!req.url().startsWith(ORIGIN)) {
                requests.push({ url: req.url(), method: req.method() });
                return route.abort(); // nothing leaves the mock Sharepoint
            }
            const headers = req.headers();
            requests.push({ url: req.url(), method: req.method(), range: headers.range });
            const body = req.postDataBuffer() ?? undefined;
            const reply = sharepoint.handle({ url: req.url(), method: req.method(), headers, body }, { uploads });
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

    const close = async () => {
        await browser.close();
        sharepoint.endUploads(uploads);
    };
    return { open, close };
}

/** @param folder server-relative @returns list view of that folder */
export const folderUrl = (folder: string): string =>
    `${sharepoint.listPageOf(sharepoint.libraryOf(folder))}?id=${encodeURIComponent(folder)}`;

export const row = (page: Page, name: string): Locator =>
    page.locator('[role="grid"] [role="row"]').filter({
        has: page.locator('[data-automationid="field-LinkFilename"]', {
            hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
        }),
    });

/** @returns eye of that file */
export const eye = (page: Page, name: string): Locator => row(page, name).locator('.tp-preview');

/** Opens a file's preview and waits until its content is shown. @returns viewer */
export async function preview(page: Page, name: string): Promise<Locator> {
    await eye(page, name).click();
    const viewer = page.locator('.tp-viewer');
    await viewer.locator('.tp-title-name', { hasText: name }).waitFor();
    await settled(page);
    return viewer;
}

/** @returns text of an element (empty if none) */
export const text = async (l: Locator): Promise<string> => (await l.textContent()) ?? '';

/** Waits until the viewer is idle: nothing is being cached (progress shows the cache state). */
export async function settled(page: Page): Promise<void> {
    await page.locator('.tp-viewer .tp-progress:is(.tp-full, .tp-idle, .tp-off)').waitFor();
}
