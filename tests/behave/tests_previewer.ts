// Behavioural tests (preliminary): userscript on the mock SharePoint (cf. /tests/mocks/mock-sharepoint/server.ts)

import assert from 'node:assert/strict';
import { after } from 'node:test';
import { before } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import type { Locator } from 'playwright';
import type { Page } from 'playwright';
import * as h from './harness.ts';

let browser: Awaited<ReturnType<typeof h.launch>>;
before(async () => {
    browser = await h.launch();
});
after(() => browser.close());

/** @returns list view, once eyes are in */
async function openFolder(folder: string, settings: Record<string, unknown> = {}): Promise<Page> {
    const { page } = await browser.open(h.folderUrl(folder), { settings });
    await page.locator('.tp-preview').first().waitFor();
    return page;
}

// Pickers in the status bar: format (left of the text size), sheet or table (right of Table)
const SHEET_PICKER = '.tp-views:not(.tp-format) > .tp-picker';
const FORMAT_PICKER = '.tp-format > .tp-picker';

/** @returns "Properties: …" line */
const properties = (v: Locator): Promise<string> => h.text(v.locator('.tp-title').nth(1));

/** @returns link the chain icon copies (its tooltip, once hovered) */
async function link(v: Locator): Promise<string> {
    const btn = v.locator('.tp-mode-btn[title^="Copy the link"]');
    await btn.hover();
    return ((await btn.getAttribute('title')) ?? '').split('\n').pop() ?? '';
}

describe('list view', () => {
    it('shows an eye on files and folders', async () => {
        const page = await openFolder(h.LIBRARY);
        assert.equal(await h.eye(page, 'notes.txt').count(), 1);
        assert.equal(await h.eye(page, 'README.md').count(), 1);
        assert.equal(await h.eye(page, 'Data').getAttribute('data-kind'), 'folder');
        assert.equal(await page.locator('.tp-head').count(), 1);
    });

    it('folder eye: viewer without file for that folder; again: closed', async () => {
        const page = await openFolder(h.LIBRARY);
        await h.eye(page, 'Data').click();
        const v = page.locator('.tp-viewer');
        await v.waitFor();
        assert.equal(await h.text(v.locator('.tp-title-name')), '–');
        assert.equal(await link(v), `${h.ORIGIN}${h.LIBRARY}/Data`);
        await h.eye(page, 'Data').click();
        assert.equal(await v.count(), 0);
    });

    it('link: clean URL of the file shown, else of the folder open', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        await page.locator('.tp-head').dispatchEvent('click'); // header eye (mock: overlaid)
        const v = page.locator('.tp-viewer');
        assert.equal(await link(v), `${h.ORIGIN}${h.LIBRARY}/Data`); // not encoded, no query
        await h.preview(page, 'prices.csv');
        assert.equal(await link(v), `${h.ORIGIN}${h.LIBRARY}/Data/prices.csv`);
    });

    it('follows in-place navigation into nested folders (recycled rows)', async () => {
        const page = await openFolder(h.LIBRARY);
        await page.locator('a', { hasText: 'Data' }).click();
        await h.eye(page, 'prices.csv').waitFor();
        await page.locator('a', { hasText: 'Reports' }).click();
        await h.eye(page, '2025.csv').waitFor();
        assert.equal(await page.locator('.tp-preview').count(), 1);
    });

    it('goes back to parent folders by the breadcrumb', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data/Reports`);
        await h.eye(page, '2025.csv').waitFor();
        await page.locator('#breadcrumb a', { hasText: 'Data' }).click();
        await h.eye(page, 'prices.csv').waitFor();
        await page.locator('#breadcrumb a', { hasText: 'Shared Documents' }).click();
        await h.eye(page, 'notes.txt').waitFor();
    });

    it('adds nothing outside a library', async () => {
        const { page } = await browser.open(`${h.SITE}/SitePages/Home.aspx`);
        await page.waitForTimeout(300);
        assert.equal(await page.locator('.tp-cell, .tp-head').count(), 0);
    });
});

describe('preview per file type', () => {
    const cases: [string, string, RegExp, string][] = [
        ['', 'notes.txt', /format: Text/, 'Meeting notes'],
        ['', 'README.md', /format: Markdown/, 'Project documents'],
        ['/Data', 'prices.csv', /format: CSV/, 'banana, ripe'],
        ['/Data', 'people.parquet', /Parquet/, 'Grace'],
        ['/Data', 'sensors.parquet', /Parquet/, 's2'],
        ['/Config', 'settings.xml', /format: XML/, 'retries'],
        ['/Models', 'wall.ifc', /format: IFC/, 'IFCWALL'],
        ['/Models', 'corner.ifc', /format: IFC/, 'IFCWINDOW'],
        ['/Data', 'harvest.xlsx', /format: Excel \(XLSX\)/, 'banana'],
        ['/Data', 'harvest.xlsb', /format: Excel \(XLSB\)/, 'banana'],
        ['/Data', 'harvest.xls', /format: Excel 97–2003/, 'banana'],
        ['/Data', 'harvest.ods', /format: OpenDocument/, 'banana'],
    ];
    for (const [folder, name, format, text] of cases) {
        it(`${name}: content and properties`, async () => {
            const page = await openFolder(h.LIBRARY + folder);
            const v = await h.preview(page, name);
            assert.match(await properties(v), format);
            // table rows are drawn a frame after the viewer settles (blocks fill as they come into view)
            await v.locator('.tp-content', { hasText: new RegExp(text) }).waitFor({ timeout: 5000 });
            // small file: fully cached; workbooks only up to the sheet shown (ODS: all sheets in one part)
            const sheetWise = /\.(xlsx|xlsb|xls)$/.test(name);
            assert.equal(await h.eye(page, name).getAttribute('data-eye'), sheetWise ? 'half' : 'open');
        });
    }

    it('checks XML and IFC: ok vs problems', async () => {
        for (const [folder, good, bad] of [
            ['/Config', 'settings.xml', 'broken.xml'],
            ['/Models', 'wall.ifc', 'broken.ifc'],
        ]) {
            const page = await openFolder(h.LIBRARY + folder);
            const summary = (await h.preview(page, good)).locator('.tp-lint-summary');
            await summary.filter({ hasText: 'no problems' }).waitFor();
            await h.preview(page, bad);
            await page.locator('.tp-lint.tp-lint-bad').waitFor();
        }
    });

    it('CSV and Parquet offer the table view', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        for (const name of ['prices.csv', 'people.parquet']) {
            const v = await h.preview(page, name);
            const table = v.locator('.tp-view-btn', { hasText: 'Table' });
            assert.equal(await table.isDisabled(), false);
        }
    });

    it('logs: text first, table (experimental) with guessed fields; none for logs without fields', async () => {
        const page = await openFolder(`${h.LIBRARY}/Logs`);
        const v = await h.preview(page, 'app.log');
        const table = v.locator('.tp-view-btn', { hasText: 'Table' });
        assert.match(String(await table.getAttribute('title')), /experimental/);
        assert.equal(await v.locator('.tp-table').count(), 0);
        await table.click();
        await v.locator('.tp-table').waitFor();
        const colours = v.locator('.tp-menu-item', { hasText: 'Syntax colours' });
        assert.equal(await colours.getAttribute('aria-pressed'), 'true'); // log table: colours on by default
        assert.deepEqual(await v.locator('.tp-table th[data-c] .tp-sort').allTextContents(), [
            'line',
            'time',
            'context',
            'level',
            'name',
            'message',
        ]);
        assert.match(await properties(v), /11 entries × 6 columns/);
        const expand = v.locator('.tp-table .tp-expand');
        await expand.first().waitFor(); // rows are filled in once in view
        assert.equal(await expand.count(), 3); // stack trace, JSON, Python dict (with printed JSON after it)
        await v.locator('.tp-table tr', { hasText: 'request' }).locator('.tp-expand').click();
        const detail = v.locator('.tp-table .tp-detail');
        await detail.waitFor();
        assert.deepEqual(await detail.locator('.tp-seg-label').allTextContents(), ['JSON object']);
        assert.match(await h.text(detail), /"status": 201/);
        await v.locator('.tp-table tr', { hasText: 'request' }).locator('.tp-expand').click();
        assert.equal(await detail.count(), 0);
        const all = v.locator('.tp-table .tp-expand-all');
        await all.click(); // table built anew: wait for its rows
        await detail.nth(2).waitFor();
        assert.equal(await detail.count(), 3);
        await all.click();
        await detail.first().waitFor({ state: 'detached' });
        assert.equal(await detail.count(), 0);
        const plain = await h.preview(page, 'plain.log');
        assert.equal(await plain.locator('.tp-view-btn', { hasText: 'Table' }).isDisabled(), true);
        assert.equal(await plain.locator('.tp-table').count(), 0);
    });

    it('spreadsheets: sheet picker, read only, sheets cached one by one', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        const v = await h.preview(page, 'harvest.xlsx');
        const picker = v.locator(SHEET_PICKER);
        const items = v.locator('.tp-picker-menu').first().locator('.tp-picker-item');
        assert.equal(await picker.isVisible(), true);
        await picker.click();
        assert.deepEqual(await items.allTextContents(), ['● Prices', '○ Notes', '○ Secret (hidden)']);
        assert.match(await h.text(v.locator('.tp-title-sheet')), /Sheet: Prices/);
        assert.equal(await v.locator('.tp-mode-btn[title^="Edit"]').isDisabled(), true);
        assert.equal(await h.eye(page, 'harvest.xlsx').getAttribute('data-eye'), 'half'); // other sheets not cached

        await items.filter({ hasText: 'Notes' }).click();
        await v.locator('.tp-title-sheet', { hasText: 'Notes' }).waitFor();
        await h.settled(page);
        await v.locator('.tp-content', { hasText: 'after a gap' }).waitFor({ timeout: 5000 });
        assert.match(await properties(v), /sheet: Notes/);

        await v.locator('.tp-load-more').click(); // last sheet: whole file cached
        await h.settled(page);
        assert.equal(await h.eye(page, 'harvest.xlsx').getAttribute('data-eye'), 'open');
    });

    it('spreadsheets: sheets and tables in one picker (← →), the choice remembered per file', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`, { 'spreadsheet-view': 'sheets' });
        let v = await h.preview(page, 'orders.xlsx');
        const picker = v.locator(SHEET_PICKER);
        const menu = v.locator('.tp-picker-menu').first(); // sheet picker's menu (format picker's second)
        assert.match(await properties(v), /sheets: 6 · tables: 10 · sheet: Sales/); // setting: sheets first
        await picker.click();
        await page.keyboard.press('ArrowRight');
        await menu.locator('.tp-picker-tab[aria-pressed="true"]', { hasText: 'Tables' }).waitFor();
        assert.deepEqual((await menu.locator('.tp-picker-item').allTextContents()).slice(0, 4), [
            '● Orders (Sales)',
            '● Regions (Sales)',
            '● Payments (Sales)',
            '○ Stock (Stock)',
        ]);
        await page.keyboard.press('Enter'); // first table on the sheet shown
        await v.locator('.tp-title-sheet', { hasText: 'Table: Orders' }).waitFor();
        assert.match(await properties(v), /table: Orders \(Sales!A1:D14\): 12 rows × 4 columns/);

        await h.preview(page, 'harvest.xlsx');
        await picker.click();
        await menu.locator('.tp-picker-tab', { hasText: 'Tables' }).click();
        await menu.locator('.tp-picker-empty', { hasText: 'No tables' }).waitFor(); // always there, says why
        await page.keyboard.press('Escape');
        assert.equal(await menu.isVisible(), false);
        assert.equal(await v.isVisible(), true); // Esc closed the menu, not the viewer

        await page.reload();
        await page.locator('.tp-preview').first().waitFor();
        v = await h.preview(page, 'orders.xlsx');
        assert.match(await h.text(v.locator('.tp-title-sheet')), /Table: Orders/);
    });

    it('spreadsheets: tables first by default, sheets if a file has no tables', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        let v = await h.preview(page, 'orders.xlsx');
        await v.locator('.tp-title-sheet', { hasText: 'Table: Orders' }).waitFor();
        assert.match(await properties(v), /table: Orders \(Sales!A1:D14\)/);
        v = await h.preview(page, 'harvest.xlsx'); // no tables
        await h.settled(page);
        assert.doesNotMatch(await properties(v), /table: /);
        assert.match(await properties(v), /sheet: /);
    });

    it('spreadsheets: text view with column letters and row numbers', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        const v = await h.preview(page, 'harvest.xlsx');
        await v.locator('.tp-view-btn', { hasText: 'Text' }).click();
        await v.locator('.tp-content', { hasText: ',A,B,C,D' }).waitFor({ timeout: 5000 });
        assert.match(await h.text(v.locator('.tp-content')), /1,fruit,price,harvest,ripe/);
    });

    it('spreadsheets: rows striped, column colours off by default', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        const v = await h.preview(page, 'harvest.xls');
        await v.locator('.tp-view-btn', { hasText: 'Table' }).click();
        await v.locator('.tp-table').waitFor();
        assert.ok((await v.locator('.tp-table tr.tp-stripe').count()) > 0);
        assert.equal(await v.locator('.tp-table td[class^="tp-"]:not(.tp-rn)').count(), 0);
        assert.deepEqual(await v.locator('.tp-table thead .tp-sort').allTextContents(), ['A', 'B', 'C', 'D']);
    });

    it('spreadsheets: large files wait until a sheet or table is chosen', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`, { 'spreadsheet-autoload-bytes': 1024 });
        const v = await h.preview(page, 'harvest.xlsx'); // 6 KB
        await v.locator('.tp-content', { hasText: 'select a sheet or table first' }).waitFor();
        const picker = v.locator(SHEET_PICKER);
        assert.equal(await h.text(picker), 'Select sheet or table ▾');
        assert.equal(await v.locator('.tp-title-sheet').isVisible(), false);
        await picker.click();
        const items = v.locator('.tp-picker-menu').first().locator('.tp-picker-item');
        assert.deepEqual(await items.allTextContents(), ['○ Prices', '○ Notes', '○ Secret (hidden)']);
        await items.filter({ hasText: 'Prices' }).click();
        await v.locator('.tp-title-sheet', { hasText: 'Sheet: Prices' }).waitFor();
        await v.locator('.tp-content', { hasText: 'banana' }).waitFor({ timeout: 5000 });
    });

    it('format: recognised one bottom right before the text size; any format can be chosen', async () => {
        const page = await openFolder(h.LIBRARY);
        const v = await h.preview(page, 'notes.txt');
        const known = ['tp-progress', 'tp-views', 'tp-format', 'tp-zoom'];
        const bar = await v
            .locator('.tp-statusbar > div:not(.tp-picker-menu)')
            .evaluateAll((els, k) => els.map((el) => [...el.classList].filter((c) => k.includes(c)).join(' ')), known);
        assert.deepEqual(bar, ['tp-progress', 'tp-views tp-format', 'tp-views tp-zoom', 'tp-views']);
        const picker = v.locator(FORMAT_PICKER);
        const menu = v.locator('.tp-picker-menu').last();
        assert.equal(await h.text(picker), 'Text ▾');
        const choose = async (list: 'Text' | 'Files', name: string) => {
            await picker.click();
            await menu.locator('.tp-picker-tab', { hasText: list }).click();
            await menu.locator('.tp-picker-item', { hasText: name }).first().click();
            await h.settled(page);
        };

        await choose('Text', 'CSV'); // wrong format: read as CSV all the same
        await v.locator(`${FORMAT_PICKER}.tp-chosen`, { hasText: 'CSV' }).waitFor();
        assert.match(await properties(v), /format: CSV/);
        assert.equal(await v.locator('.tp-view-btn', { hasText: 'Table' }).isDisabled(), false);

        await choose('Files', 'Spreadsheet'); // other reader: says why it cannot
        await v.locator('.tp-content', { hasText: 'not a spreadsheet file' }).waitFor();
        assert.equal(await picker.isVisible(), true); // can be changed back

        await choose('Text', 'Text (recognised)');
        await v.locator(`${FORMAT_PICKER}:not(.tp-chosen)`, { hasText: 'Text' }).waitFor();
        await v.locator('.tp-content', { hasText: 'Meeting notes' }).waitFor();
    });

    it('Markdown: rendered, Text shows the source; text size − 100 % +; Ctrl+A selects the text only', async () => {
        const page = await openFolder(h.LIBRARY);
        const v = await h.preview(page, 'README.md');
        const preview = v.locator('.tp-view-btn', { hasText: 'Markdown' });
        if ((await preview.getAttribute('aria-pressed')) !== 'true') await preview.click();
        await v.locator('.tp-md h1', { hasText: 'Project documents' }).waitFor();
        assert.equal(await v.locator('.tp-md li').count(), 3);
        await v.locator('.tp-view-btn', { hasText: 'Text' }).click();
        await v.locator('.tp-code', { hasText: '# Project documents #' }).waitFor();

        const size = () => v.locator('.tp-content').evaluate((el) => getComputedStyle(el).fontSize);
        const start = await size();
        await v.locator('.tp-zoom .tp-view-btn').last().click(); // +
        assert.notEqual(await size(), start);
        await v.locator('.tp-zoom-value').click(); // back to 100 %
        assert.equal(await size(), start);

        await v.locator('.tp-content').click();
        await page.keyboard.press('ControlOrMeta+A');
        const selected = await page.evaluate(() => String(getSelection()));
        assert.match(selected, /Project documents[\s\S]*answer = 42/);
        assert.doesNotMatch(selected, /Shared Documents/); // not the page around it
        await preview.click(); // Markdown view stays the remembered choice
    });

    it('refuses binary files', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        const v = await h.preview(page, 'logo.png');
        assert.match(await h.text(v.locator('.tp-content')), /Not a plain text file/);
    });

    it('fetches by byte range and only from SharePoint itself', async () => {
        const { page, requests } = await browser.open(h.LIST_PAGE);
        await page.locator('.tp-preview').first().waitFor();
        await h.preview(page, 'notes.txt');
        const file = requests.filter((r) => r.url.endsWith('/notes.txt'));
        assert.ok(file.length && file.every((r) => r.range?.startsWith('bytes=')));
        assert.deepEqual(
            requests.filter((r) => !r.url.startsWith(h.ORIGIN)),
            [],
        );
    });
});

describe('editing', () => {
    /** @returns dialogues so far (the stand-in records them; confirm answers "yes") */
    const dialogues = (page: Page): Promise<{ alerts: string[]; confirms: string[] }> =>
        page.evaluate(() => {
            const { alerts, confirms } = (window as unknown as { __gm: { alerts: string[]; confirms: string[] } }).__gm;
            return { alerts: [...alerts], confirms: [...confirms] };
        });
    /** Write mode on (file shown) */
    async function edit(v: Locator): Promise<void> {
        await v.locator('.tp-mode-btn[title^="Edit"]').click();
        await v.locator('.tp-editor').waitFor();
    }

    it('Esc: only back to reading (saved changes stay, asks for unsaved ones); Esc again: closed', async () => {
        const page = await openFolder(h.LIBRARY);
        const v = await h.preview(page, 'notes.txt');
        await edit(v);
        await page.keyboard.press('Escape');
        assert.equal(await v.locator('.tp-editor').isVisible(), false); // read view again
        assert.equal(await v.isVisible(), true); // the viewer stays
        assert.deepEqual((await dialogues(page)).confirms, []);

        await edit(v);
        await v.locator('.tp-editor').press('End');
        await page.keyboard.type(' (saved)');
        await v.locator('.tp-mode-btn[title^="Save"]').click();
        await v.locator('.tp-editor').press('End');
        await page.keyboard.type(' (unsaved)');
        await page.keyboard.press('Escape');
        assert.match((await dialogues(page)).confirms.join('\n'), /unsaved changes/);
        assert.equal(await v.locator('.tp-editor').isVisible(), false);
        assert.equal(await v.isVisible(), true);
        await v.locator('.tp-content', { hasText: '(saved)' }).waitFor(); // saved changes kept
        assert.doesNotMatch(await h.text(v.locator('.tp-content')), /\(unsaved\)/);

        await page.keyboard.press('Escape'); // close: asks (not uploaded)
        assert.match((await dialogues(page)).confirms.join('\n'), /not been uploaded/);
        assert.equal(await v.count(), 0);
    });

    it('name: click in write mode, checked, marked as a new file; Esc in the box keeps the old one', async () => {
        const page = await openFolder(h.LIBRARY);
        const v = await h.preview(page, 'notes.txt');
        await edit(v);
        const name = v.locator('.tp-title-name');
        const box = v.locator('.tp-name-input');
        await name.click();
        await box.fill('a:b.txt');
        await box.press('Enter');
        assert.match((await dialogues(page)).alerts.join('\n'), /may not contain/);
        await box.fill('README.md'); // there already: asks
        await box.press('Enter');
        await name.filter({ hasText: 'README.md' }).waitFor(); // after the look-up
        assert.match((await dialogues(page)).confirms.join('\n'), /"README\.md" already exists/);
        assert.match((await name.getAttribute('class')) ?? '', /tp-new-name/);
        assert.equal(await v.locator('.tp-mode-btn[title^="Save"]').isDisabled(), false); // saved with the text

        await name.click();
        await box.fill('other.txt');
        await box.press('Escape'); // box only: still in write mode
        assert.equal(await h.text(name), 'README.md');
        assert.equal(await v.locator('.tp-editor').isVisible(), true);
    });

    it('new file: plain text only; shown as its format (colours, checks), empty may be uploaded', async () => {
        const page = await openFolder(h.LIBRARY);
        // header eye (mock: overlaid, not hit-testable by Playwright)
        await page.locator('.tp-head').dispatchEvent('click');
        const v = page.locator('.tp-viewer');
        await page.evaluate(() => {
            (window as unknown as { __gm: { answers: string[] } }).__gm.answers.push(
                'a:b.md',
                'data.xlsx',
                'todo.json',
            );
        });
        await v.locator('.tp-new-file').click();
        await v.locator('.tp-editor').waitFor();
        assert.equal(await h.text(v.locator('.tp-title-name')), 'todo.json');
        const { alerts } = await dialogues(page);
        assert.match(alerts.join('\n'), /may not contain/);
        assert.match(alerts.join('\n'), /\.xlsx file is not plain text/);
        assert.equal(await v.locator('.tp-new-file').isVisible(), false);
        assert.equal(await v.locator('.tp-mode-btn[title^="Upload"]').isDisabled(), false); // empty: ready
        assert.match(await h.text(v.locator(FORMAT_PICKER)), /JSON/);

        await v.locator('.tp-editor').fill('{"a": 1}');
        await v.locator('.tp-mode-btn[title^="Save"]').click();
        await v.locator('.tp-mode-btn[title^="Edit"]').click(); // read view: as any JSON file
        await v.locator('.tp-lint-summary', { hasText: 'no problems' }).waitFor();
        await v.locator('.tp-content', { hasText: '"a": 1' }).waitFor(); // lines are drawn a frame later

        await page.keyboard.press('Escape'); // close: asks (not uploaded)
        assert.match((await dialogues(page)).confirms.join('\n'), /not been uploaded/);
        assert.equal(await v.count(), 0);
    });

    it('name: read-only files (spreadsheets) can be renamed (a copy) without edit mode; text files only in it', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        let v = await h.preview(page, 'orders.xlsx');
        assert.match((await v.locator('.tp-title-name').getAttribute('class')) ?? '', /tp-renamable/);
        v = await h.preview(page, 'prices.csv');
        assert.doesNotMatch((await v.locator('.tp-title-name').getAttribute('class')) ?? '', /tp-renamable/);
    });

    it('upload (simulated): new file into the folder, then shown from SharePoint', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        await page.locator('.tp-head').dispatchEvent('click');
        const v = page.locator('.tp-viewer');
        await page.evaluate(() => {
            (window as unknown as { __gm: { answers: string[] } }).__gm.answers.push('todo.json');
        });
        await v.locator('.tp-new-file').click();
        await v.locator('.tp-editor').fill('{"a": 1}');
        await v.locator('.tp-mode-btn[title^="Save"]').click();
        await v.locator('.tp-mode-btn[title^="Upload"]').click();
        await h.row(page, 'todo.json').waitFor({ timeout: 10000 }); // the list shows it
        await v.locator('.tp-title-name:not(.tp-new-name)', { hasText: 'todo.json' }).waitFor({ timeout: 10000 });
        await v.locator('.tp-content', { hasText: '"a": 1' }).waitFor(); // fetched from SharePoint now
        assert.match((await dialogues(page)).confirms.join('\n'), /new file "todo\.json" will be uploaded/);
    });

    it('upload (simulated): text under another name is a new file; the original stays', async () => {
        const page = await openFolder(h.LIBRARY);
        const v = await h.preview(page, 'notes.txt');
        await v.locator('.tp-content', { hasText: 'Meeting notes' }).waitFor(); // lines are drawn a frame later
        const original = await h.text(v.locator('.tp-content'));
        await edit(v);
        await v.locator('.tp-title-name').click();
        await v.locator('.tp-name-input').fill('notes-2.txt');
        await v.locator('.tp-name-input').press('Enter');
        await v.locator('.tp-title-name', { hasText: 'notes-2.txt' }).waitFor();
        await v.locator('.tp-editor').press('End');
        await page.keyboard.type(' (copy)');
        await v.locator('.tp-mode-btn[title^="Save"]').click();
        await v.locator('.tp-mode-btn[title^="Upload"]').click();
        await v.locator('.tp-title-name:not(.tp-new-name)', { hasText: 'notes-2.txt' }).waitFor({ timeout: 10000 });
        await v.locator('.tp-content', { hasText: '(copy)' }).waitFor();
        await h.preview(page, 'notes.txt');
        await v.locator('.tp-content', { hasText: 'Meeting notes' }).waitFor();
        assert.equal(await h.text(v.locator('.tp-content')), original);
    });

    it('upload (simulated): read-only file renamed is uploaded as an unchanged copy', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        const v = await h.preview(page, 'orders.xlsx');
        await v.locator('.tp-title-name').click();
        await v.locator('.tp-name-input').fill('orders-2.xlsx');
        await v.locator('.tp-name-input').press('Enter');
        await h.row(page, 'orders-2.xlsx').waitFor({ timeout: 10000 });
        await v.locator('.tp-title-name', { hasText: 'orders-2.xlsx' }).waitFor({ timeout: 10000 });
        await v.locator('.tp-title-sheet').waitFor(); // read as a spreadsheet again
        const sizes = await page.evaluate(async (folder) => {
            const size = async (n: string) => (await (await fetch(`${folder}/${n}`)).arrayBuffer()).byteLength;
            return [await size('orders.xlsx'), await size('orders-2.xlsx')];
        }, `${h.LIBRARY}/Data`);
        assert.equal(sizes[0], sizes[1]);
    });
});
