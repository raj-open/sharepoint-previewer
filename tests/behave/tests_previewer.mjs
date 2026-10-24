// Behavioural tests (preliminary): userscript on the fake SharePoint (cf. ./fake-sharepoint/server.mjs)

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as h from './harness.mjs';

/** @type {Awaited<ReturnType<typeof h.launch>>} */
let browser;
before(async () => {
  browser = await h.launch();
});
after(() => browser.close());

/** @param {string} folder @returns {Promise<import('playwright').Page>} list view, once eyes are in */
async function openFolder(folder) {
  const { page } = await browser.open(h.folderUrl(folder));
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
    await page.locator('a', { hasText: 'Archive' }).click();
    await h.eye(page, '2025.csv').waitFor();
    assert.equal(await page.locator('.tp-preview').count(), 1);
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
      assert.match(await v.locator('.tp-content').textContent(), new RegExp(text));
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

  it('spreadsheets: sheet drop-down, read only, sheets cached one by one', async () => {
    const page = await openFolder(`${h.LIBRARY}/Data`);
    const v = await h.preview(page, 'harvest.xlsx');
    const select = v.locator('.tp-sheet-select');
    assert.equal(await select.isVisible(), true);
    assert.deepEqual(await select.locator('option').allTextContents(), ['● Prices', '○ Notes', '○ Secret (hidden)']);
    assert.match(await v.locator('.tp-title-sheet').textContent(), /Sheet: Prices/);
    assert.equal(await v.locator('.tp-mode-btn[title^="Edit"]').isDisabled(), true);
    assert.equal(await h.eye(page, 'harvest.xlsx').getAttribute('data-eye'), 'half'); // other sheets not cached

    await select.selectOption({ label: '○ Notes' });
    await v.locator('.tp-title-sheet', { hasText: 'Notes' }).waitFor();
    await h.settled(page);
    assert.match(await v.locator('.tp-content').textContent(), /after a gap/);
    assert.match(await properties(v), /sheet: Notes/);

    await v.locator('.tp-load-more').click(); // last sheet: whole file cached
    await h.settled(page);
    assert.equal(await h.eye(page, 'harvest.xlsx').getAttribute('data-eye'), 'open');
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
