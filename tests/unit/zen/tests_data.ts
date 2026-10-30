// Zen list data: fields (editable or not), items (text shown, raw values), the view's columns, reading, saving
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import type { Fake } from '../helpers.ts';
import { load } from '../helpers.ts';
import { setLocation } from '../helpers.ts';

const {
    formValue,
    loadEntries,
    loadFolder,
    NAME,
    rawText,
    saveItem,
    sizeOf,
    sortItems,
    textKeyOf,
    toField,
    toItem,
    viewFields,
    viewOrder,
} = await load('zen/data.ts');

const LIB = '/sites/A/Shared Documents';
const FIELDS = [
    { InternalName: 'FileLeafRef', Title: 'Name', TypeAsString: 'File' },
    { InternalName: 'Title', Title: 'Title', TypeAsString: 'Text' },
    { InternalName: 'Modified', Title: 'Modified', TypeAsString: 'DateTime', ReadOnlyField: true },
    { InternalName: 'Editor', Title: 'Modified By', TypeAsString: 'User', ReadOnlyField: true },
    { InternalName: 'Status', Title: 'Status', TypeAsString: 'Choice', Choices: ['A', 'B'] },
    { InternalName: 'Done', Title: 'Done', TypeAsString: 'Boolean' },
    {
        InternalName: 'My_x0020_Size',
        EntityPropertyName: 'My_x005f_x0020_x005f_Size',
        Title: 'Size',
        TypeAsString: 'Number',
    },
    { InternalName: '_Comments', Title: 'Comments', TypeAsString: 'Note' },
    { InternalName: 'ContentType', Title: 'Content Type', TypeAsString: 'Computed' },
];

describe('zen/data', () => {
    it('fields: editable only if not read only, not a system field and of a simple type', () => {
        const fields: Fake[] = FIELDS.map(toField);
        const editable = fields.filter((f) => f.editable).map((f) => f.name);
        assert.deepEqual(editable, ['Title', 'Status', 'Done', 'My_x0020_Size']);
        assert.deepEqual(fields[4].choices, ['A', 'B']);
        assert.deepEqual(toField({ InternalName: 'C', TypeAsString: 'Choice', Choices: { results: ['x'] } }).choices, [
            'x',
        ]);
        assert.equal(toField({}), null);
    });

    it('text keys as in FieldValuesAsText; raw values as text (people, lookups, lists)', () => {
        assert.equal(textKeyOf('My_x0020_Size'), 'My_x005f_x0020_x005f_Size');
        assert.equal(rawText({ Title: 'Ada' }), 'Ada');
        assert.equal(rawText([{ LookupValue: 'a' }, { LookupValue: 'b' }]), 'a; b');
        assert.equal(rawText({ Url: 'https://x' }), 'https://x');
        assert.equal(rawText(null), '');
        assert.equal(rawText(3), '3');
    });

    it('items: text shown from FieldValuesAsText, else from the raw value; folders marked', () => {
        const fields = FIELDS.map(toField);
        const item = toItem(
            {
                Id: 7,
                FileLeafRef: 'a.txt',
                FileRef: `${LIB}/a.txt`,
                FSObjType: 0,
                Status: 'B',
                Done: true,
                My_x005f_x0020_x005f_Size: 12,
                FieldValuesAsText: { Status: 'B', Done: 'Yes', My_x005f_x0020_x005f_Size: '12' },
            },
            fields,
        );
        assert.equal(item.id, 7);
        assert.equal(item.folder, false);
        assert.equal(item.text[NAME], 'a.txt');
        assert.equal(item.text.Done, 'Yes');
        assert.equal(item.raw.Done, true);
        assert.equal(item.text.My_x0020_Size, '12');
        assert.equal(item.raw.My_x0020_Size, 12);
        assert.equal(toItem({ Id: 1, FileLeafRef: 'F', FSObjType: 1 }, fields).folder, true);
    });

    it("file size: from File/Length (Sharepoint's column computed, no value), else the lookup; folders none", () => {
        const fields = [
            { InternalName: 'FileSizeDisplay', Title: 'File Size', TypeAsString: 'Computed', ReadOnlyField: true },
        ].map(toField);
        const item = toItem({ Id: 1, FileLeafRef: 'a.csv', FSObjType: 0, File: { Length: '81000' } }, fields);
        assert.equal(item.raw.FileSizeDisplay, 81000);
        assert.equal(item.text.FileSizeDisplay, '79.1 KB');
        assert.equal(sizeOf({ FSObjType: 0, File_x0020_Size: 12 }), 12);
        assert.equal(sizeOf({ FSObjType: 0, File: null }), null);
        assert.equal(sizeOf({ FSObjType: 1, File: { Length: '0' } }), null);
        assert.equal(toItem({ Id: 2, FileLeafRef: 'F', FSObjType: 1 }, fields).text.FileSizeDisplay, '');
    });

    it('titles paired with internal names, which do not follow them (renamed, numbered)', () => {
        const fields: Fake[] = [
            { InternalName: 'Fileinformation', Title: 'Datei infos', TypeAsString: 'Text' },
            { InternalName: 'Fileinformation2', Title: 'File information', TypeAsString: 'Text' },
        ].map(toField);
        assert.deepEqual(
            fields.map((f) => [f.name, f.title]),
            [
                ['Fileinformation', 'Datei infos'],
                ['Fileinformation2', 'File information'],
            ],
        );
        const item = toItem(
            {
                Id: 3,
                FileLeafRef: 'a.txt',
                FSObjType: 0,
                Fileinformation: 'x',
                Fileinformation2: 'y',
                FieldValuesAsText: { Fileinformation: 'x', Fileinformation2: 'y' },
            },
            fields,
        );
        assert.equal(item.text.Fileinformation, 'x');
        assert.equal(item.text.Fileinformation2, 'y');
    });

    it("view's columns: of the page's view, else the default one; name fields left out", () => {
        const fields = FIELDS.map(toField);
        const views = [
            { ServerRelativeUrl: `${LIB}/Forms/Other.aspx`, ViewFields: { Items: ['Title'] } },
            {
                ServerRelativeUrl: `${LIB}/Forms/AllItems.aspx`,
                DefaultView: true,
                ViewFields: { Items: ['DocIcon', 'LinkFilename', 'Status', 'Gone'] },
            },
        ];
        assert.deepEqual(viewFields(views, `${LIB}/Forms/other.aspx`, fields), ['Title']);
        assert.deepEqual(viewFields(views, `${LIB}/Forms/Unknown.aspx`, fields), ['Status']);
    });

    it('values as the form sends them: yes / no, several choices', () => {
        const done = toField(FIELDS[5]);
        assert.equal(formValue(done, '1'), '1');
        assert.equal(formValue(done, ''), '0');
        const multi = toField({ InternalName: 'M', TypeAsString: 'MultiChoice' });
        assert.equal(formValue(multi, 'a; b'), ';#a;#b;#');
        assert.equal(formValue(multi, ''), '');
        assert.equal(formValue(toField(FIELDS[1]), ' x '), ' x ');
    });

    it('reading a folder: fields, views, items of the folder (query scoped to it); refusal said', async () => {
        setLocation('/sites/A/Shared%20Documents/Forms/AllItems.aspx');
        const urls: string[] = [];
        const bodies: unknown[] = [];
        globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
            const u = decodeURIComponent(String(url));
            urls.push(u);
            if (u.endsWith('/_api/contextinfo')) return Response.json({ FormDigestValue: 'D' });
            if (init.body) bodies.push(JSON.parse(String(init.body)));
            if (u.includes('/Fields?')) return Response.json({ value: FIELDS });
            if (u.includes('/Views?'))
                return Response.json({ value: [{ DefaultView: true, ViewFields: { Items: ['Status'] } }] });
            return Response.json({
                value: [{ Id: 1, FileLeafRef: 'a.txt', FileRef: `${LIB}/Sub/a.txt`, FSObjType: 0 }],
            });
        }) as typeof fetch;
        const data = await loadFolder(LIB, `${LIB}/Sub`);
        assert.deepEqual(data.view, ['Status']);
        assert.equal(data.items.length, 1);
        // a query scoped to the folder (POST, form digest first), no filter on the list (list view threshold)
        assert.ok(
            urls.some((u) =>
                /\/sites\/A\/_api\/web\/GetList\(@list\)\/GetItems\?.*@list='\/sites\/A\/Shared Documents'/.test(u),
            ),
        );
        assert.ok(!urls.some((u) => u.includes('$filter=FileDirRef')));
        assert.deepEqual(bodies.at(-1), {
            query: {
                ViewXml: '<View><RowLimit Paged="TRUE">5000</RowLimit></View>',
                FolderServerRelativeUrl: `${LIB}/Sub`,
            },
        });
        globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
        assert.equal(await loadFolder(LIB, LIB), 'fields: HTTP 500');
    });

    it('saving: per field the reason Sharepoint gives; refused request: every field', async () => {
        const bodies: unknown[] = [];
        globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
            if (String(url).endsWith('/_api/contextinfo')) return Response.json({ FormDigestValue: 'D' });
            bodies.push(JSON.parse(String(init.body)));
            return Response.json({
                value: [
                    { FieldName: 'Status', HasException: false },
                    { FieldName: 'Done', HasException: true, ErrorMessage: 'bad' },
                ],
            });
        }) as typeof fetch;
        const fields = FIELDS.map(toField);
        assert.deepEqual(await saveItem(LIB, 7, { Status: 'A', Done: '1' }, fields), { Done: 'bad' });
        assert.deepEqual(bodies[0], {
            formValues: [
                { FieldName: 'Status', FieldValue: 'A' },
                { FieldName: 'Done', FieldValue: '1' },
            ],
            bNewDocumentUpdate: false,
        });
        globalThis.fetch = (async (url: string | URL) =>
            String(url).endsWith('/_api/contextinfo')
                ? Response.json({ FormDigestValue: 'D' })
                : new Response('', { status: 423 })) as typeof fetch;
        assert.deepEqual(await saveItem(LIB, 7, { Status: 'A' }, fields), { Status: 'Not saved: HTTP 423' });
    });

    it("order of the items: sort in the address, else the view's (OrderBy), else by name", () => {
        const views = [
            {
                DefaultView: true,
                ViewQuery:
                    '<OrderBy><FieldRef Name="Modified" Ascending="FALSE" /><FieldRef Name="LinkFilename"/></OrderBy>',
            },
        ];
        const page = `${LIB}/Forms/AllItems.aspx`;
        assert.deepEqual(viewOrder(views, page, ''), [
            { col: 'Modified', dir: -1 },
            { col: NAME, dir: 1 },
        ]);
        assert.deepEqual(viewOrder(views, page, '?sortField=Status&isAscending=false'), [{ col: 'Status', dir: -1 }]);
        assert.deepEqual(viewOrder([{ DefaultView: true, ViewQuery: '' }], page, ''), [{ col: NAME, dir: 1 }]);
        assert.deepEqual(viewOrder([], page, ''), [{ col: NAME, dir: 1 }]);
    });

    it('items sorted as Sharepoint: numbers and dates as such, text any case (10 before 2); ties as sent', () => {
        const fields = [
            toField({ InternalName: NAME, TypeAsString: 'File' }),
            toField({ InternalName: 'N', TypeAsString: 'Number' }),
        ];
        const it = (id: number, name: string, n: number) =>
            toItem({ Id: id, FileLeafRef: name, FileRef: name, N: n }, fields);
        const items = [it(1, 'b2', 2), it(2, 'B10', 2), it(3, 'a', 10)];
        assert.deepEqual(
            sortItems(items, [{ col: NAME, dir: 1 }], fields).map((x: { name: string }) => x.name),
            ['a', 'B10', 'b2'],
        );
        assert.deepEqual(
            sortItems(items, [{ col: 'N', dir: -1 }], fields).map((x: { id: number }) => x.id),
            [3, 1, 2],
        );
        assert.deepEqual(
            sortItems(items, [{ col: 'Unknown', dir: 1 }], fields).map((x: { id: number }) => x.id),
            [1, 2, 3],
        );
    });

    it('entries of a folder (download): names, paths, folders; no properties read', async () => {
        const urls: string[] = [];
        globalThis.fetch = (async (url: string | URL) => {
            const u = decodeURIComponent(String(url));
            urls.push(u);
            if (u.endsWith('/_api/contextinfo')) return Response.json({ FormDigestValue: 'D' });
            return Response.json({
                value: [
                    { Id: 4, FileLeafRef: 'S', FileRef: `${LIB}/S`, FSObjType: 1 },
                    { Id: 5, FileLeafRef: 'x.txt', FileRef: `${LIB}/x.txt`, FSObjType: 0 },
                ],
            });
        }) as typeof fetch;
        assert.deepEqual(await loadEntries(LIB, LIB), [
            { name: 'S', path: `${LIB}/S`, folder: true },
            { name: 'x.txt', path: `${LIB}/x.txt`, folder: false },
        ]);
        assert.ok(urls.some((u) => u.includes('GetItems?$select=Id,FileLeafRef,FileRef,FSObjType&@list=')));
    });
});
