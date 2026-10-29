// Screenshots for the demos (/demos/img/<case>.png): the userscript on the mock Sharepoint,
// in full Chromium (Playwright, new headless mode),
// with the harness of the behavioural tests (/tests/behave/harness.ts).
// Usage: node scripts/demos.ts [case ...] (no case: all); cf. `just demos`.
// Case `hero`: the animation at the top of the README (stories below, cf. /scripts/hero.ts).
// NOTE: only fixtures of the mock Sharepoint are shown (/tests/mocks/mock-sharepoint/library).

import fs from 'node:fs';
import path from 'node:path';
import type { Locator } from 'playwright';
import type { Page } from 'playwright';
import * as h from '../tests/behave/harness.ts';
import { RELEASE_SETTING } from '../tests/mocks/mock-sharepoint/server.ts';
import { encode } from './hero.ts';
import { encoder } from './hero.ts';
import { PATH_FRAMES } from './hero.ts';

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

// object clicked in the 3D view of the flat: point of the canvas (fractions of its width, height)
const PICK_3D: [number, number] = [0.6, 0.62];

// Mouse pointer drawn into the page (headless screenshots show none): arrow, tip at the top left
const POINTER_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="26" viewBox="0 0 18 26">' +
    '<path d="M1 1v20l5-5 4 9 3-1.5-4-8.5h7z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';

// settings for the 3D view: release folder of the mock Sharepoint (as `just tests-explore` fills it in)
const SETTINGS_3D = { 'viewer-3d-folder': RELEASE_SETTING, 'viewer-share': 0.7 }; // taller viewer: the model large

// Link as Sharepoint's own "Copy link" gives it (typical form: sharing prefix, encoded, query), for comparison
const LINK_SHAREPOINT =
    'https://acme.sharepoint.com/:x:/r/sites/MockSharepoint/MockLibrary/Data/prices.csv?d=w5c2e9f8a41b34d0c&csf=1&web=1&e=Xk7Qp2';

// Box the link is pasted into (laid over the page, below the viewer's title bar)
const PASTE_CSS =
    'position: fixed; left: 50%; top: 52%; translate: -50% 0; width: 860px; z-index: 2147483646;' +
    'padding: 14px 18px; border: 1px solid #c8c6c4; border-radius: 8px; background: #faf9f8;' +
    'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #323130;';

// Caption of a hero beat: drawn into the suite bar, right of the search box
const CAPTION_CSS =
    'position: fixed; top: 11px; right: 16px; z-index: 2147483647; pointer-events: none;' +
    'padding: 3px 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.2); color: #fff;' +
    'font: 600 17px/20px system-ui, -apple-system, "Segoe UI", sans-serif;';

// Point of the page (CSS pixels)
type Spot = { x: number; y: number };

// Last click of a hero beat (by `tap` or in the 3D view): the pointer is drawn there unless the beat names an element
let clicked: Spot | null = null;

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
    // ---- Zen mode: own list of the folder (properties) beside the viewer ----
    zen: {
        folder: '/Data',
        file: 'prices.csv',
        steps: async (page) => {
            await zen(page);
        },
    },
    // the four ways: Zen mode off / on, with / without the viewer (the tab: outline while off, filled while on)
    'zen-off': {
        folder: '/Data',
        pointer: (page) => page.locator('.tp-zen-tab'),
    },
    'zen-off-viewer': {
        folder: '/Data',
        file: 'prices.csv',
        pointer: (page) => page.locator('.tp-zen-tab'),
    },
    'zen-alone': {
        folder: '/Data',
        before: async (page) => {
            await page.locator('.tp-zen-tab').click();
            await page.locator('.tp-zen .tp-zen-row').first().waitFor();
            await page.mouse.move(0, 0);
        },
    },
    'zen-popup': {
        folder: '/Data',
        file: 'harvest.xlsx',
        settings: { layout: 'popup' },
        steps: async (page) => {
            await zen(page);
        },
    },
    'zen-dark': {
        folder: '/Data',
        file: 'prices.csv',
        settings: { theme: 'dark' },
        steps: async (page) => {
            await zen(page);
        },
    },
    'zen-vertical': {
        folder: '/Data',
        settings: { layout: 'vertical' },
        width: 1800,
        before: async (page) => {
            await page.locator('.tp-head').dispatchEvent('click'); // empty viewer, then Zen mode
            await page.locator('.tp-viewer').waitFor();
            await zen(page);
            await page.locator('.tp-zen td.tp-zen-name', { hasText: 'orders.xlsx' }).click();
            await page.locator('.tp-viewer .tp-title-sheet').waitFor();
        },
    },
    'zen-edit': {
        folder: '/Data',
        file: 'prices.csv',
        steps: async (page) => {
            await zen(page);
            const z = page.locator('.tp-zen');
            await z.locator('.tp-zen-btn[title^="Edit"]').click();
            const row = z.locator('tr.tp-zen-row', { hasText: 'people.parquet' });
            await row.locator('select').first().selectOption('Draft');
            const priority = row.locator('.tp-zen-text[contenteditable]').nth(1); // after the name: Priority
            await priority.click();
            await page.keyboard.press('ControlOrMeta+a');
            await page.keyboard.type('urgent');
            await page.keyboard.press('Enter');
            await z.locator('.tp-zen-btn[title^="Save"]').click();
            await z.locator('.tp-zen-btn[title^="Upload"]').click();
            await z.locator('td.tp-zen-error').waitFor();
            // a change not saved yet
            const due = z
                .locator('tr.tp-zen-row', { hasText: 'sales.pbix' })
                .locator('.tp-zen-text[contenteditable]')
                .nth(2);
            await due.click();
            await page.keyboard.press('ControlOrMeta+a');
            await page.keyboard.type('30/11/2026');
            await page.keyboard.press('Enter');
        },
        pointer: (page) => page.locator('.tp-zen td.tp-zen-error'),
    },
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
    // link copied, then pasted (for real, from the clipboard) below a link as Sharepoint gives it
    'link-paste': {
        folder: '/Data',
        file: 'prices.csv',
        steps: async (page, v) => {
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
            await v.locator('.tp-mode-btn[title^="Copy the link"]').click();
            await paste(page);
        },
        pointer: (_page, v) => v.locator('.tp-title .tp-mode-btn').nth(1),
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
    // ---- editing: edit, save, upload (simulated) ----
    edit: {
        folder: '',
        file: 'notes.txt',
        steps: async (page, v) => {
            await editText(page, v);
        },
        pointer: (_page, v) => v.locator('.tp-mode-btn[title^="Save"]'),
        clip: async (_page, v) => box(v),
    },
    'edit-saved': {
        folder: '',
        file: 'notes.txt',
        steps: async (page, v) => {
            await editText(page, v);
            await v.locator('.tp-mode-btn[title^="Save"]').click();
        },
        pointer: (_page, v) => v.locator('.tp-mode-btn[title^="Upload"]'),
        clip: async (_page, v) => box(v),
    },
    'edit-uploaded': {
        folder: '',
        file: 'notes.txt',
        steps: async (page, v) => {
            await editText(page, v);
            await v.locator('.tp-mode-btn[title^="Save"]').click();
            await v.locator('.tp-mode-btn[title^="Upload"]').click();
            await page.locator('#grid .uploaded').waitFor({ timeout: 15000 }); // the list shows the upload
            await h.settled(page); // confirmed by Sharepoint: the cache state is shown again
        },
    },
    // ---- caching (chunks of 1 KB here, so that the small fixtures are cached in parts) ----
    'cache-partly': {
        folder: '/Models',
        settings: { 'cache-chunk-bytes': 1024 },
        before: async (page) => {
            await cacheAll(page, 'wall.ifc');
            await h.eye(page, 'corner.ifc').click();
            await page.locator('.tp-viewer .tp-title-name', { hasText: 'corner.ifc' }).waitFor();
            await page.locator('.tp-viewer .tp-progress.tp-idle').waitFor();
        },
        pointer: (page) => page.locator('.tp-viewer .tp-mode-btn[title^="Cache the whole file"]'),
    },
    'cache-full': {
        folder: '/Models',
        settings: { 'cache-chunk-bytes': 1024 },
        before: async (page) => {
            await cacheAll(page, 'wall.ifc');
            await cacheAll(page, 'corner.ifc');
        },
    },
    // ---- settings (⋯ → Full settings …, or the Tampermonkey menu) ----
    'settings-form': {
        folder: '',
        before: openSettings,
        pointer: (page) => page.locator('.tp-settings [name="theme"]'),
        clip: async (page) => box(page.locator('.tp-settings form')),
    },
    'settings-json': {
        folder: '',
        before: async (page) => {
            await openSettings(page);
            await page.locator('.tp-settings [data-mode="json"]').click();
        },
        pointer: (page) => page.locator('.tp-settings [data-mode="json"]'),
        clip: async (page) => box(page.locator('.tp-settings form')),
    },
    'settings-json-error': {
        folder: '',
        before: async (page) => {
            await openSettings(page);
            await page.locator('.tp-settings [data-mode="json"]').click();
            const json = page.locator('.tp-settings [data-json]');
            await json.fill((await json.inputValue()).replace('"horizontal"', '"diagonal"'));
            await page.locator('.tp-settings [data-errors]', { hasText: 'layout' }).waitFor();
        },
        clip: async (page) => box(page.locator('.tp-settings form')),
    },
    // ---- dark mode (setting `theme`; also ⋯ → Dark mode) ----
    'dark-text': {
        folder: '/Config',
        file: 'broken.xml',
        settings: { theme: 'dark' },
        steps: async (page) => {
            await page.locator('.tp-lint.tp-lint-bad').waitFor();
        },
        clip: async (_page, v) => box(v),
    },
    'dark-table': {
        folder: '/Data',
        file: 'prices.csv',
        settings: { 'theme': 'dark', 'colours-table': true },
        steps: async (_page, v) => {
            await view(v, 'Table');
            await v.locator('.tp-table').waitFor();
        },
        clip: async (_page, v) => box(v),
    },
    'dark-popup': {
        folder: '',
        file: 'README.md',
        settings: { theme: 'dark', layout: 'popup' },
        steps: async (_page, v) => {
            await v.locator('.tp-md h1').waitFor();
        },
    },
    // ---- text ----
    text: { folder: '/Config', file: 'settings.xml', clip: async (_page, v) => box(v) },
    lint: {
        folder: '/Config',
        file: 'broken.xml',
        steps: async (page) => {
            await page.locator('.tp-lint.tp-lint-bad').waitFor();
        },
        clip: async (_page, v) => box(v),
    },
    markdown: {
        folder: '',
        file: 'README.md',
        steps: async (_page, v) => {
            await view(v, 'Markdown');
            await v.locator('.tp-md h1').waitFor();
        },
        clip: async (_page, v) => box(v),
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
    parquet: {
        folder: '/Data',
        file: 'people.parquet',
        steps: async (_page, v) => {
            await view(v, 'Table');
            await v.locator('.tp-table').waitFor();
        },
        pointer: (page) => h.eye(page, 'people.parquet'),
        clip: async (_page, v) => box(v),
    },
    spreadsheet: {
        folder: '/Data',
        file: 'orders.xlsx',
        steps: async (_page, v) => {
            await v.locator('.tp-title-sheet', { hasText: 'Table:' }).waitFor();
        },
        clip: async (_page, v) => box(v),
    },
    picker: {
        folder: '/Data',
        file: 'orders.xlsx',
        steps: async (_page, v) => {
            await v.locator(SHEET_PICKER).click();
            await v.locator('.tp-picker-menu').first().locator('.tp-picker-item').first().waitFor();
        },
        pointer: (_page, v) => v.locator(SHEET_PICKER),
        clip: async (_page, v) => box(v),
    },
    // logs: text first (colours on), then the table (experimental), then an entry expanded
    'log-text': {
        folder: '/Logs',
        file: 'app.log',
        settings: { 'viewer-share': 0.6 }, // taller viewer: an expanded entry fits
        steps: async (_page, v) => {
            await v.locator('.tp-content .tp-ln').first().waitFor(); // lines drawn
        },
        pointer: (_page, v) => v.locator('.tp-view-btn', { hasText: 'Table' }),
        clip: async (_page, v) => box(v),
    },
    log: {
        folder: '/Logs',
        file: 'app.log',
        settings: { 'viewer-share': 0.6 }, // taller viewer: an expanded entry fits
        steps: async (_page, v) => {
            await view(v, 'Table');
            await v.locator('.tp-table .tp-expand').first().waitFor(); // rows filled in
        },
        pointer: (_page, v) => v.locator('.tp-table tr', { hasText: 'request' }).locator('.tp-expand'),
        clip: async (_page, v) => box(v),
    },
    'log-expand': {
        folder: '/Logs',
        file: 'app.log',
        settings: { 'viewer-share': 0.6 }, // taller viewer: an expanded entry fits
        steps: async (_page, v) => {
            await view(v, 'Table');
            await v.locator('.tp-table tr', { hasText: 'request' }).locator('.tp-expand').click();
            await v.locator('.tp-table .tp-detail').waitFor();
        },
        pointer: (_page, v) => v.locator('.tp-table tr', { hasText: 'request' }).locator('.tp-expand'),
        clip: async (_page, v) => box(v),
    },
    // ---- Power BI: overview, picker with parts and queries, a part, a query ----
    powerbi: {
        folder: '/Data',
        file: 'sales.pbix',
        steps: async (_page, v) => {
            await view(v, 'Markdown');
            await v.locator('.tp-md h2').first().waitFor();
        },
        clip: async (_page, v) => box(v),
    },
    'powerbi-picker': {
        folder: '/Data',
        file: 'sales.pbix',
        steps: async (_page, v) => {
            await v.locator(SHEET_PICKER).click();
            await v.locator('.tp-picker-menu').first().locator('.tp-picker-item').first().waitFor();
        },
        pointer: (_page, v) => v.locator(SHEET_PICKER),
        clip: async (_page, v) => box(v),
    },
    'powerbi-layout': {
        folder: '/Data',
        file: 'sales.pbix',
        steps: async (_page, v) => {
            await pick(v, 'Parts', 'Report/Layout');
            await v.locator('.tp-code', { hasText: '"visualType"' }).waitFor();
        },
        clip: async (_page, v) => box(v),
    },
    'powerbi-query': {
        folder: '/Data',
        file: 'sales.pbix',
        steps: async (_page, v) => {
            await pick(v, 'Queries', 'Orders');
            await v.locator('.tp-code', { hasText: 'Table.PromoteHeaders' }).waitFor();
        },
        clip: async (_page, v) => box(v),
    },
    '3d': {
        folder: '/Models',
        file: 'flat.ifc',
        settings: SETTINGS_3D,
        skip: () => (h.has3dRelease() ? '' : 'no 3D files: run `just build` first'),
        steps: async (page, v) => {
            await open3d(page, v);
        },
        clip: async (_page, v) => box(v),
    },
    // flat: an object clicked (at a point of the canvas, as fractions), its properties; then its line in the text
    '3d-props': {
        folder: '/Models',
        file: 'flat.ifc',
        settings: SETTINGS_3D,
        skip: () => (h.has3dRelease() ? '' : 'no 3D files: run `just build` first'),
        steps: async (page, v) => {
            await open3d(page, v);
            await select3d(page, v, PICK_3D);
            await v.locator('.tp-3d-btn', { hasText: 'Properties' }).click();
            await v.locator('.tp-3d-props', { hasText: 'Qto_' }).waitFor();
        },
        pointer: (_page, v) => v.locator('.tp-3d-btn', { hasText: 'Properties' }),
        clip: async (_page, v) => box(v),
    },
    '3d-text': {
        folder: '/Models',
        file: 'flat.ifc',
        settings: SETTINGS_3D,
        skip: () => (h.has3dRelease() ? '' : 'no 3D files: run `just build` first'),
        steps: async (page, v) => {
            await open3d(page, v);
            await select3d(page, v, PICK_3D);
            await v.locator('.tp-3d-btn', { hasText: 'In text' }).click();
            await v.locator('.tp-view-btn[aria-pressed="true"]', { hasText: 'Text' }).waitFor();
            await page.waitForTimeout(300); // scrolled to the line
        },
        clip: async (_page, v) => box(v),
    },
};

// Hero story: one page (folder, settings), its beats in turn; each beat acts, then is shown with a caption
// and the pointer (on an element named, else where the beat clicked last), so that each frame
// differs from the one before by one action only
type Beat = { caption: string; act?: Act; pointer?: (page: Page, v: Locator) => Locator };
type Act = (page: Page, v: Locator) => Promise<void>;
type Story = { folder: string; settings?: Record<string, unknown>; skip?: () => string; beats: Beat[] };

// pop-up layout: viewer large, page dimmed behind it
const POPUP = { layout: 'popup' };

// Hero animation (README): formats Sharepoint does not preview, then editing, Zen mode, the title bar, dark mode
const HERO: Story[] = [
    {
        folder: '/Data',
        beats: [
            { caption: 'Click the eye next to a file', pointer: (page) => h.eye(page, 'people.parquet') },
            {
                caption: 'Parquet as a table, without download',
                act: async (page, v) => {
                    await h.preview(page, 'people.parquet');
                    await tap(page, v.locator('.tp-view-btn', { hasText: 'Table' }));
                    await v.locator('.tp-table').waitFor();
                },
            },
        ],
    },
    {
        folder: '/Data',
        settings: POPUP,
        beats: [
            {
                caption: 'Inside Power BI files',
                act: async (page, v) => {
                    await h.preview(page, 'sales.pbix');
                    await view(v, 'Markdown');
                    await v.locator('.tp-md h2').first().waitFor();
                },
            },
            {
                caption: 'Its parts …',
                act: async (page, v) => {
                    await tap(page, v.locator(SHEET_PICKER));
                    await v.locator('.tp-picker-menu').first().locator('.tp-picker-item').first().waitFor();
                },
            },
            {
                caption: '… its queries …',
                act: async (page, v) => {
                    const menu = v.locator('.tp-picker-menu').first();
                    await tap(page, menu.locator('.tp-picker-tab', { hasText: 'Queries' }));
                    await menu.locator('.tp-picker-item', { hasText: 'Orders' }).first().waitFor();
                },
            },
            {
                caption: '… as Power Query scripts',
                act: async (page, v) => {
                    const menu = v.locator('.tp-picker-menu').first();
                    await tap(page, menu.locator('.tp-picker-item', { hasText: 'Orders' }).first());
                    await v.locator('.tp-code', { hasText: 'Table.PromoteHeaders' }).waitFor();
                },
            },
        ],
    },
    {
        folder: '/Models',
        settings: { ...SETTINGS_3D, ...POPUP },
        skip: () => (h.has3dRelease() ? '' : 'no 3D files: run `just build` first'),
        beats: [
            {
                caption: 'IFC models in 3D',
                act: async (page, v) => {
                    await h.preview(page, 'flat.ifc');
                    await open3d(page, v);
                },
            },
            { caption: 'Click an object …', act: async (page, v) => select3d(page, v, PICK_3D) },
            {
                caption: '… its Psets and Qtos, with units …',
                act: async (page, v) => {
                    await tap(page, v.locator('.tp-3d-btn', { hasText: 'Properties' }));
                    await v.locator('.tp-3d-props', { hasText: 'Qto_' }).waitFor();
                },
            },
            {
                caption: '… and its line in the text',
                act: async (page, v) => {
                    await tap(page, v.locator('.tp-3d-btn', { hasText: 'In text' }));
                    await v.locator('.tp-view-btn[aria-pressed="true"]', { hasText: 'Text' }).waitFor();
                    await page.waitForTimeout(300); // scrolled to the line
                },
            },
        ],
    },
    {
        folder: '/Logs',
        settings: POPUP,
        beats: [
            {
                caption: 'Logs …',
                act: async (page, v) => {
                    await h.preview(page, 'app.log');
                    await v.locator('.tp-content .tp-ln').first().waitFor();
                },
            },
            {
                caption: '… as tables …',
                act: async (page, v) => {
                    await tap(page, v.locator('.tp-view-btn', { hasText: 'Table' }));
                    await v.locator('.tp-table .tp-expand').first().waitFor();
                },
            },
            {
                caption: '… entries unfolded',
                act: async (page, v) => {
                    await tap(page, v.locator('.tp-table tr', { hasText: 'request' }).locator('.tp-expand'));
                    await v.locator('.tp-table .tp-detail').waitFor();
                },
            },
        ],
    },
    {
        folder: '/Config',
        settings: POPUP,
        beats: [
            {
                caption: 'Any text file: colours and checks',
                act: async (page) => {
                    await h.preview(page, 'broken.xml');
                    await page.locator('.tp-lint.tp-lint-bad').waitFor();
                },
            },
        ],
    },
    {
        folder: '',
        settings: POPUP,
        beats: [
            {
                caption: 'Edit …',
                act: async (page, v) => {
                    await h.preview(page, 'notes.txt');
                    await tap(page, v.locator('.tp-mode-btn[title^="Edit"]'));
                    await v.locator('.tp-editor').waitFor();
                },
            },
            {
                caption: '… type …',
                act: async (page, v) => {
                    await v.locator('.tp-editor').press('Control+End');
                    await page.keyboard.type('\n- (edited) agreed: next meeting on Friday');
                },
            },
            { caption: '… save …', act: async (page, v) => tap(page, v.locator('.tp-mode-btn[title^="Save"]')) },
            {
                caption: '… upload to Sharepoint',
                act: async (page, v) => {
                    await tap(page, v.locator('.tp-mode-btn[title^="Upload"]'));
                    await page.locator('#grid .uploaded').waitFor({ timeout: 15000 }); // the list shows the upload
                    await h.settled(page);
                },
            },
        ],
    },
    {
        folder: '/Data',
        beats: [
            {
                caption: 'Zen mode: the folder with all its properties',
                act: async (page) => {
                    await tap(page, page.locator('.tp-zen-tab'));
                    await page.locator('.tp-zen .tp-zen-row').first().waitFor();
                },
            },
            {
                caption: 'Sort, filter, choose columns …',
                act: async (page) => {
                    await tap(page, page.locator('.tp-zen th .tp-sort', { hasText: 'Status' }));
                    await page.locator('.tp-zen th .tp-sort', { hasText: '▲' }).waitFor();
                },
            },
            {
                caption: '… and move them by their titles',
                act: async (page) => {
                    const from = await spot(page.locator('.tp-zen th[title="Priority"] .tp-sort'));
                    const to = await spot(page.locator('.tp-zen th[title="Modified"]'));
                    const box = await page.locator('.tp-zen th[title="Modified"]').boundingBox();
                    if (!from || !to || !box) throw new Error('column titles not shown');
                    const drop = { x: box.x + 6, y: to.y };
                    await page.mouse.move(from.x, from.y);
                    await page.mouse.down();
                    await page.mouse.move(drop.x, drop.y, { steps: 12 });
                    await page.mouse.up();
                    clicked = drop;
                    await page.locator('.tp-zen th:nth-child(2)[title="Priority"]').waitFor();
                },
            },
            {
                caption: 'Edit properties in place …',
                act: async (page) => {
                    await tap(page, page.locator('.tp-zen .tp-zen-btn[title^="Edit"]'));
                    await page.locator('.tp-zen select.tp-zen-input').first().waitFor();
                },
            },
            {
                caption: '… choices from a list …',
                act: async (page) => {
                    const row = page.locator('.tp-zen tr.tp-zen-row', { hasText: 'prices.csv' });
                    const select = row.locator('select.tp-zen-input').first();
                    const now = await select.inputValue();
                    await tap(page, select);
                    await select.selectOption(now === 'Approved' ? 'In review' : 'Approved');
                },
            },
            {
                caption: '… dates, numbers, names …',
                act: async (page) => {
                    const row = page.locator('.tp-zen tr.tp-zen-row', { hasText: 'prices.csv' });
                    const priority = row.locator('.tp-zen-text[contenteditable]').nth(1); // after the name
                    await tap(page, priority);
                    await page.keyboard.press('ControlOrMeta+a');
                    await page.keyboard.type('1');
                    await page.keyboard.press('Enter');
                },
            },
            {
                caption: '… save: kept in the view …',
                act: async (page) => {
                    await tap(page, page.locator('.tp-zen .tp-zen-btn[title^="Save"]'));
                    await page.locator('.tp-zen .tp-zen-note', { hasText: 'saved in the view' }).waitFor();
                },
            },
            {
                caption: "… upload: applied as with Sharepoint's own form",
                act: async (page) => {
                    await tap(page, page.locator('.tp-zen .tp-zen-btn[title^="Upload"]'));
                    await page.locator('.tp-zen .tp-zen-note', { hasText: 'uploaded' }).waitFor();
                },
            },
            {
                caption: '… in dark mode, too',
                act: async (page, v) => {
                    await tap(page, page.locator('.tp-zen .tp-zen-btn[title^="Edit"]')); // edit mode off
                    await tap(page, page.locator('.tp-zen td.tp-zen-name', { hasText: 'prices.csv' })); // into the viewer
                    await v.locator('.tp-title-name', { hasText: 'prices.csv' }).waitFor();
                    await tap(page, v.locator('.tp-mode-btn[title="More"]'));
                    await tap(page, v.locator('.tp-menu-item', { hasText: 'Dark mode' }));
                    await page.locator('.tp-zen.tp-dark').waitFor();
                },
            },
        ],
    },
    {
        folder: '/Data',
        settings: POPUP,
        beats: [
            {
                caption: 'File properties',
                act: async (page, v) => {
                    await h.preview(page, 'prices.csv');
                    await view(v, 'Table');
                    await tap(page, v.locator('.tp-mode-btn[title^="Display file metadata"]'));
                },
            },
            {
                caption: 'Copy the link …',
                act: async (page, v) => {
                    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
                    await tap(page, v.locator('.tp-mode-btn[title^="Copy the link"]'));
                },
            },
            { caption: '… paste it: clean, no prefix, no query, no %20', act: async (page) => paste(page) },
            {
                caption: 'Dark mode',
                act: async (page, v) => {
                    await tap(page, v.locator('.tp-mode-btn[title="More"]'));
                    await tap(page, v.locator('.tp-menu-item', { hasText: 'Dark mode' }));
                },
            },
        ],
    },
];

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

/** @returns spot the pointer goes to on an element: low right of its middle (the element stays visible) */
async function spot(target: Locator): Promise<Spot | null> {
    const b = await target.boundingBox();
    return b && { x: b.x + b.width * 0.75, y: b.y + b.height * 0.75 };
}

/** Moves the mouse onto an element or a spot (hover look) and draws the pointer there; none: mouse away */
async function point(page: Page, target?: Locator | Spot | null): Promise<void> {
    const at = target && 'boundingBox' in target ? await spot(target) : target;
    if (!at) return void (await page.mouse.move(0, 0)); // no hover effects
    const { x, y } = at;
    await page.mouse.move(x, y);
    await page.evaluate(
        ({ svg, x, y }) => {
            const el = document.createElement('div');
            el.innerHTML = svg;
            el.dataset.demo = 'pointer';
            el.style.cssText = `position: fixed; left: ${x - 1}px; top: ${y - 1}px; z-index: 2147483647; pointer-events: none;`;
            document.body.append(el);
        },
        { svg: POINTER_SVG, x, y },
    );
}

/** Clicks an element where the pointer is drawn (and keeps the spot for the frame) */
async function tap(page: Page, target: Locator): Promise<void> {
    const at = await spot(target);
    if (!at) throw new Error('element not shown');
    await page.mouse.click(at.x, at.y);
    clicked = at;
}

/** Removes what was laid over the page (pointer, caption, paste box) */
async function clear(page: Page): Promise<void> {
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('[data-demo]')) el.remove();
    });
}

/** Draws a caption into the page (hero) */
async function label(page: Page, text: string): Promise<void> {
    await page.evaluate(
        ({ text, css }) => {
            const el = document.createElement('div');
            el.dataset.demo = 'caption';
            el.textContent = text;
            el.style.cssText = css;
            document.body.append(el);
        },
        { text, css: CAPTION_CSS },
    );
}

/** Switches to the 3D view and waits until the model is drawn */
async function open3d(page: Page, v: Locator): Promise<void> {
    await view(v, '3D');
    await v.getByText(STATUS_3D).waitFor({ timeout: 30000 });
    await page.waitForTimeout(WAIT_3D);
}

/** Clicks a point of the 3D canvas (fractions) and waits until an object is selected */
async function select3d(page: Page, v: Locator, [fx, fy]: [number, number]): Promise<void> {
    const b = await box(v.locator('canvas'));
    clicked = { x: b.x + b.width * fx, y: b.y + b.height * fy };
    await page.mouse.click(clicked.x, clicked.y);
    await v.locator('.tp-3d-label', { hasNotText: 'Nothing selected' }).waitFor();
    console.log(`selected: ${await v.locator('.tp-3d-label').textContent()}`);
}

/** Pastes the clipboard (keyboard, as a user does) into a box laid over the page, Sharepoint's form of the link above */
async function paste(page: Page): Promise<void> {
    await page.evaluate(
        ({ css, link }) => {
            const el = document.createElement('div');
            el.dataset.demo = 'paste';
            el.style.cssText = css;
            el.innerHTML =
                '<div style="color: #605e5c">Sharepoint\'s "Copy link":</div>' +
                '<div style="font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; color: #a4262c; word-break: break-all"></div>' +
                '<div style="margin-top: 10px; color: #605e5c">Link of the previewer, pasted:</div>' +
                '<textarea data-paste rows="1" style="width: 100%; box-sizing: border-box; resize: none; border: 1px solid #0078d4; border-radius: 4px; padding: 4px 6px;' +
                ' font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; color: #107c10; background: #fff"></textarea>';
            (el.children[1] as HTMLElement).textContent = link;
            document.body.append(el);
        },
        { css: PASTE_CSS, link: LINK_SHAREPOINT },
    );
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith('http')); // copied
    const box = page.locator('textarea[data-paste]');
    await box.focus();
    await page.keyboard.press('ControlOrMeta+V');
    const pasted = await box.inputValue();
    if (!pasted) throw new Error('nothing pasted');
    console.log(`link pasted: ${pasted}`);
}

/** Write mode on, a line added at the end of the text (not saved) */
async function editText(page: Page, v: Locator): Promise<void> {
    await v.locator('.tp-mode-btn[title^="Edit"]').click();
    const editor = v.locator('.tp-editor');
    await editor.press('Control+End');
    await page.keyboard.type('\n- (edited) agreed: next meeting on Friday');
}

/** Opens a file and caches all of it (button "Cache the whole file"), until fully cached. */
/** Zen mode from the ⋯ menu of the viewer open; waits for the list */
async function zen(page: Page): Promise<void> {
    const v = page.locator('.tp-viewer');
    await v.locator('.tp-mode-btn[title="More"]').click();
    await v.locator('.tp-menu-item', { hasText: 'Zen mode' }).click();
    await page.locator('.tp-zen .tp-zen-row').first().waitFor();
    await page.mouse.move(0, 0); // no hover marks
}

async function cacheAll(page: Page, name: string): Promise<void> {
    const v = page.locator('.tp-viewer');
    await h.eye(page, name).click();
    await v.locator('.tp-title-name', { hasText: name }).waitFor();
    await v.locator('.tp-progress.tp-idle, .tp-progress.tp-full').waitFor();
    const all = v.locator('.tp-mode-btn[title^="Cache the whole file"]');
    if (await all.isEnabled()) await all.click();
    await v.locator('.tp-progress.tp-full').waitFor();
}

/** Opens the settings form from the viewer (empty: header eye), ⋯ → Full settings … */
async function openSettings(page: Page): Promise<void> {
    await page.locator('.tp-head').dispatchEvent('click'); // header eye (mock: overlaid)
    const v = page.locator('.tp-viewer');
    await v.locator('.tp-mode-btn[title="More"]').click();
    await v.locator('.tp-menu-item', { hasText: 'Full settings' }).click();
    await page.locator('.tp-settings form').waitFor();
}

/** Switches the viewer to a view (Text, Table, Markdown, 3D, ...) unless already on it. */
async function view(v: Locator, name: string): Promise<void> {
    const btn = v.locator('.tp-view-btn', { hasText: name });
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
}

// Entry of the sheet picker (sheets / tables, or parts / queries of an archive): list, then item
async function pick(v: Locator, list: string, item: string): Promise<void> {
    await v.locator(SHEET_PICKER).click();
    await choose(v, list, item);
}

// Entry of the sheet picker open: list, then item
async function choose(v: Locator, list: string, item: string): Promise<void> {
    const menu = v.locator('.tp-picker-menu').first();
    await menu.locator('.tp-picker-tab', { hasText: list }).click();
    await menu.locator('.tp-picker-item', { hasText: item }).first().click();
    await v.locator('.tp-title-sheet', { hasText: item }).waitFor();
}

type Browser = Awaited<ReturnType<typeof h.launch>>;

/** Screenshot of a case (its part of the page) */
async function capture(browser: Browser, c: Case, out: string): Promise<void> {
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
    await page.screenshot({ path: out, clip: await c.clip?.(page, v) });
    await page.context().close();
    console.log(`wrote ${out}`);
}

/** Hero animation: the beats of the stories as frames into /sandbox/hero, then joined (ffmpeg; without it the frames stay) */
async function hero(browser: Browser): Promise<void> {
    fs.rmSync(PATH_FRAMES, { recursive: true, force: true });
    fs.mkdirSync(PATH_FRAMES, { recursive: true });
    let n = 0;
    for (const story of HERO) {
        const reason = story.skip?.();
        if (reason) {
            console.log(`skipped hero story ${story.folder || '/'}: ${reason}`);
            continue;
        }
        const { page } = await browser.open(h.folderUrl(`${h.LIBRARY}${story.folder}`), {
            settings: story.settings ?? {},
        });
        await page.locator('.tp-preview').first().waitFor();
        const v = page.locator('.tp-viewer');
        for (const beat of story.beats) {
            await clear(page);
            clicked = null;
            await beat.act?.(page, v);
            await point(page, beat.pointer?.(page, v) ?? clicked);
            await label(page, beat.caption);
            const out = path.join(PATH_FRAMES, `${String(n++).padStart(2, '0')}.png`);
            await page.screenshot({ path: out });
            console.log(`wrote ${out}: ${beat.caption}`);
        }
        await page.context().close();
    }
    if (encoder()) encode();
    else console.log(`no ffmpeg with libwebp: frames kept in ${PATH_FRAMES} (join them with \`node scripts/hero.ts\`)`);
}

async function main() {
    const names = process.argv.slice(2).filter(Boolean);
    const unknown = names.filter((name) => !(name in CASES) && name !== 'hero');
    if (unknown.length)
        throw new Error(`unknown case(s): ${unknown.join(', ')}; known: ${Object.keys(CASES).join(', ')}, hero`);
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
                await capture(browser, c, path.join(PATH_IMG, `${name}.png`));
            } catch (err) {
                failed++;
                console.error(`failed ${name}: ${err instanceof Error ? err.message : err}`);
            }
        }
        if (!names.length || names.includes('hero')) {
            try {
                await hero(browser);
            } catch (err) {
                failed++;
                console.error(`failed hero: ${err instanceof Error ? err.message : err}`);
            }
        }
    } finally {
        await browser.close();
    }
    process.exitCode = failed ? 1 : 0;
}

await main();
