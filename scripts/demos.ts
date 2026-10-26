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

// settings for the 3D view (as `just tests-explore` fills them in): release folder of the mock Sharepoint
const SETTINGS_3D = { 'viewer-3d-folder': RELEASE_SETTING };

// Demo case: folder (relative to the library), file to preview (optional), steps after opening
type Case = {
    folder: string;
    file?: string;
    settings?: Record<string, unknown>;
    skip?: () => string;
    steps?: (page: Page, viewer: Locator) => Promise<void>;
};

const CASES: Record<string, Case> = {
    list: { folder: '' },
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
    csv: {
        folder: '/Data',
        file: 'prices.csv',
        steps: async (_page, v) => {
            await view(v, 'Table');
            await v.locator('.tp-table').waitFor();
        },
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

/** Switches the viewer to a view (Text, Table, Markdown, 3D, ...) unless already on it. */
async function view(v: Locator, name: string): Promise<void> {
    const btn = v.locator('.tp-view-btn', { hasText: name });
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
}

async function capture(browser: Awaited<ReturnType<typeof h.launch>>, name: string, c: Case): Promise<void> {
    const { page } = await browser.open(h.folderUrl(`${h.LIBRARY}${c.folder}`), { settings: c.settings ?? {} });
    await page.locator('.tp-preview').first().waitFor();
    if (c.file) {
        const v = await h.preview(page, c.file);
        await c.steps?.(page, v);
    }
    await page.mouse.move(0, 0); // no hover effects
    const out = path.join(PATH_IMG, `${name}.png`);
    await page.screenshot({ path: out });
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
