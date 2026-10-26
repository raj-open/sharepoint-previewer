// Screenshots for the demos (/demos/img/<case>.png): the userscript on the mock Sharepoint,
// in full Chromium (Playwright, new headless mode),
// with the harness of the behavioural tests (/tests/behave/harness.ts).
// Usage: node scripts/demos.ts [case ...] (no case: all); cf. `just demos`.
// NOTE: only fixtures of the mock Sharepoint are shown (/tests/mocks/mock-sharepoint/library).

import fs from 'node:fs';
import path from 'node:path';
import type { Locator } from 'playwright';
import type { Page } from 'playwright';
import * as h from '../tests/behave/harness.ts';
import { RELEASE_SETTING } from '../tests/mocks/mock-sharepoint/server.ts';

// ----------------------------------------------------------------
// LOCAL CONSTANTS
// ----------------------------------------------------------------

const PATH_IMG = 'demos/img';

// pickers in the status bar: sheet or table (right of Table)
const SHEET_PICKER = '.tp-views:not(.tp-format) > .tp-picker';

// full Chromium (new headless mode): the headless shell leaves WebGPU canvases blank in screenshots
const CHANNEL = 'chromium';

// 3D view: status line once the model is loaded, then time for frames to be drawn
const STATUS_3D = /\d+ objects · /;
const WAIT_3D = 1000;

// Mouse pointer drawn into the page (headless screenshots show none): arrow, tip at the top left
const POINTER_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="26" viewBox="0 0 18 26">' +
    '<path d="M1 1v20l5-5 4 9 3-1.5-4-8.5h7z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';

// settings for the 3D view (as `just tests-explore` fills them in): release folder of the mock Sharepoint
const SETTINGS_3D = { 'viewer-3d-folder': RELEASE_SETTING };

// Part of the page shown (default: all of it)
type Clip = { x: number; y: number; width: number; height: number };

// Demo case: folder (relative to the library), file to preview (optional), steps after opening,
// element the mouse points at (default: none, mouse away), part of the page to show (default: the whole page)
type Case = {
    folder: string;
    file?: string;
    settings?: Record<string, unknown>;
    width?: number; // of the window (default: as the behavioural tests)
    skip?: () => string;
    before?: (page: Page) => Promise<void>;
    steps?: (page: Page, viewer: Locator) => Promise<void>;
    pointer?: (page: Page, viewer: Locator) => Locator;
    clip?: (page: Page, viewer: Locator) => Promise<Clip>;
};

const CASES: Record<string, Case> = {
    // ---- list, layouts ----
    list: { folder: '' },
    search: {
        folder: '',
        before: async (page) => {
            await page.locator('#search').fill('2025');
            await page.locator('#search').press('Enter');
        },
        file: '2025.csv',
        pointer: (page) => h.eye(page, '2025.csv'),
    },
    vertical: {
        folder: '',
        settings: { 'layout': 'vertical', 'viewer-share': 0.5 },
        width: 1800, // the title bar on one row (narrower: file name on a second row)
        // NOTE: no file opened by `preview` (it waits for the progress bar, hidden in a narrow status bar)
        before: async (page) => {
            await h.eye(page, 'README.md').click();
            await page.locator('.tp-viewer .tp-md h1').waitFor();
        },
        pointer: (page) => h.eye(page, 'README.md'),
    },
    // narrow viewer (right of the list, default share): title bar on two rows
    narrow: {
        folder: '/Data',
        settings: { layout: 'vertical' },
        before: async (page) => {
            await h.eye(page, 'prices.csv').click();
            await page.locator('.tp-viewer .tp-header.tp-narrow').waitFor();
            await page.locator('.tp-viewer .tp-mode-btn[title^="Display file metadata"]').click();
        },
        clip: async (page) => {
            const v = page.locator('.tp-viewer');
            return top(v, v.locator('.tp-title').nth(1));
        },
    },
    popup: { folder: '/Config', file: 'settings.xml', settings: { layout: 'popup' } },
    // ---- title bar: name, properties, link, rename ----
    title: {
        folder: '/Data',
        file: 'prices.csv',
        steps: async (_page, v) => {
            await v.locator('.tp-mode-btn[title^="Display file metadata"]').click();
        },
        pointer: (_page, v) => v.locator('.tp-mode-btn[title^="Display file metadata"]'),
        clip: async (_page, v) => top(v, v.locator('.tp-title').nth(1)),
    },
    link: {
        folder: '/Data',
        file: 'prices.csv',
        steps: async (page, v) => {
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
            await v.locator('.tp-mode-btn[title^="Copy the link"]').click();
            console.log(`link copied: ${await page.evaluate(() => navigator.clipboard.readText())}`);
        },
        pointer: (_page, v) => v.locator('.tp-title .tp-mode-btn').nth(1),
        clip: async (_page, v) => top(v, v.locator('.tp-header')),
    },
    rename: {
        folder: '',
        file: 'notes.txt',
        steps: async (_page, v) => {
            await v.locator('.tp-mode-btn[title^="Edit"]').click();
            await v.locator('.tp-title-name').click();
            await v.locator('.tp-name-input').fill('minutes.txt');
        },
        pointer: (_page, v) => v.locator('.tp-name-input'),
        clip: async (_page, v) => top(v, v.locator('.tp-header')),
    },
    // ---- text ----
    text: { folder: '/Config', file: 'settings.xml' },
    lint: {
        folder: '/Config',
        file: 'broken.xml',
        steps: async (page) => {
            await page.locator('.tp-lint.tp-lint-bad').waitFor();
        },
    },
    markdown: {
        folder: '',
        file: 'README.md',
        steps: async (_page, v) => {
            await view(v, 'Markdown');
            await v.locator('.tp-md h1').waitFor();
        },
    },
    // ---- tables ----
    csv: {
        folder: '/Data',
        file: 'prices.csv',
        steps: async (_page, v) => {
            await view(v, 'Table');
            await v.locator('.tp-table').waitFor();
        },
        clip: async (_page, v) => box(v),
    },
    'csv-colours': {
        folder: '/Data',
        file: 'prices.csv',
        settings: { 'colours-table': true },
        steps: async (_page, v) => {
            await view(v, 'Table');
            await v.locator('.tp-table').waitFor();
        },
        clip: async (_page, v) => box(v),
    },
    'csv-edit': {
        folder: '/Data',
        file: 'prices.csv',
        steps: async (page, v) => {
            await view(v, 'Table');
            await v.locator('.tp-mode-btn[title^="Edit"]').click();
            const cell = v.locator('td[data-r="1"][data-c="1"]');
            await cell.click();
            await page.keyboard.press('End');
            await page.keyboard.type(' (edited)');
        },
        pointer: (_page, v) => v.locator('td[data-r="1"][data-c="1"]'),
        clip: async (_page, v) => box(v),
    },
    spreadsheet: {
        folder: '/Data',
        file: 'orders.xlsx',
        steps: async (_page, v) => {
            await v.locator('.tp-title-sheet', { hasText: 'Table:' }).waitFor();
        },
    },
    picker: {
        folder: '/Data',
        file: 'orders.xlsx',
        steps: async (_page, v) => {
            await v.locator(SHEET_PICKER).click();
            await v.locator('.tp-picker-menu').first().locator('.tp-picker-item').first().waitFor();
        },
        pointer: (_page, v) => v.locator(SHEET_PICKER),
    },
    log: {
        folder: '/Logs',
        file: 'app.log',
        steps: async (_page, v) => {
            await view(v, 'Table');
            await v.locator('.tp-table').waitFor();
        },
    },
    '3d': {
        folder: '/Models',
        file: 'corner.ifc',
        settings: SETTINGS_3D,
        skip: () => (h.has3dRelease() ? '' : 'no 3D files: run `just build` first'),
        steps: async (page, v) => {
            await view(v, '3D');
            await v.getByText(STATUS_3D).waitFor({ timeout: 30000 });
            await page.waitForTimeout(WAIT_3D);
        },
    },
};

// ----------------------------------------------------------------
// METHODS
// ----------------------------------------------------------------

/** @returns area of an element */
async function box(l: Locator): Promise<Clip> {
    const b = await l.boundingBox();
    if (!b) throw new Error('element not shown');
    return b;
}

/** @returns top of the viewer, down to the bottom of `until` (and a little room) */
async function top(v: Locator, until: Locator): Promise<Clip> {
    const outer = await box(v);
    const inner = await box(until);
    return { ...outer, height: inner.y + inner.height - outer.y + 8 };
}

/**
 * Moves the mouse onto an element (hover look) and draws the pointer there,
 * its tip low right of the middle (the element stays visible); none: mouse away
 */
async function point(page: Page, target?: Locator): Promise<void> {
    const b = target && (await target.boundingBox());
    if (!b) return void (await page.mouse.move(0, 0)); // no hover effects
    const x = b.x + b.width * 0.75;
    const y = b.y + b.height * 0.75;
    await page.mouse.move(x, y);
    await page.evaluate(
        ({ svg, x, y }) => {
            const el = document.createElement('div');
            el.innerHTML = svg;
            el.style.cssText = `position: fixed; left: ${x - 1}px; top: ${y - 1}px; z-index: 2147483647; pointer-events: none;`;
            document.body.append(el);
        },
        { svg: POINTER_SVG, x, y },
    );
}

/** Switches the viewer to a view (Text, Table, Markdown, 3D, ...) unless already on it. */
async function view(v: Locator, name: string): Promise<void> {
    const btn = v.locator('.tp-view-btn', { hasText: name });
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
}

async function capture(browser: Awaited<ReturnType<typeof h.launch>>, name: string, c: Case): Promise<void> {
    const { page } = await browser.open(h.folderUrl(`${h.LIBRARY}${c.folder}`), { settings: c.settings ?? {} });
    if (c.width) await page.setViewportSize({ width: c.width, height: page.viewportSize()?.height ?? 900 });
    await page.locator('.tp-preview').first().waitFor();
    await c.before?.(page);
    const v = page.locator('.tp-viewer');
    if (c.file) {
        await h.preview(page, c.file);
        await c.steps?.(page, v);
    }
    await point(page, c.pointer?.(page, v));
    const out = path.join(PATH_IMG, `${name}.png`);
    await page.screenshot({ path: out, clip: await c.clip?.(page, v) });
    await page.context().close();
    console.log(`wrote ${out}`);
}

async function main() {
    const names = process.argv.slice(2).filter(Boolean);
    const unknown = names.filter((name) => !(name in CASES));
    if (unknown.length)
        throw new Error(`unknown case(s): ${unknown.join(', ')}; known: ${Object.keys(CASES).join(', ')}`);
    fs.mkdirSync(PATH_IMG, { recursive: true });
    const browser = await h.launch({ channel: CHANNEL });
    let failed = 0;
    try {
        for (const [name, c] of Object.entries(CASES)) {
            if (names.length && !names.includes(name)) continue;
            const reason = c.skip?.();
            if (reason) {
                console.log(`skipped ${name}: ${reason}`);
                continue;
            }
            try {
                await capture(browser, name, c);
            } catch (err) {
                failed++;
                console.error(`failed ${name}: ${err instanceof Error ? err.message : err}`);
            }
        }
    } finally {
        await browser.close();
    }
    process.exitCode = failed ? 1 : 0;
}

await main();
