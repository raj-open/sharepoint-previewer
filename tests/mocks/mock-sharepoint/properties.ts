// Mock Sharepoint: properties of the library items (columns of a document library) and their REST API,
// as far as the userscript's Zen mode uses it: fields, views, items of a folder (with FieldValuesAsText),
// form digest, ValidateUpdateListItem (values checked as Sharepoint's form does; renames of files),
// recycle and deleteObject (files and folders deleted: to the recycle bin, or for good;
// either way left out of all listings and requests for the session), the view's fields written (removeAllViewFields,
// addViewField: kept for the session).
// Values start made up (the same each time, from the path); changes are kept per session of simulated uploads
// (<uploads>/.properties.json), as uploads are, and never touch the files on disk.

import fs from 'node:fs';
import path from 'node:path';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

// Entry of a folder listing (cf. server.ts)
export type Entry = { name: string; folder: boolean; size: number; author?: string; uploaded?: boolean };
// Changes of a session: values per original path, renamed files (new path -> original path),
// items deleted (paths as named then; folders with all below them), fields of the views as written (per library)
export type Store = {
    values: Record<string, Record<string, Value>>;
    renamed: Record<string, string>;
    deleted: string[];
    views?: Record<string, string[]>;
};
type Value = string | number | boolean | null;
type Field = {
    InternalName: string;
    EntityPropertyName: string;
    Title: string;
    TypeAsString: string;
    ReadOnlyField: boolean;
    Choices?: string[];
};
// Answer: HTTP status and JSON
export type Answer = { status: number; data: unknown };

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

const STATUS = ['Draft', 'In review', 'Approved', 'Archived'];
const TAGS = ['Finance', 'Engineering', 'Legal', 'Operations'];
const OWNERS = ['Ada Lindqvist', 'Bruno Keller', 'Chiara Rossi', 'Dev Patel', 'Emma Novak'];
const MODIFIED = '2026-10-01T12:00:00Z';

const field = (
    InternalName: string,
    Title: string,
    TypeAsString: string,
    ReadOnlyField = false,
    Choices?: string[],
): Field => ({
    InternalName,
    EntityPropertyName: InternalName,
    Title,
    TypeAsString,
    ReadOnlyField,
    ...(Choices ? { Choices } : {}),
});

// Fields not hidden, as a document library with some own columns has them
export const FIELDS: Field[] = [
    field('FileLeafRef', 'Name', 'File'),
    field('Title', 'Title', 'Text'),
    field('Modified', 'Modified', 'DateTime', true),
    field('Editor', 'Modified By', 'User', true),
    field('File_x0020_Size', 'File Size', 'Lookup', true),
    field('Status', 'Status', 'Choice', false, STATUS),
    field('Priority', 'Priority', 'Number'),
    field('Due', 'Due', 'DateTime'),
    field('Reviewed', 'Reviewed', 'Boolean'),
    field('Tags', 'Tags', 'MultiChoice', false, TAGS),
    field('Notes', 'Notes', 'Note'),
    field('Owner', 'Owner', 'User'),
    field('ID', 'ID', 'Counter', true),
    field('_UIVersionString', 'Version', 'Text', true),
];

// Columns of the library's view (AllItems.aspx), as Sharepoint lists them (icon and name first)
export const VIEW_FIELDS = [
    'DocIcon',
    'LinkFilename',
    'Modified',
    'Editor',
    'File_x0020_Size',
    'Status',
    'Priority',
    'Due',
    'Reviewed',
];

export const DIGEST = '0x4D4F434B,28 Oct 2026 12:00:00 -0000'; // form digest of the mock (any session)
export const VIEW_ID = '4d6f636b-0000-4000-8000-000000000001'; // id of the library's view (AllItems.aspx)
const STORE = '.properties.json';
const BAD_NAME = /["*:<>?/\\|]/;

// ----------------------------------------------------------------
// Session store
// ----------------------------------------------------------------

export function loadStore(uploads?: string): Store {
    const empty: Store = { values: {}, renamed: {}, deleted: [] };
    try {
        if (uploads) return { ...empty, ...JSON.parse(fs.readFileSync(path.join(uploads, STORE), 'utf8')) };
    } catch {}
    return empty;
}

export function saveStore(uploads: string, store: Store): void {
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, STORE), JSON.stringify(store, null, 2));
}

/** @returns path of the file on disk (renamed: its original) */
export const originalOf = (store: Store, p: string): string => store.renamed[p] ?? p;

/** @returns a file renamed away (its old path no longer exists) */
export const renamedAway = (store: Store, p: string): boolean => Object.values(store.renamed).includes(p);

/** @returns path deleted in this session (or in a folder deleted) */
export const deletedAway = (store: Store, p: string): boolean =>
    store.deleted.some((d) => p.toLowerCase() === d.toLowerCase() || p.toLowerCase().startsWith(`${d.toLowerCase()}/`));

/** Folders and entries deleted in this session left out (cf. recycle) */
export function applyDeletes(store: Store, tree: Record<string, Entry[]>): void {
    for (const folder of Object.keys(tree)) {
        if (deletedAway(store, folder)) delete tree[folder];
        else tree[folder] = tree[folder].filter((e) => !deletedAway(store, `${folder}/${e.name}`));
    }
}

/** Entries of a folder with the names given in this session */
export function applyRenames(store: Store, folder: string, entries: Entry[]): void {
    for (const [to, from] of Object.entries(store.renamed)) {
        if (from.slice(0, from.lastIndexOf('/')) !== folder) continue;
        const e = entries.find((x) => x.name === from.slice(folder.length + 1) && !x.folder);
        if (e) e.name = to.slice(folder.length + 1);
    }
}

// ----------------------------------------------------------------
// Values
// ----------------------------------------------------------------

function hash(s: string): number {
    let h = 0;
    for (const c of s) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
    return h;
}

/** @param orig original path @returns list item id (the same each time) */
export const idOf = (orig: string): number => (hash(orig) % 900000) + 100;

// Made up values of an item (folders: own columns empty)
function startValues(orig: string, e: Entry): Record<string, Value> {
    const h = hash(orig);
    const own = e.folder
        ? { Status: null, Priority: null, Due: null, Reviewed: false, Tags: null, Notes: null, Owner: null }
        : {
              Status: STATUS[h % STATUS.length],
              Priority: (h % 5) + 1,
              Due: `2026-11-${String((h % 28) + 1).padStart(2, '0')}T00:00:00Z`,
              Reviewed: h % 3 === 0,
              Tags: h % 4 ? `;#${TAGS[h % TAGS.length]};#` : null,
              Notes: h % 2 ? null : `Checked by ${OWNERS[(h >>> 3) % OWNERS.length]}`,
              Owner: OWNERS[(h >>> 5) % OWNERS.length],
          };
    return {
        Title: null,
        Modified: MODIFIED,
        Editor: e.author ?? '',
        File_x0020_Size: e.folder ? null : e.size,
        ...own,
    };
}

const two = (n: number) => String(n).padStart(2, '0');

// Text as Sharepoint shows it (regional settings of the mock: day/month/year, 24 hours)
function textOf(f: Field, v: Value): string {
    if (v == null || v === '') return '';
    if (f.TypeAsString === 'DateTime') {
        const d = new Date(String(v));
        const date = `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
        return f.InternalName === 'Due' ? date : `${date} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
    }
    if (f.TypeAsString === 'Boolean') return v ? 'Yes' : 'No';
    if (f.TypeAsString === 'MultiChoice') return String(v).split(';#').filter(Boolean).join('; ');
    return String(v);
}

/** @returns key in FieldValuesAsText (each `_` written `_x005f_`) */
const textKey = (name: string): string => name.replace(/_/g, '_x005f_');

function itemJson(store: Store, folder: string, e: Entry): Record<string, unknown> {
    const p = `${folder}/${e.name}`;
    const orig = originalOf(store, p);
    const values = { ...startValues(orig, e), ...(store.values[orig] ?? {}) };
    const id = idOf(orig);
    const raw: Record<string, unknown> = {
        Id: id,
        ID: id,
        FileLeafRef: e.name,
        FileRef: p,
        FileDirRef: folder,
        FSObjType: e.folder ? 1 : 0,
        _UIVersionString: store.values[orig] ? '2.0' : '1.0',
    };
    const texts: Record<string, string> = {};
    for (const f of FIELDS) {
        const v = f.InternalName in raw ? (raw[f.InternalName] as Value) : (values[f.InternalName] ?? null);
        if (!['Editor', 'Owner'].includes(f.InternalName)) raw[f.EntityPropertyName] = v;
        texts[textKey(f.InternalName)] = textOf(f, v);
    }
    return { ...raw, FieldValuesAsText: texts };
}

// ----------------------------------------------------------------
// REST answers
// ----------------------------------------------------------------

export const fieldsAnswer = (): Answer => ({ status: 200, data: { value: FIELDS } });

export const viewsAnswer = (library: string, store: Store): Answer => ({
    status: 200,
    data: {
        value: [
            {
                Id: VIEW_ID,
                ServerRelativeUrl: `${library}/Forms/AllItems.aspx`,
                DefaultView: true,
                ViewQuery: '<OrderBy><FieldRef Name="FileLeafRef" /></OrderBy>', // as Sharepoint's All Documents
                ViewFields: { Items: store.views?.[library.toLowerCase()] ?? VIEW_FIELDS },
            },
        ],
    },
});

/** @param tree folders -> entries (names as renamed) @returns items of the folder, by id (as Sharepoint: not sorted) */
export function itemsAnswer(tree: Record<string, Entry[]>, folder: string, store: Store): Answer {
    const entries = tree[folder];
    if (!entries) return { status: 200, data: { value: [] } };
    const items = entries.map((e) => itemJson(store, folder, e)).sort((a, b) => Number(a.Id) - Number(b.Id));
    return { status: 200, data: { value: items } };
}

/** @returns error as Sharepoint answers it */
const spError = (status: number, message: string): Answer => ({
    status,
    data: {
        'odata.error': { code: '-1, Microsoft.SharePoint.SPException', message: { lang: 'en-US', value: message } },
    },
});

/** @returns item of that id: its folder and entry */
function itemOf(tree: Record<string, Entry[]>, store: Store, id: number): { folder: string; e: Entry } | undefined {
    return Object.entries(tree).flatMap(([folder, entries]) =>
        entries.filter((e) => idOf(originalOf(store, `${folder}/${e.name}`)) === id).map((e) => ({ folder, e })),
    )[0];
}

export const contextAnswer = (): Answer => ({
    status: 200,
    data: { FormDigestValue: DIGEST, FormDigestTimeoutSeconds: 1800 },
});

// Value as the form gives it -> value kept; or why it is refused (messages as Sharepoint's)
function parse(f: Field, text: string): { value: Value } | { error: string } {
    const t = text.trim();
    if (
        f.ReadOnlyField ||
        !['Text', 'Note', 'Number', 'Choice', 'MultiChoice', 'Boolean', 'DateTime'].includes(f.TypeAsString)
    )
        return { error: 'The field is read only.' };
    if (!t) return { value: f.TypeAsString === 'Boolean' ? false : null };
    switch (f.TypeAsString) {
        case 'Number': {
            const n = Number(t.replace(/,/g, ''));
            return Number.isFinite(n) ? { value: n } : { error: 'Only numbers can go here.' };
        }
        case 'Boolean':
            return ['1', '0', 'true', 'false'].includes(t.toLowerCase())
                ? { value: t === '1' || t.toLowerCase() === 'true' }
                : { error: 'Invalid value.' };
        case 'Choice':
            return f.Choices?.includes(t) ? { value: t } : { error: 'Value does not fall within the expected range.' };
        case 'MultiChoice': {
            const parts = t.split(';#').filter(Boolean);
            return parts.every((x) => f.Choices?.includes(x))
                ? { value: `;#${parts.join(';#')};#` }
                : { error: 'Value does not fall within the expected range.' };
        }
        case 'DateTime': {
            const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}))?$/.exec(t);
            const d = m && new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0)));
            if (!m || !d || d.getUTCDate() !== +m[1])
                return { error: 'You must specify a valid date within the range of 1/1/1900 and 12/31/8900.' };
            return { value: d.toISOString().replace('.000', '') };
        }
        default:
            return t.length > 255 && f.TypeAsString === 'Text'
                ? { error: 'The value of this field may not exceed 255 characters.' }
                : { value: t };
    }
}

/**
 * ValidateUpdateListItem: values checked one by one; those that pass are kept (renames: files only).
 * @param uploads session folder (none: refused, as uploads are)
 */
export function validateUpdate(
    tree: Record<string, Entry[]>,
    id: number,
    body: Buffer | undefined,
    digest: string | undefined,
    uploads: string | undefined,
): Answer {
    const error = spError;
    if (digest !== DIGEST)
        return error(403, 'The security validation for this page is invalid and might be corrupted.');
    if (!uploads) return error(405, 'Changes are not simulated here.');
    let formValues: { FieldName: string; FieldValue: string }[] = [];
    try {
        formValues = JSON.parse(String(body ?? '{}')).formValues ?? [];
    } catch {
        return error(400, 'Invalid JSON.');
    }
    const store = loadStore(uploads);
    const found = itemOf(tree, store, id);
    if (!found) return error(404, 'Item does not exist. It may have been deleted by another user.');
    const { folder, e } = found;
    const p = `${folder}/${e.name}`;
    const orig = originalOf(store, p);
    const results = formValues.map(({ FieldName, FieldValue }) => {
        const result = {
            FieldName,
            FieldValue,
            HasException: false,
            ErrorCode: 0,
            ErrorMessage: null as string | null,
            ItemId: id,
        };
        const fail = (msg: string) =>
            Object.assign(result, { HasException: true, ErrorCode: -2146232832, ErrorMessage: msg });
        if (FieldName === 'FileLeafRef') {
            const name = String(FieldValue ?? '').trim();
            if (!name || BAD_NAME.test(name) || name.endsWith('.')) return fail('The file name is invalid.');
            if (e.folder) return fail('Renaming folders is not simulated.');
            const taken = tree[folder].some((x) => x !== e && x.name.toLowerCase() === name.toLowerCase());
            if (taken) return fail(`A file with the name "${name}" already exists.`);
            delete store.renamed[p];
            if (name !== orig.slice(folder.length + 1)) store.renamed[`${folder}/${name}`] = orig;
            e.name = name;
            return result;
        }
        const f = FIELDS.find((x) => x.InternalName === FieldName);
        if (!f) return fail(`Column '${FieldName}' does not exist.`);
        const parsed = parse(f, String(FieldValue ?? ''));
        if ('error' in parsed) return fail(parsed.error);
        store.values[orig] = { ...(store.values[orig] ?? {}), [FieldName]: parsed.value };
        return result;
    });
    if (results.some((r) => !r.HasException)) {
        // as Sharepoint: a new version, modified now by the signed-in user
        store.values[orig] = { ...(store.values[orig] ?? {}), Modified: new Date().toISOString(), Editor: 'Test User' };
    }
    saveStore(uploads, store);
    return { status: 200, data: { value: results } };
}

/**
 * recycle() / deleteObject(): the item (a folder with all below it) to the recycle bin or for good,
 * i.e. gone for the session
 * @param uploads session folder (none: refused, as uploads are)
 * @param purge deleteObject() (for good)
 * @returns id of the recycle bin item (a GUID); purged: odata.null, as Sharepoint
 */
export function recycle(
    tree: Record<string, Entry[]>,
    id: number,
    digest: string | undefined,
    uploads: string | undefined,
    purge = false,
): Answer {
    if (digest !== DIGEST)
        return spError(403, 'The security validation for this page is invalid and might be corrupted.');
    if (!uploads) return spError(405, 'Changes are not simulated here.');
    const store = loadStore(uploads);
    const found = itemOf(tree, store, id);
    if (!found) return spError(404, 'Item does not exist. It may have been deleted by another user.');
    store.deleted.push(`${found.folder}/${found.e.name}`);
    saveStore(uploads, store);
    if (purge) return { status: 200, data: { 'odata.null': true } };
    const hex = id.toString(16).padStart(12, '0');
    return { status: 200, data: { value: `00000000-0000-4000-8000-${hex}` } };
}

/**
 * Fields of the view written: all removed (removeAllViewFields), or one added at the end (addViewField)
 * @param add field to add (null: all removed) @param uploads session folder (none: refused, as uploads are)
 */
export function writeView(
    library: string,
    add: string | null,
    digest: string | undefined,
    uploads: string | undefined,
): Answer {
    if (digest !== DIGEST)
        return spError(403, 'The security validation for this page is invalid and might be corrupted.');
    if (!uploads) return spError(405, 'Changes are not simulated here.');
    const store = loadStore(uploads);
    if (add != null && !FIELDS.some((f) => f.InternalName === add) && !VIEW_FIELDS.includes(add))
        return spError(400, `Column '${add}' does not exist.`);
    const key = library.toLowerCase();
    const now = store.views?.[key] ?? VIEW_FIELDS;
    store.views = { ...store.views, [key]: add == null ? [] : [...now.filter((n) => n !== add), add] };
    saveStore(uploads, store);
    return { status: 200, data: { 'odata.null': true } };
}
