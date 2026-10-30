// Behavioural tests of Zen mode: own list of the folder (properties, sort, filters, columns, edits) beside the viewer,
// on the mock Sharepoint (its REST API: cf. /tests/mocks/mock-sharepoint/properties.ts)

import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const DATA = `${h.LIBRARY}/Data`;

/** @returns list view of a folder (eyes in) and the requests made */
async function openFolder(folder: string, settings: Record<string, unknown> = {}): Promise<h.Session> {
    const session = await browser.open(h.folderUrl(folder), { settings });
    await session.page.locator('.tp-preview').first().waitFor();
    return session;
}

/** Zen mode by its tab (no viewer yet: the empty one first, by the header eye) @returns Zen list */
async function zen(page: Page): Promise<Locator> {
    if (!(await page.locator('.tp-viewer').count())) await page.locator('.tp-head').dispatchEvent('click');
    await page.locator('.tp-zen-tab').click();
    return filled(page);
}

/** @returns Zen list, once its rows are in */
async function filled(page: Page): Promise<Locator> {
    const z = page.locator('.tp-zen');
    await z.locator('.tp-zen-row').first().waitFor();
    return z;
}

/** @returns column titles of the Zen list */
const titles = async (z: Locator): Promise<string[]> =>
    (await z.locator('thead th .tp-sort').allTextContents()).map((t) => t.replace(/[✎▲▼]/g, '').trim());

/** @returns names of the rows shown */
const names = async (z: Locator): Promise<string[]> =>
    (await z.locator('tbody td.tp-zen-name').allTextContents()).map((t) => t.trim());

/** @returns row of an item */
const rowOf = (z: Locator, name: string): Locator =>
    z.locator('tr.tp-zen-row').filter({ has: z.page().locator('td.tp-zen-name', { hasText: exact(name) }) });

/** @returns pattern of exactly this text (spaces around allowed) */
function exact(s: string): RegExp {
    const escaped = s.replace(/[.*+?^$|()[\]{}\\]/g, '\\$&');
    return new RegExp(`^\\s*${escaped}\\s*$`);
}

/** @returns cell of an item in a column (by title) */
async function cell(z: Locator, name: string, title: string): Promise<Locator> {
    const i = (await titles(z)).indexOf(title);
    assert.ok(i >= 0, `column ${title}`);
    return rowOf(z, name)
        .locator('td')
        .nth(i + 1); // after the checkbox
}

/** @returns a button of the Zen bar (by the start of its title) */
const btn = (z: Locator, title: string): Locator => z.locator(`.tp-bar .tp-bar-btn[title^="${title}"]`);

/** @returns a button of the columns pane (by the start of its title) */
const paneBtn = (z: Locator, title: string): Locator => z.locator(`.tp-zen-pane .tp-bar-btn[title^="${title}"]`);

/** Columns pane from the ⋯ menu (read only) */
async function columns(z: Locator): Promise<void> {
    await btn(z, 'More').click();
    await z.locator('.tp-zen-more .tp-menu-item', { hasText: 'Columns' }).click();
}

/** Columns pane opened, then its Edit: layout mode on */
async function editColumns(z: Locator): Promise<void> {
    await columns(z);
    await paneBtn(z, 'Edit').click();
}

/** @returns dialogues so far (confirm answers "yes") */
const dialogues = (page: Page): Promise<{ alerts: string[]; confirms: string[] }> =>
    page.evaluate(() => {
        const { alerts, confirms } = (window as unknown as { __gm: { alerts: string[]; confirms: string[] } }).__gm;
        return { alerts: [...alerts], confirms: [...confirms] };
    });

describe('zen mode', () => {
    it("⋯ menu: own list over Sharepoint's, columns of the view, folders first, name frozen", async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        const shownTitles = await titles(z);
        assert.deepEqual(shownTitles.slice(0, 6), [
            'Name',
            'Modified',
            'Modified By',
            'File Size',
            'Status',
            'Priority',
        ]);
        assert.ok(!shownTitles.includes('Notes')); // not in the view: hidden at first
        // titles paired with their internal names, which do not follow them
        assert.ok(shownTitles.includes('Datei infos') && shownTitles.includes('File information'));
        const cell = (col: string) => rowOf(z, 'prices.csv').locator(`td[data-col="${col}"]`);
        assert.equal((await cell('Fileinformation').textContent())?.trim(), 'Info prices.csv');
        assert.equal((await cell('Fileinformation2').textContent())?.trim(), 'Ref prices.csv');
        assert.match((await cell('FileSizeDisplay').textContent()) ?? '', /^\d+(\.\d)? (B|KB|MB)$/); // computed: from File/Length
        const shown = await names(z);
        assert.equal(shown[0], 'Reports');
        assert.ok(shown.includes('prices.csv'));
        assert.equal(await z.locator('th.tp-zen-name').evaluate((el) => getComputedStyle(el).position), 'sticky');
        // over Sharepoint's list (what is left of it), lined up with the viewer below it: same edges, one gap between
        const list = await page.locator('#grid').boundingBox();
        const own = await z.boundingBox();
        const v = await page.locator('.tp-viewer').boundingBox();
        assert.ok(list && own && v && Math.abs(own.y - list.y) < 60);
        assert.ok(Math.abs(own.x - v.x) <= 1 && Math.abs(own.width - v.width) <= 1, 'same left and right edges');
        assert.ok(Math.abs(v.y - (own.y + own.height) - 3) <= 1, 'gap of 3 px');
    });

    it('right of the list: lined up with the viewer (same top and bottom, one gap between)', async () => {
        const { page } = await openFolder(DATA, { layout: 'vertical' });
        const z = await zen(page);
        const own = await z.boundingBox();
        const v = await page.locator('.tp-viewer').boundingBox();
        assert.ok(own && v);
        assert.ok(Math.abs(own.y - v.y) <= 1 && Math.abs(own.height - v.height) <= 1, 'same top and bottom');
        assert.ok(Math.abs(v.x - (own.x + own.width) - 3) <= 1, 'gap of 3 px');
    });

    it('a file opens in the viewer (row marked), a folder in the list; breadcrumb back', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        await z.locator('td.tp-zen-name', { hasText: 'prices.csv' }).click();
        const v = page.locator('.tp-viewer');
        await v.locator('.tp-title-name', { hasText: 'prices.csv' }).waitFor();
        await z.locator('tr.tp-zen-shown', { hasText: 'prices.csv' }).waitFor();
        await z.locator('td.tp-zen-name', { hasText: 'Reports' }).click();
        await z.locator('td.tp-zen-name', { hasText: '2025.csv' }).waitFor();
        await z.locator('.tp-zen-crumbs a', { hasText: 'Data' }).click();
        await z.locator('td.tp-zen-name', { hasText: 'prices.csv' }).waitFor();
    });

    it("crumbs: link (clean URL of the folder), library with a menu of the site's other libraries (Sharepoint's own left out)", async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        await z.locator('.tp-well-btn[title^="Copy"]').hover();
        assert.equal(
            await z.locator('.tp-well-btn[title^="Copy"]').getAttribute('title'),
            `Copy the link:\n${h.ORIGIN}${DATA}`,
        );
        await z.locator('.tp-zen-libs').click();
        const menu = z.locator('.tp-zen-libraries');
        assert.deepEqual(
            (await menu.locator('.tp-menu-item').allTextContents()).map((t) => t.trim()),
            ['Mock Library', 'Mock Tools Library'],
        );
        assert.equal(await menu.locator('[aria-current="page"]').textContent(), 'Mock Library');
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
        // another library: Sharepoint opens it (page load), Zen mode again there
        await z.locator('.tp-zen-libs').click();
        await menu.locator('.tp-menu-item', { hasText: 'Mock Tools Library' }).click();
        await page.waitForURL(/\/MockToolsLibrary\/Forms\/AllItems\.aspx/);
        const again = await filled(page);
        await again.locator('.tp-zen-crumbs strong', { hasText: 'Mock Tools Library' }).waitFor();
    });

    it("folders: Sharepoint's list follows (Zen mode off: that folder); Back: the Zen list follows", async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        await z.locator('td.tp-zen-name', { hasText: 'Reports' }).click();
        await z.locator('td.tp-zen-name', { hasText: '2025.csv' }).waitFor();
        assert.match(decodeURIComponent(page.url()), /id=\/sites\/MockSharepoint\/MockLibrary\/Data\/Reports$/);
        await page.goBack(); // address of Data again: the Zen list follows
        await z.locator('td.tp-zen-name', { hasText: 'prices.csv' }).waitFor();
        await page.goForward();
        await z.locator('td.tp-zen-name', { hasText: '2025.csv' }).waitFor();
        await page.locator('.tp-zen-tab').click();
        await h.eye(page, '2025.csv').waitFor(); // Sharepoint's list in the same folder
    });

    it('sort by a column; filter by its values (folders first throughout)', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        await z.locator('th.tp-zen-name .tp-sort').click();
        await z.locator('th.tp-zen-name .tp-sort', { hasText: '▲' }).waitFor();
        await z.locator('th.tp-zen-name .tp-sort').click(); // descending
        await z.locator('th.tp-zen-name .tp-sort', { hasText: '▼' }).waitFor();
        await z.locator('.tp-zen-row').first().waitFor();
        const desc = await names(z);
        assert.equal(desc[0], 'Reports');
        const files = desc.slice(1);
        const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        assert.deepEqual(
            files,
            [...files].sort((a, b) => cmp.compare(b, a)),
        );
        await z.locator('th.tp-zen-name .tp-filter').click();
        await z.locator('.tp-filter-panel input[type="text"]').fill('.csv');
        await page.waitForFunction(() => document.querySelectorAll('.tp-zen tbody td.tp-zen-name').length === 1);
        assert.deepEqual(await names(z), ['prices.csv']);
    });

    it("order as Sharepoint's view (its OrderBy: by name), not as the API sends the items (by id); folders first", async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        const shown = await names(z);
        const files = shown.slice(1);
        const cmp = new Intl.Collator(undefined, { sensitivity: 'base' });
        assert.equal(shown[0], 'Reports');
        assert.deepEqual(
            files,
            [...files].sort((a, b) => cmp.compare(a, b)),
        );
        assert.equal(await z.locator('th .tp-sort', { hasText: /[▲▼]/ }).count(), 0); // no own sort
    });

    it('select: checkboxes (Shift: a range), rows by Ctrl / Cmd (not opened), the head: all shown or none', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        const shown = await names(z);
        const box = (name: string) => rowOf(z, name).locator('.tp-zen-pick-one');
        const picked = async () =>
            (await z.locator('tr.tp-zen-selected td.tp-zen-name').allTextContents()).map((t) => t.trim());
        await box(shown[1]).click();
        await box(shown[3]).click({ modifiers: ['Shift'] });
        assert.deepEqual(await picked(), shown.slice(1, 4));
        assert.equal(await z.locator('.tp-zen-picked').textContent(), '3 selected');
        assert.equal(
            await z.locator('.tp-zen-pick-all').evaluate((el) => (el as HTMLInputElement).indeterminate),
            true,
        );
        // Ctrl / Cmd + click on a row: one more, the viewer shows no file
        await rowOf(z, shown[5])
            .locator('td.tp-zen-name')
            .click({ modifiers: ['ControlOrMeta'] });
        assert.deepEqual(await picked(), [...shown.slice(1, 4), shown[5]]);
        await rowOf(z, shown[2])
            .locator('td.tp-zen-name')
            .click({ modifiers: ['ControlOrMeta'] });
        assert.deepEqual(await picked(), [shown[1], shown[3], shown[5]]);
        assert.equal(await z.locator('tr.tp-zen-shown').count(), 0, 'no file opened');
        // Shift + click on a row: the range from the last one clicked
        await rowOf(z, shown[4])
            .locator('td.tp-zen-name')
            .click({ modifiers: ['Shift'] });
        assert.deepEqual(await picked(), shown.slice(1, 6));
        // the head: all, then none
        await z.locator('.tp-zen-pick-all').click();
        assert.equal((await picked()).length, shown.length);
        assert.equal(await z.locator('.tp-zen-pick-all').isChecked(), true);
        await z.locator('.tp-zen-pick-all').click();
        assert.deepEqual(await picked(), []);
        assert.equal(await btn(z, 'Download').isDisabled(), true);
        // another folder: nothing selected there
        await box(shown[1]).click();
        await z.locator('td.tp-zen-name', { hasText: 'Reports' }).click();
        await z.locator('td.tp-zen-name', { hasText: '2025.csv' }).waitFor();
        assert.deepEqual(await picked(), []);
    });

    it('select all: Ctrl / ⌘ + A with the pointer over the list (all items it has); Esc or a click elsewhere drops it', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        const n = (await names(z)).length;
        const picked = () => z.locator('tr.tp-zen-selected').count();
        // pointer over the viewer: the list leaves it alone
        await page.locator('.tp-viewer').hover();
        await page.keyboard.press('ControlOrMeta+a');
        assert.equal(await picked(), 0);
        // pointer over the list: all of its items, also those scrolled out of sight
        await z.locator('tr.tp-zen-row').nth(2).hover();
        await page.keyboard.press('ControlOrMeta+a');
        assert.equal(await picked(), n);
        assert.equal(await h.text(z.locator('.tp-zen-picked')), `${n} selected`);
        // dropped by Esc, and by a click elsewhere (not on what acts on it: download, delete, checkboxes)
        await page.keyboard.press('Escape');
        assert.equal(await picked(), 0, 'Esc');
        await page.keyboard.press('ControlOrMeta+a');
        await btn(z, 'Download').hover(); // hovering: nothing happens
        assert.equal(await picked(), n);
        await rowOf(z, 'prices.csv').locator('.tp-zen-pick-one').click(); // a checkbox: changes it
        assert.equal(await picked(), n - 1);
        await page.locator('.tp-viewer .tp-content').click(); // elsewhere: gone
        assert.equal(await picked(), 0, 'a click elsewhere');
        // the text cursor in a field (a filter's text): typing wins
        await z.locator('th[title="Status"] .tp-filter').click();
        await z.locator('.tp-filter-panel input[type="text"]').first().focus();
        await z.locator('tr.tp-zen-row').nth(2).hover();
        await page.keyboard.press('ControlOrMeta+a');
        assert.equal(await picked(), 0);
    });

    it('select all, then a click on the empty space below the rows: none (no text marked); the scrollbar keeps it', async () => {
        const { page } = await openFolder(`${h.LIBRARY}/Config`);
        const z = await zen(page);
        const n = (await names(z)).length;
        const picked = () => z.locator('tr.tp-zen-selected').count();
        const grid = await z.locator('.tp-zen-grid').boundingBox();
        const table = await z.locator('.tp-zen-table').boundingBox();
        assert.ok(grid && table && grid.y + grid.height > table.y + table.height + 30, 'room below the rows');
        await z.locator('tr.tp-zen-row').first().hover();
        await page.keyboard.press('ControlOrMeta+a');
        assert.equal(await picked(), n);
        assert.equal(await page.evaluate(() => String(window.getSelection())), '', 'no text marked');
        await page.mouse.click(grid.x + grid.width / 2, table.y + table.height + 20);
        assert.equal(await picked(), 0, 'empty space: dropped');
        await page.mouse.dblclick(grid.x + grid.width / 2, table.y + table.height + 20);
        assert.equal(await page.evaluate(() => String(window.getSelection()).trim()), '', 'no text marked');
    });

    it('select all: the pointer decides, not the file shown (list: its items; viewer content: its text)', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        const n = (await names(z)).length;
        const picked = () => z.locator('tr.tp-zen-selected').count();
        const text = () => page.evaluate(() => String(getSelection()));
        await z.locator('td.tp-zen-name', { hasText: 'prices.csv' }).click(); // shown in the viewer (focus there)
        const v = page.locator('.tp-viewer');
        await v.locator('.tp-title-name', { hasText: 'prices.csv' }).waitFor();
        await v.locator('.tp-view-btn', { hasText: 'Text' }).click();
        await v.locator('.tp-content').click();
        await z.locator('tr.tp-zen-row').nth(3).hover();
        await page.keyboard.press('ControlOrMeta+a');
        assert.equal(await picked(), n, 'the list: all its items');
        assert.equal(await text(), '', 'no text marked');
        await v.locator('.tp-content').hover();
        await page.keyboard.press('ControlOrMeta+a');
        assert.match(await text(), /banana, ripe/, 'the viewer: its text');
        assert.equal(await picked(), n, 'the list as it was');
        // Esc: whatever is selected dropped (text and items at once); the viewer stays
        await page.keyboard.press('Escape');
        assert.equal(await text(), '');
        assert.equal(await picked(), 0);
        assert.equal(await v.count(), 1, 'viewer still open');
    });

    it('download: one file as it is; several, or a folder with all in it: a ZIP named after the folder', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        const box = (name: string) => rowOf(z, name).locator('.tp-zen-pick-one');
        await box('prices.csv').click();
        let wait = page.waitForEvent('download');
        await btn(z, 'Download').click();
        let file = await wait;
        assert.equal(file.suggestedFilename(), 'prices.csv');
        assert.equal(
            fs.readFileSync(await file.path(), 'utf8'),
            fs.readFileSync(`${import.meta.dirname}/../mocks/mock-sharepoint/library/Data/prices.csv`, 'utf8'),
        );
        await box('Reports').click();
        wait = page.waitForEvent('download');
        await btn(z, 'Download').click();
        file = await wait;
        assert.equal(file.suggestedFilename(), 'Data.zip');
        const zip = fs.readFileSync(await file.path());
        assert.equal(zip.readUInt32LE(0), 0x04034b50);
        const names = zip.toString('latin1');
        for (const n of ['Reports/', 'Reports/2025.csv', 'prices.csv']) assert.ok(names.includes(n), n);
        assert.equal(await z.locator('.tp-zen-picked').textContent(), '2 selected'); // progress gone
    });

    it("delete: after asking (number, names, folders warned of), to the recycle bin as Sharepoint's own; the viewer follows", async () => {
        // in the library's top folder: items no other test here uses (deletes last for the browser's session)
        const { page, requests } = await openFolder(h.LIBRARY);
        const z = await zen(page);
        const box = (name: string) => rowOf(z, name).locator('.tp-zen-pick-one');
        assert.equal(await btn(z, 'Delete').isDisabled(), true, 'nothing selected');
        await z.locator('td.tp-zen-name', { hasText: 'notes.txt' }).click();
        const v = page.locator('.tp-viewer');
        await v.locator('.tp-title-name', { hasText: 'notes.txt' }).waitFor();
        // the Delete key (focus on a checkbox: in the list, not typing)
        await box('notes.txt').click();
        await box('Logs').click();
        await page.keyboard.press('Delete');
        await rowOf(z, 'Logs').waitFor({ state: 'detached' });
        const asked = (await dialogues(page)).confirms.join('\n');
        assert.match(asked, /^Delete 2 items\?/);
        for (const part of ['• notes.txt', '• Logs (folder)', 'everything in them', 'recycle bin'])
            assert.ok(asked.includes(part), part);
        assert.ok(!(await names(z)).includes('notes.txt'));
        assert.match(await h.text(z.locator('.tp-zen-note')), /2 deleted/);
        assert.equal(await z.locator('.tp-zen-picked').textContent(), '', 'nothing selected');
        assert.equal(await v.locator('.tp-title-name', { hasText: 'notes.txt' }).count(), 0, 'viewer: file gone');
        const posts = requests.filter((r) => r.method === 'POST').map((r) => new URL(r.url).pathname);
        assert.equal(posts.filter((p) => /\/items\(\d+\)\/recycle\(\)$/.test(p)).length, 2);
        const status = (p: string) => page.evaluate(async (url) => (await fetch(url)).status, p);
        assert.equal(await status(`${h.LIBRARY}/notes.txt`), 404);
        assert.equal(await status(`${h.LIBRARY}/Logs/app.log`), 404, 'folder: with all in it');
        // the button; typing in a field: the Delete key is the field's (a click elsewhere drops the selection:
        // edit mode first, then the item picked, the cell focused without a click)
        await z.locator('.tp-bar-btn[title^="Edit"]').click();
        await box('README.md').click();
        const priority = (await cell(z, 'README.md', 'Priority')).locator('.tp-zen-text');
        await priority.focus();
        await page.keyboard.press('Delete');
        assert.equal((await dialogues(page)).confirms.length, 1, 'not asked while typing');
        await btn(z, 'Delete').click();
        await rowOf(z, 'README.md').waitFor({ state: 'detached' });
        assert.match((await dialogues(page)).confirms[1], /^Delete 1 item\?\n\n {4}• README\.md\n/);
    });

    it('purge: for good after a warning (not to the recycle bin); the bin with Shift (red flame), Shift + Delete as well', async () => {
        // in the library's top folder: items no other test here uses (after the delete test: what is left of it)
        const { page, requests } = await openFolder(h.LIBRARY);
        const z = await zen(page);
        const box = (name: string) => rowOf(z, name).locator('.tp-zen-pick-one');
        assert.equal(await btn(z, 'Delete').isDisabled(), true, 'nothing selected');
        await box('Empty folder').click();
        // the bin with Shift held: the flame (purge), red
        await page.keyboard.down('Shift');
        const purge = btn(z, 'Purge');
        assert.match((await purge.getAttribute('class')) ?? '', /tp-zen-purge/);
        await purge.click({ modifiers: ['Shift'] });
        await page.keyboard.up('Shift');
        assert.equal(await btn(z, 'Delete').count(), 1, 'the bin again');
        await rowOf(z, 'Empty folder').waitFor({ state: 'detached' });
        const asked = (await dialogues(page)).confirms.join('\n');
        assert.match(asked, /^PURGE 1 item for good\?/);
        for (const part of ['• Empty folder (folder)', 'purged with everything in them', 'cannot be restored'])
            assert.ok(asked.includes(part), part);
        assert.match(await h.text(z.locator('.tp-zen-note')), /1 purged \(for good\)/);
        const posts = requests.filter((r) => r.method === 'POST').map((r) => new URL(r.url).pathname);
        assert.equal(posts.filter((p) => /\/items\(\d+\)\/deleteObject\(\)$/.test(p)).length, 1);
        assert.equal(posts.filter((p) => /\/recycle\(\)$/.test(p)).length, 0, 'not to the recycle bin');
        // Shift + Delete (focus on a checkbox: in the list)
        await box('Models').click();
        await page.keyboard.press('Shift+Delete');
        await rowOf(z, 'Models').waitFor({ state: 'detached' });
        assert.match((await dialogues(page)).confirms[1], /^PURGE 1 item for good\?/);
        const status = await page.evaluate(async (url) => (await fetch(url)).status, `${h.LIBRARY}/Models/wall.ifc`);
        assert.equal(status, 404);
    });

    it("files dragged in: through to Sharepoint's list beneath (it uploads them), then shown in the list", async () => {
        // a folder no other test here lists (the upload stays for the browser's session)
        const { page } = await openFolder(`${h.LIBRARY}/Config`);
        const z = await zen(page);
        const box = await z.boundingBox();
        assert.ok(box);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        // as the browser does: each event to the element under the pointer (hit test anew each time)
        const target = await page.evaluate(
            async ([x, y]) => {
                const data = new DataTransfer();
                data.items.add(new File(['dropped'], 'dropped.txt', { type: 'text/plain' }));
                const fire = (type: string) => {
                    const el = document.elementFromPoint(x, y) as Element;
                    el.dispatchEvent(
                        new DragEvent(type, {
                            dataTransfer: data,
                            clientX: x,
                            clientY: y,
                            bubbles: true,
                            cancelable: true,
                        }),
                    );
                    return el;
                };
                fire('dragenter');
                const under = fire('dragover');
                const marked = !!document.querySelector('.tp-zen.tp-zen-drop');
                fire('drop');
                return { zen: !!under.closest('.tp-zen'), card: !!under.closest('.card'), marked };
            },
            [x, y],
        );
        assert.deepEqual(target, { zen: false, card: true, marked: true }, "Sharepoint's list under the pointer");
        await rowOf(z, 'dropped.txt').waitFor();
        await page.waitForFunction(() => !document.querySelector('.tp-zen-drop'));
        await z.locator('.tp-zen-row').first().click({ trial: true }); // the list usable again
    });

    it('columns: a pane (read only until Edit), shown and hidden there, kept for the library once saved', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        await columns(z);
        const pane = z.locator('.tp-zen-pane');
        const list = await z.locator('.tp-zen-body').boundingBox();
        const box = await pane.boundingBox();
        assert.ok(list && box && Math.abs(box.height - list.height) <= 2, 'full height of the list');
        assert.ok(await pane.locator('label', { hasText: 'Notes' }).locator('input').isDisabled(), 'read only');
        assert.ok(await paneBtn(z, 'Save').isDisabled());
        await paneBtn(z, 'Edit').click();
        await pane.locator('label', { hasText: 'Notes' }).locator('input').check();
        await pane.locator('label', { hasText: 'Priority' }).locator('input').uncheck();
        assert.ok((await titles(z)).includes('Notes'));
        assert.ok(!(await titles(z)).includes('Priority'));
        await paneBtn(z, 'Save').click();
        await paneBtn(z, 'Close').click(); // ✕: pane gone (saved: no question)
        assert.equal(await pane.count(), 0);
        assert.equal((await dialogues(page)).confirms.length, 0);
        await page.reload();
        const again = await filled(page); // Zen mode on again (remembered)
        assert.ok((await titles(again)).includes('Notes'));
        assert.ok(!(await titles(again)).includes('Priority'));
    });

    it('columns: moved by dragging a title or a pane entry (no HTML drag and drop: Sharepoint takes it), kept', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        // as Sharepoint's drop zone for uploads: HTML drag and drop never reaches the list
        await page.evaluate(() => {
            const swallow = (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
            };
            for (const type of ['dragstart', 'dragover', 'drop']) document.addEventListener(type, swallow, true);
        });
        const before = await titles(z);
        assert.equal(before[1], 'Modified');
        await editColumns(z); // layout mode
        const status = z.locator('th[title="Status"] .tp-sort');
        // halfway: Modified shaded, a bar at its left edge down the whole list, a copy of Status lifted
        const from = await status.boundingBox();
        const to = await z.locator('th[title="Modified"]').boundingBox();
        const grid = await z.locator('.tp-zen-grid').boundingBox();
        assert.ok(from && to && grid);
        await page.mouse.move(from.x + 5, from.y + 5);
        await page.mouse.down();
        await page.mouse.move(to.x + 4, to.y + 5, { steps: 8 });
        assert.equal(await z.locator('th[title="Modified"].tp-drop-target').count(), 1, 'target shaded');
        const bar = await page.locator('.tp-drop-bar').boundingBox();
        assert.ok(bar && Math.abs(bar.x + bar.width / 2 - to.x) <= 3, 'bar at its left edge');
        assert.ok(bar && bar.height >= grid.height - 2, 'across the whole list');
        assert.match(await h.text(page.locator('.tp-lifted')), /Status/);
        await page.mouse.up();
        const moved = await titles(z);
        assert.equal(moved[1], 'Status', moved.join(', '));
        assert.equal(await z.locator('th .tp-sort', { hasText: '▲' }).count(), 0, 'no sort after the drag');
        // the name stays first
        await z.locator('th[title="Due"] .tp-sort').dragTo(z.locator('th.tp-zen-name'));
        assert.equal((await titles(z))[0], 'Name');
        // pane: an entry dragged onto the first one
        const labels = z.locator('.tp-zen-columns label');
        await labels.filter({ hasText: 'File Size' }).dragTo(labels.first(), { targetPosition: { x: 20, y: 2 } });
        assert.equal((await titles(z))[1], 'File Size');
        await page.keyboard.press('Control+s'); // saved, as the Save button
        await page.reload();
        assert.equal((await titles(await filled(page)))[1], 'File Size'); // kept
    });

    it('layout mode: columns moved only there, not while editing (nor the other way round); widths: any mode', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        // read mode: titles not movable; widths changed, kept at once (no Save), double-click: as it fits
        assert.equal(await z.locator('th.tp-movable').count(), 0);
        const handle = z.locator('th[title="Status"] .tp-resize');
        const b = await handle.boundingBox();
        assert.ok(b);
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + 150, b.y + b.height / 2, { steps: 5 });
        await page.mouse.up();
        const wide = (await z.locator('th[title="Status"]').boundingBox())?.width ?? 0;
        assert.ok(wide > 150, `wider: ${wide}`);
        await page.reload();
        const again = await filled(page);
        assert.ok(
            Math.abs(((await again.locator('th[title="Status"]').boundingBox())?.width ?? 0) - wide) <= 1,
            'kept',
        );
        await again.locator('th[title="Status"] .tp-resize').dblclick();
        assert.ok(((await again.locator('th[title="Status"]').boundingBox())?.width ?? 0) < wide, 'as it fits');
        await z.locator('th[title="Status"] .tp-sort').dragTo(z.locator('th[title="Modified"] .tp-sort'));
        assert.equal((await titles(z))[1], 'Modified', 'not moved');
        // editing properties: the pane opens, but its Edit is off
        await btn(z, 'Edit').click();
        await columns(z);
        assert.ok(await paneBtn(z, 'Edit').isDisabled());
        await page.keyboard.press('Escape'); // the pane
        assert.equal(await z.locator('.tp-zen-pane').count(), 0);
        await page.keyboard.press('Escape'); // editing properties
        // layout mode: no editing properties, no upload; marked
        await editColumns(z);
        assert.ok(await btn(z, 'Edit').isDisabled());
        assert.ok(await paneBtn(z, 'Upload').isDisabled(), 'as the view');
        assert.ok(await paneBtn(z, 'Save').isDisabled(), 'nothing changed yet');
        assert.ok(await z.evaluate((el) => el.classList.contains('tp-zen-layout')));
        assert.ok((await z.locator('th.tp-movable').count()) > 0);
        await z.locator('th.tp-zen-name').click(); // sorts: the pane stays
        assert.equal(await z.locator('.tp-zen-pane').count(), 1);
    });

    it('layout mode: a draft; Cancel and Esc drop it (after asking), the columns as saved again', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        const before = await titles(z);
        await editColumns(z);
        await z.locator('.tp-zen-columns label', { hasText: 'Status' }).locator('input').uncheck();
        assert.ok(!(await titles(z)).includes('Status'), 'shown at once');
        assert.ok(await paneBtn(z, 'Save').isEnabled());
        await paneBtn(z, 'Cancel').click();
        assert.deepEqual(await titles(z), before);
        assert.equal(await z.locator('.tp-zen-pane-editing').count(), 0, 'layout mode off, the pane stays');
        assert.equal((await dialogues(page)).confirms.length, 1, 'asked');
        await paneBtn(z, 'Edit').click();
        await z.locator('.tp-zen-columns label', { hasText: 'Status' }).locator('input').uncheck();
        await page.keyboard.press('Escape');
        assert.deepEqual(await titles(z), before);
        await page.reload();
        assert.deepEqual(await titles(await filled(page)), before, 'nothing kept');
    });

    it('columns: Upload writes the columns saved into the Sharepoint view (asked first), for everyone', async () => {
        // in a folder of the Tools library: its own view, so the other tests keep theirs
        const { page, requests } = await openFolder(`${h.TOOLS}`);
        const z = await zen(page);
        await editColumns(z);
        assert.ok(await paneBtn(z, 'Upload').isDisabled(), 'as the view');
        await z.locator('.tp-zen-columns label', { hasText: 'Status' }).locator('input').uncheck();
        assert.ok(await paneBtn(z, 'Upload').isDisabled(), 'not saved yet');
        await paneBtn(z, 'Save').click();
        await paneBtn(z, 'Upload').click();
        await z.locator('.tp-zen-note', { hasText: 'columns uploaded' }).waitFor();
        assert.match((await dialogues(page)).confirms.join('\n'), /for everyone/);
        const posts = requests
            .filter((r) => r.method === 'POST')
            .map((r) => decodeURIComponent(new URL(r.url).pathname));
        assert.ok(posts.some((p) => /\/ViewFields\/removeAllViewFields$/.test(p)));
        assert.ok(
            posts.some((p) => /\/ViewFields\/addViewField\('LinkFilename'\)$/.test(p)),
            'name fields kept',
        );
        assert.ok(!posts.some((p) => /addViewField\('Status'\)/.test(p)));
        assert.ok(await paneBtn(z, 'Upload').isDisabled(), 'now as the view');
    });

    it('columns pane: its left edge changes the width (kept); released narrow, it closes', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        await columns(z);
        const pane = z.locator('.tp-zen-pane');
        const drag = async (dx: number) => {
            const g = await pane.locator('.tp-zen-pane-grip').boundingBox();
            assert.ok(g);
            await page.mouse.move(g.x + g.width / 2, g.y + 100);
            await page.mouse.down();
            await page.mouse.move(g.x + g.width / 2 + dx, g.y + 100, { steps: 5 });
            await page.mouse.up();
        };
        const w0 = (await pane.boundingBox())?.width ?? 0;
        await drag(-100);
        const w1 = (await pane.boundingBox())?.width ?? 0;
        assert.ok(Math.abs(w1 - w0 - 100) <= 2, `wider: ${w0} -> ${w1}`);
        await paneBtn(z, 'Close').click();
        await columns(z);
        assert.ok(Math.abs(((await pane.boundingBox())?.width ?? 0) - w1) <= 2, 'width kept');
        await drag(w1 - 100);
        assert.equal(await pane.count(), 0, 'closed');
    });

    it('folder line: (i) as in the viewer (one setting); off, only while there is something to say', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        const meta = z.locator('.tp-zen-meta');
        const info = z.locator('.tp-well-btn[title^="Display folder"]');
        assert.equal(await meta.isVisible(), false, "off by default (as the viewer's properties)");
        await rowOf(z, 'prices.csv').locator('.tp-zen-pick-one').click();
        assert.equal(await meta.isVisible(), true, 'something to say: shown');
        assert.equal(await h.text(z.locator('.tp-zen-picked')), '1 selected');
        assert.equal(await meta.locator('strong').isVisible(), false, 'no label');
        assert.equal(await z.locator('.tp-zen-facts').isVisible(), false, 'no facts');
        await rowOf(z, 'prices.csv').locator('.tp-zen-pick-one').click();
        assert.equal(await meta.isVisible(), false);
        await info.click();
        assert.equal(await info.getAttribute('aria-pressed'), 'true');
        assert.equal(await meta.locator('strong').isVisible(), true);
        assert.match(await h.text(z.locator('.tp-zen-facts')), /^13 items \(1 folder, 12 files\) · latest change: /);
        const viewerInfo = page.locator('.tp-viewer .tp-well-btn[title^="Display file"]');
        assert.equal(await viewerInfo.getAttribute('aria-pressed'), 'true', "the viewer's too");
        await viewerInfo.click();
        assert.equal(await meta.isVisible(), false, 'and back');
    });

    it('⋯ menu: settings, dark mode, reload of the folder, about (last); ✕: Zen mode off (the viewer stays)', async () => {
        const { page, requests } = await openFolder(DATA);
        const z = await zen(page);
        await btn(z, 'More').click();
        const items = await z.locator('.tp-zen-more .tp-menu-item').allTextContents();
        assert.deepEqual(
            items.map((t) => t.trim()),
            ['Full settings …', 'Columns …', 'Dark mode', 'Reload the folder', 'About …'],
        );
        await z.locator('.tp-zen-more .tp-menu-item', { hasText: 'Dark mode' }).click();
        assert.ok(await z.evaluate((el) => el.classList.contains('tp-dark')));
        assert.ok(await page.locator('.tp-viewer').evaluate((el) => el.classList.contains('tp-dark')), 'viewer too');
        const reads = requests.filter((r) => /GetItems/.test(r.url)).length;
        await btn(z, 'More').click();
        await z.locator('.tp-zen-more .tp-menu-item', { hasText: 'Reload the folder' }).click();
        await page.waitForFunction(() => !document.querySelector('.tp-zen-note')?.textContent?.includes('Loading'));
        assert.ok(requests.filter((r) => /GetItems/.test(r.url)).length > reads, 'read anew');
        await btn(z, 'More').click();
        await page.keyboard.press('Escape');
        assert.equal(await z.locator('.tp-zen-more').count(), 0, 'Esc closes it');
        await btn(z, 'Zen mode off').click();
        assert.equal(await page.locator('.tp-zen').count(), 0);
        assert.equal(await page.locator('.tp-viewer').count(), 1);
    });

    it('narrow: the crumbs on a second row (full width), as the file name in the viewer', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        const bar = z.locator('.tp-bar');
        const rowOfCrumbs = () =>
            bar.evaluate((b) => {
                const c = b.querySelector('.tp-zen-crumbs') as HTMLElement;
                const e = b.querySelector('.tp-zen-eye') as HTMLElement;
                return { below: c.offsetTop > e.offsetTop + e.offsetHeight, wide: c.offsetWidth > b.clientWidth - 40 };
            });
        assert.deepEqual(await rowOfCrumbs(), { below: false, wide: false });
        await z.evaluate((el) => {
            el.style.width = '420px';
        });
        await page.waitForFunction(() =>
            document.querySelector('.tp-zen .tp-bar')?.classList.contains('tp-bar-narrow'),
        );
        assert.deepEqual(await rowOfCrumbs(), { below: true, wide: true });
    });

    it("edit: saved in the view, uploaded as Sharepoint's form does (form digest), refused ones marked; system fields read only", async () => {
        const { page, requests } = await openFolder(DATA);
        const z = await zen(page);
        await z.locator('.tp-bar-btn[title^="Edit"]').click();
        await z.locator('td.tp-zen-ro').first().waitFor();
        const modified = await cell(z, 'prices.csv', 'Modified');
        assert.equal(await modified.evaluate((el) => el.classList.contains('tp-zen-ro')), true);
        const select = (await cell(z, 'prices.csv', 'Status')).locator('select');
        const status = (await select.inputValue()) === 'Approved' ? 'Draft' : 'Approved'; // another one than now
        await select.selectOption(status);
        const priority = (await cell(z, 'prices.csv', 'Priority')).locator('.tp-zen-text');
        await priority.click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('high'); // not a number: refused
        const upload = z.locator('.tp-bar-btn[title^="Upload"]');
        assert.equal(await upload.isDisabled(), true, 'not saved yet: no upload');
        await page.keyboard.press('Control+s'); // kept in the view: nothing sent yet
        assert.equal(await upload.isDisabled(), false);
        assert.ok(!requests.some((r) => /ValidateUpdateListItem/.test(r.url)), 'saved: nothing sent');
        await upload.click();
        await z.locator('td.tp-zen-error').waitFor();
        assert.match(await h.text(z.locator('.tp-zen-note')), /1 change uploaded, 1 not uploaded/);
        assert.match((await (await cell(z, 'prices.csv', 'Priority')).getAttribute('title')) ?? '', /Only numbers/);
        assert.equal(await (await cell(z, 'prices.csv', 'Status')).locator('select').inputValue(), status);
        const posts = requests.filter((r) => r.method === 'POST').map((r) => new URL(r.url).pathname);
        assert.ok(posts.includes(`${h.SITE}/_api/contextinfo`));
        assert.ok(posts.some((p) => /\/items\(\d+\)\/ValidateUpdateListItem$/.test(p)));
        // cancel drops the rest (asks first); uploaded values stay
        await z.locator('.tp-bar-btn[title^="Cancel"]').click();
        assert.match((await dialogues(page)).confirms.join('\n'), /not been uploaded/);
        await z.locator('td.tp-zen-ro').first().waitFor({ state: 'detached' });
        assert.equal(await h.text(await cell(z, 'prices.csv', 'Status')), status);
    });

    it('edit: leaving edit mode keeps the changes in the view (said, upload marked); kept across folders and page loads', async () => {
        const { page, requests } = await openFolder(DATA);
        const z = await zen(page);
        await z.locator('.tp-bar-btn[title^="Edit"]').click();
        const priority = (await cell(z, 'orders.ods', 'Priority')).locator('.tp-zen-text');
        await priority.click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('5');
        await z.locator('.tp-bar-btn[title^="Edit"]').click(); // edit mode off, not saved: allowed, said
        assert.match(
            await h.text(z.locator('.tp-zen-note')),
            /kept in the viewer but won't take effect until uploaded/,
        );
        assert.equal(await z.locator('td.tp-zen-ro').count(), 0, 'edit mode off');
        const upload = z.locator('.tp-bar-btn[title^="Upload"]');
        assert.equal(await upload.isDisabled(), false);
        assert.equal(await upload.evaluate((b) => b.classList.contains('tp-zen-ready')), true, 'upload marked');
        assert.ok(!requests.some((r) => /ValidateUpdateListItem/.test(r.url)), 'nothing sent');
        // another folder and back, then a page load: still there, marked
        await z.locator('td.tp-zen-name', { hasText: 'Reports' }).click();
        await z.locator('.tp-zen-crumbs a').last().waitFor();
        await z.locator('.tp-zen-crumbs a').last().click();
        await rowOf(z, 'orders.ods').waitFor();
        assert.equal(await h.text(await cell(z, 'orders.ods', 'Priority')), '5');
        await page.reload();
        const again = await filled(page);
        const kept = await cell(again, 'orders.ods', 'Priority');
        assert.equal(await h.text(kept), '5');
        assert.equal(await kept.evaluate((td) => td.classList.contains('tp-zen-changed')), true);
        assert.match(await h.text(again.locator('.tp-zen-note')), /1 change not uploaded/);
        // upload: applied
        await again.locator('.tp-bar-btn[title^="Upload"]').click();
        await again.locator('.tp-zen-note', { hasText: '1 change uploaded' }).waitFor();
        assert.equal(
            await (await cell(again, 'orders.ods', 'Priority')).evaluate((td) =>
                td.classList.contains('tp-zen-changed'),
            ),
            false,
        );
        assert.equal(await again.locator('.tp-bar-btn[title^="Upload"]').isDisabled(), true);
    });

    it('edit: names longer than their column stay shown, cut at their end (not left out as "…")', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        // name column made narrow (its edge dragged to the left; any mode, kept at once)
        const handle = z.locator('th.tp-zen-name .tp-resize');
        const b = await handle.boundingBox();
        assert.ok(b);
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x - 400, b.y + b.height / 2, { steps: 5 });
        await page.mouse.up();
        await btn(z, 'Edit').click();
        await z.locator('td.tp-zen-name .tp-zen-text[contenteditable]').first().waitFor();
        const cells = await z.locator('td.tp-zen-name').evaluateAll((tds) =>
            tds.map((td) => {
                const text = td.querySelector('.tp-zen-text') as HTMLElement;
                const t = text.getBoundingClientRect();
                const c = td.getBoundingClientRect();
                return { name: text.textContent, inside: t.right <= c.right + 1, width: t.width };
            }),
        );
        for (const c of cells) {
            assert.ok(c.inside, `${c.name}: within its cell`);
            assert.ok(c.width > 20, `${c.name}: shown`);
        }
    });

    it("edit: a new name renames the file (as Sharepoint's rename); the viewer follows", async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        await z.locator('td.tp-zen-name', { hasText: 'harvest.ods' }).click();
        const v = page.locator('.tp-viewer');
        await v.locator('.tp-title-name', { hasText: 'harvest.ods' }).waitFor();
        await z.locator('.tp-bar-btn[title^="Edit"]').click();
        const name = z.locator('td.tp-zen-name', { hasText: 'harvest.ods' }).locator('.tp-zen-text');
        await name.click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('harvest-2026.ods');
        await page.keyboard.press('Enter');
        await z.locator('.tp-bar-btn[title^="Save"]').click();
        await z.locator('.tp-bar-btn[title^="Upload"]').click();
        await z.locator('td.tp-zen-name', { hasText: 'harvest-2026.ods' }).waitFor();
        assert.ok(!(await names(z)).includes('harvest.ods'));
        await v.locator('.tp-title-name', { hasText: 'harvest-2026.ods' }).waitFor();
        const status = await page.evaluate(async (folder) => (await fetch(`${folder}/harvest.ods`)).status, DATA);
        assert.equal(status, 404);
    });

    it('on its own: closing the viewer keeps it (over all of the list); its eye opens the viewer again', async () => {
        const { page } = await openFolder(DATA);
        const z = await zen(page);
        await page.keyboard.press('Escape'); // viewer closed
        assert.equal(await page.locator('.tp-viewer').count(), 0);
        await z.locator('.tp-zen-row').first().waitFor();
        const list = await page.locator('.card').boundingBox();
        const own = await z.boundingBox();
        assert.ok(list && own && Math.abs(own.height - list.height) <= 2, 'all of the list');
        const eyeBefore = await z.locator('.tp-zen-eye').boundingBox();
        const before = await z.boundingBox();
        await z.locator('.tp-zen-eye').click(); // viewer again, Zen mode still on
        await page.locator('.tp-viewer').waitFor();
        assert.equal(await page.locator('.tp-zen').count(), 1);
        // nothing jumps: same left and right edges, the eye where it was (under the mouse)
        const after = await z.boundingBox();
        const eyeAfter = await z.locator('.tp-zen-eye').boundingBox();
        assert.ok(before && after && eyeBefore && eyeAfter);
        assert.ok(Math.abs(before.x - after.x) <= 1 && Math.abs(before.width - after.width) <= 1, 'same edges');
        assert.ok(Math.abs(eyeBefore.x - eyeAfter.x) <= 1 && Math.abs(eyeBefore.y - eyeAfter.y) <= 1, 'eye stays');
        await z.locator('.tp-zen-eye').click(); // and off again
        await page.locator('.tp-viewer').waitFor({ state: 'detached' });
    });

    it("off by its toggle (top left): Sharepoint's list again, the viewer stays; remembered across page loads", async () => {
        const { page } = await openFolder(DATA);
        await zen(page);
        await page.reload();
        await filled(page); // on again, without the viewer
        assert.equal(await page.locator('.tp-viewer').count(), 0);
        await page.locator('.tp-head').dispatchEvent('click');
        await page.locator('.tp-viewer').waitFor();
        await page.locator('.tp-zen-tab').click();
        assert.equal(await page.locator('.tp-zen').count(), 0);
        assert.equal(await page.locator('.tp-viewer').count(), 1);
        await page.reload();
        await page.locator('.tp-preview').first().waitFor();
        assert.equal(await page.locator('.tp-zen').count(), 0);
    });

    it("toggle colours: Sharepoint's while Zen mode is off, the Zen list's theme (dark) while on, with or without the viewer", async () => {
        const { page } = await openFolder(DATA, { theme: 'dark' });
        const tab = page.locator('.tp-zen-tab');
        const theme = async () => ((await tab.getAttribute('class')) ?? '').match(/tp-(light|dark)/)?.[1];
        assert.equal(await theme(), 'light', 'off: as Sharepoint');
        await tab.click();
        await filled(page);
        assert.equal(await page.locator('.tp-viewer').count(), 0);
        assert.equal(await theme(), 'dark', 'on, no viewer: as the Zen list');
        await page.locator('.tp-zen-eye').click();
        await page.locator('.tp-viewer').waitFor();
        assert.equal(await theme(), 'dark', 'on, with the viewer');
        await tab.click();
        await page.locator('.tp-zen').waitFor({ state: 'detached' });
        assert.equal(await theme(), 'light', 'off again, viewer open: as Sharepoint');
    });

    it('toggle: a tab out of the left edge of the list, the same place with Zen mode on (no viewer needed)', async () => {
        const { page } = await openFolder(DATA);
        const tab = page.locator('.tp-zen-tab');
        const card = await page.locator('.card').boundingBox();
        const before = await tab.boundingBox();
        assert.ok(card && before);
        assert.ok(
            before.x + before.width <= card.x + 2 && before.x + before.width >= card.x,
            'joined to its left edge',
        );
        assert.ok(before.y > card.y && before.y < card.y + 40, 'near its top');
        // flush with the top of the list: its shape starts at the list's top edge, whose top left corner is square
        const shape = await tab.locator('.tp-zen-tab-shape').boundingBox();
        assert.ok(shape && Math.abs(shape.y - card.y) <= 1, `flush with the top (${shape?.y} vs ${card.y})`);
        const corner = await page.locator('.card').evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
        assert.equal(corner, '0px', 'square corner where the tab joins');
        assert.equal(await page.locator('.tp-zen-tab-eye').count(), 0, 'header eye in the header (not scrolled)');
        assert.equal(await tab.getAttribute('aria-pressed'), 'false');
        await tab.click();
        const z = await filled(page);
        assert.equal(await page.locator('.tp-viewer').count(), 0);
        assert.equal(await tab.getAttribute('aria-pressed'), 'true'); // filled: on
        const after = await tab.boundingBox();
        assert.ok(after && Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1, 'same place');
        // the Zen list: its eye at the top left; the tab as long as its header (its curve meets the header's lower edge)
        const first = await z.locator('.tp-bar-start > *').first().getAttribute('class');
        assert.match(first ?? '', /tp-zen-eye/);
        const head = await z.locator('.tp-zen-header').boundingBox();
        const curve = await tab.locator('.tp-zen-tab-shape').boundingBox();
        assert.ok(
            head && curve && Math.abs(curve.y + curve.height - (head.y + head.height)) <= 2,
            'ends with the header',
        );
        await tab.click();
        await page.locator('.tp-zen').waitFor({ state: 'detached' });
        assert.equal(await tab.getAttribute('aria-pressed'), 'false');
    });

    for (const layout of ['horizontal', 'vertical']) {
        it(`${layout}: the viewer stays where it is when Zen mode is turned on and off`, async () => {
            const { page } = await openFolder(DATA, { layout });
            await page.locator('.tp-head').dispatchEvent('click');
            const v = page.locator('.tp-viewer');
            await v.waitFor();
            const before = await v.boundingBox();
            await page.locator('.tp-zen-tab').click();
            await filled(page);
            const on = await v.boundingBox();
            await page.locator('.tp-zen-tab').click();
            await page.locator('.tp-zen').waitFor({ state: 'detached' });
            const off = await v.boundingBox();
            assert.ok(before && on && off);
            for (const [name, b] of [
                ['on', on],
                ['off', off],
            ] as const)
                for (const k of ['x', 'y', 'width', 'height'] as const)
                    assert.ok(Math.abs(b[k] - before[k]) <= 1, `${name}: ${k} ${b[k]} (was ${before[k]})`);
        });
    }

    it('splitter: viewer below 20 % closes it (Zen mode stays); above 80 %: only larger', async () => {
        const { page } = await openFolder(DATA);
        await page.locator('.tp-head').dispatchEvent('click');
        await page.locator('.tp-viewer').waitFor();
        const drag = async (y: number) => {
            const b = await page.locator('.tp-splitter').boundingBox();
            assert.ok(b);
            await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
            await page.mouse.down();
            await page.mouse.move(b.x + b.width / 2, y, { steps: 8 });
            await page.mouse.up();
        };
        const list = await page.locator('#grid').boundingBox();
        assert.ok(list);
        await drag(list.y + 4); // viewer nearly all of the space: no Zen mode
        assert.equal(await page.locator('.tp-zen').count(), 0);
        assert.equal(await page.locator('.tp-viewer').count(), 1);
        await page.locator('.tp-zen-tab').click();
        await filled(page);
        await drag(895); // viewer nearly gone
        await page.locator('.tp-viewer').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.tp-zen').count(), 1); // Zen mode stays (on its own)
    });

    it('setting "sharepoint-api" off: no Zen mode (no tab), no API requests', async () => {
        const { page, requests } = await openFolder(DATA, { 'sharepoint-api': false });
        await page.locator('.tp-head').dispatchEvent('click');
        await page.locator('.tp-viewer').waitFor();
        assert.equal(await page.locator('.tp-zen').count(), 0);
        assert.equal(await page.locator('.tp-zen-tab').count(), 0); // no toggle either
        const head = page.locator('.tp-head');
        assert.equal(await head.evaluate((el) => getComputedStyle(el).visibility), 'visible'); // no tab: header eye as ever
        const api = requests.filter((r) => /\/_api\/(web|contextinfo|search)/.test(r.url));
        assert.equal(api.length, 0);
    });
});

describe('settings form', () => {
    it('About: from the ⋯ menus (viewer, Zen list) and the Tampermonkey menu, the settings on its tab', async () => {
        const { page } = await openFolder(DATA);
        const settings = page.locator('.tp-settings');
        const about = settings.locator('[data-pane="about"]');
        const shownAbout = async () => {
            await about.waitFor();
            assert.equal(await about.isVisible(), true, 'tab About shown');
            assert.equal(await settings.locator('[data-pane="form"]').isVisible(), false);
            assert.equal(await settings.locator('[data-act="save"]').isVisible(), false, 'no Save under About');
            assert.equal(
                await settings.locator('[data-mode="about"]').evaluate((b) => (b as HTMLElement).style.color),
                'rgb(255, 255, 255)',
                'its tab pressed',
            );
            assert.equal(await h.text(settings.locator('[data-title]')), 'Sharepoint Previewer: about');
        };
        const close = () => settings.locator('[data-act="close"]').click();
        // the viewer's ⋯ menu
        await page.locator('.tp-head').dispatchEvent('click');
        const v = page.locator('.tp-viewer');
        await v.locator('.tp-mode-btn[title="More"]').click();
        await v.locator('.tp-menu-item', { hasText: 'About' }).click();
        await shownAbout();
        const text = await h.text(about);
        for (const part of ['Sharepoint Previewer v', 'Installation', 'Controls', 'Delete', 'Links', 'Repository'])
            assert.ok(text.includes(part), part);
        assert.equal(
            await about.locator('a', { hasText: 'Repository' }).getAttribute('href'),
            'https://github.com/raj-open/sharepoint-previewer',
        );
        // Form again: the settings, Save there
        await settings.locator('[data-mode="form"]').click();
        assert.equal(await settings.locator('[data-pane="form"]').isVisible(), true);
        assert.equal(await settings.locator('[data-act="save"]').isVisible(), true);
        assert.equal(await h.text(settings.locator('[data-title]')), 'Sharepoint Previewer: settings');
        await close();
        // the Zen list's ⋯ menu
        const z = await zen(page);
        await btn(z, 'More').click();
        await z.locator('.tp-menu-item', { hasText: 'About' }).click();
        await shownAbout();
        await close();
        // the Tampermonkey menu
        await page.evaluate(() =>
            (window as unknown as { __gm: { menu: Record<string, () => void> } }).__gm.menu['About …'](),
        );
        await shownAbout();
    });

    it('Ctrl+S saves (as in write mode)', async () => {
        const { page } = await openFolder(h.LIBRARY);
        await page.evaluate(() =>
            (window as unknown as { __gm: { menu: Record<string, () => void> } }).__gm.menu['Settings …'](),
        );
        const form = page.locator('.tp-settings form');
        await form.locator('input[name="wrap-lines"]').check();
        await page.keyboard.press('Control+s');
        await form.locator('[data-note]', { hasText: 'Saved' }).waitFor();
        const saved = await page.evaluate(() =>
            (window as unknown as { GM_getValue: (k: string) => unknown }).GM_getValue('wrap-lines'),
        );
        assert.equal(saved, true);
    });
});
