// Behavioural tests (preliminary): userscript on the mock SharePoint (cf. /tests/mocks/mock-sharepoint/server.mjs)

import assert from 'node:assert/strict';
import { after } from 'node:test';
import { before } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import * as h from './harness.mjs';

/** @type {Awaited<ReturnType<typeof h.launch>>} */
let browser;
before(async () => {
    browser = await h.launch();
});
after(() => browser.close());

/** @param {string} folder @param {Object<string, *>} [settings] @returns {Promise<import('playwright').Page>} list view, once eyes are in */
async function openFolder(folder, settings = {}) {
    const { page } = await browser.open(h.folderUrl(folder), { settings });
    await page.locator('.tp-preview').first().waitFor();
    return page;
}

/** @param {import('playwright').Locator} v @returns {Promise<string>} "Properties: …" line */
const properties = (v) => v.locator('.tp-title').nth(1).textContent();

describe('list view', () => {
    it('shows an eye on files only, not on folders', async () => {
        const page = await openFolder(h.LIBRARY);
        assert.equal(await h.eye(page, 'notes.txt').count(), 1);
        assert.equal(await h.eye(page, 'README.md').count(), 1);
        assert.equal(await h.row(page, 'Data').locator('.tp-preview').count(), 0);
        assert.equal(await page.locator('.tp-head').count(), 1);
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
    const cases = [
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
        assert.equal(await expand.count(), 3); // stack trace, JSON, Python dict (with printed JSON after it)
        await v.locator('.tp-table tr', { hasText: 'request' }).locator('.tp-expand').click();
        const detail = v.locator('.tp-table .tp-detail');
        await detail.waitFor();
        assert.deepEqual(await detail.locator('.tp-seg-label').allTextContents(), ['JSON object']);
        assert.match(await detail.textContent(), /"status": 201/);
        await v.locator('.tp-table tr', { hasText: 'request' }).locator('.tp-expand').click();
        assert.equal(await detail.count(), 0);
        const all = v.locator('.tp-table .tp-expand-all');
        await all.click();
        assert.equal(await detail.count(), 3);
        await all.click();
        assert.equal(await detail.count(), 0);
        const plain = await h.preview(page, 'plain.log');
        assert.equal(await plain.locator('.tp-view-btn', { hasText: 'Table' }).isDisabled(), true);
        assert.equal(await plain.locator('.tp-table').count(), 0);
    });

    it('spreadsheets: sheet picker, read only, sheets cached one by one', async () => {
        const page = await openFolder(`${h.LIBRARY}/Data`);
        const v = await h.preview(page, 'harvest.xlsx');
        const picker = v.locator('.tp-picker');
        const items = v.locator('.tp-picker-menu .tp-picker-item');
        assert.equal(await picker.isVisible(), true);
        await picker.click();
        assert.deepEqual(await items.allTextContents(), ['● Prices', '○ Notes', '○ Secret (hidden)']);
        assert.match(await v.locator('.tp-title-sheet').textContent(), /Sheet: Prices/);
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
        const picker = v.locator('.tp-picker');
        const menu = v.locator('.tp-picker-menu');
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
        assert.match(await v.locator('.tp-title-sheet').textContent(), /Table: Orders/);
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
        assert.match(await v.locator('.tp-content').textContent(), /1,fruit,price,harvest,ripe/);
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
        assert.match(await v.locator('.tp-content').textContent(), /Not a plain text file/);
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
