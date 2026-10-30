// Zen list data: fields, view and items of a library folder (REST reads), saving properties and names (REST write)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { formatBytes } from '../_core/util.ts';
import { getJson } from '../readers/api.ts';
import { postJson } from '../readers/api.ts';
import { quote } from '../readers/api.ts';
import { siteOf } from '../readers/api.ts';

import type { ZenData } from '../_core/types.ts';
import type { ZenEntry } from '../_core/types.ts';
import type { ZenField } from '../_core/types.ts';
import type { ZenItem } from '../_core/types.ts';

// ===========================================================================
// TYPES
// ===========================================================================

// Answers of Sharepoint (odata=nometadata); lists may come as { results: [...] } (verbose) as well
type Many<T> = T[] | { results?: T[] };
type FieldJson = {
    InternalName?: string;
    EntityPropertyName?: string;
    Title?: string;
    TypeAsString?: string;
    ReadOnlyField?: boolean;
    Choices?: Many<string>;
};
type ViewJson = {
    Id?: string;
    ServerRelativeUrl?: string;
    DefaultView?: boolean;
    ViewQuery?: string;
    ViewFields?: { Items?: Many<string> };
};
/** sort of a column: ascending (1) or descending (-1) */
type Order = { col: string; dir: number };
type ItemJson = Record<string, unknown> & { FieldValuesAsText?: Record<string, unknown> };
type FieldResult = { FieldName?: string; HasException?: boolean; ErrorMessage?: string | null };

// ===========================================================================
// CONSTANTS
// ===========================================================================

/** field of the name (FileLeafRef): first column, always shown; a change is a rename */
export const NAME = 'FileLeafRef';

// Fields of the view that stand for the name (or its icon): the name column takes their place
const NAME_FIELDS = new Set(['LinkFilename', 'LinkFilenameNoMenu', 'FileLeafRef', 'DocIcon']);

// Types whose values can be changed in the Zen list (others are shown only: people, lookups, terms, links, …)
const EDITABLE_TYPES = new Set(['Text', 'Note', 'Number', 'Currency', 'Choice', 'MultiChoice', 'Boolean', 'DateTime']);

// System fields: never changed here, even if Sharepoint lets them be written
const SYSTEM_FIELDS = new Set(['ContentType', 'ContentTypeId', 'FileLeafRef', 'CheckoutUser', 'ComplianceAssetId']);

// Fields of a file's size: Sharepoint's column (computed: no value over REST) and its source (a lookup);
// both filled from the file's length (File/Length)
const SIZE_FIELDS = new Set(['FileSizeDisplay', 'File_x0020_Size']);

const ITEMS_PAGE = 5000; // items per request (the list view threshold)
const MAX_ITEM_PAGES = 20;

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** @returns array of a list answer (nometadata or verbose) */
const many = <T>(x: Many<T> | undefined): T[] => (Array.isArray(x) ? x : (x?.results ?? []));

/** @returns key of a field in FieldValuesAsText (each `_` written `_x005f_`) */
export const textKeyOf = (name: string): string => name.replace(/_/g, '_x005f_');

/** @returns field as the Zen list uses it */
export function toField(f: FieldJson): ZenField | null {
    const name = f.InternalName;
    if (!name) return null;
    const type = f.TypeAsString ?? '';
    const editable = EDITABLE_TYPES.has(type) && !f.ReadOnlyField && !SYSTEM_FIELDS.has(name) && !name.startsWith('_');
    return {
        name,
        title: f.Title || name,
        type,
        entity: f.EntityPropertyName || name,
        textKey: textKeyOf(name),
        editable,
        choices: many(f.Choices),
    };
}

/** @returns text of a raw value (people, lookups, links, terms: their label) */
export function rawText(value: unknown): string {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(rawText).filter(Boolean).join('; ');
    if (typeof value === 'object') {
        const o = value as Record<string, unknown>;
        for (const k of ['Title', 'LookupValue', 'Label', 'Description', 'Url']) {
            if (typeof o[k] === 'string') return o[k] as string;
        }
        if ('results' in o) return rawText(o.results);
        return '';
    }
    return String(value);
}

/** @returns size of a file in bytes (File/Length, else File_x0020_Size), null for folders or if not known */
export function sizeOf(x: ItemJson): number | null {
    if (Number(x.FSObjType) === 1) return null;
    const file = x.File as { Length?: unknown } | null | undefined;
    const value = file?.Length ?? x.File_x0020_Size;
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * @returns colour given to an item in Sharepoint (field _ColorHex, built in: 1–15),
 * none (0 or empty: Sharepoint's default) as undefined
 */
export function colourOf(x: ItemJson): number | undefined {
    const n = Number(x.OData__ColorHex ?? x._ColorHex ?? 0);
    return Number.isInteger(n) && n >= 1 && n <= 15 ? n : undefined;
}

/** @returns item as the Zen list uses it */
export function toItem(x: ItemJson, fields: ZenField[]): ZenItem {
    const texts = x.FieldValuesAsText ?? {};
    const text: Record<string, string> = {};
    const raw: Record<string, unknown> = {};
    for (const f of fields) {
        const value = x[f.entity] ?? x[f.name];
        raw[f.name] = value;
        const shown = texts[f.textKey] ?? texts[f.name];
        text[f.name] = typeof shown === 'string' ? shown : rawText(value);
    }
    const bytes = sizeOf(x);
    for (const f of fields) {
        if (!SIZE_FIELDS.has(f.name)) continue;
        raw[f.name] = bytes ?? undefined;
        text[f.name] = bytes == null ? '' : formatBytes(bytes);
    }
    const name = String(x.FileLeafRef ?? text[NAME] ?? '');
    text[NAME] = name;
    raw[NAME] = name;
    return {
        id: Number(x.Id ?? x.ID),
        name,
        path: String(x.FileRef ?? ''),
        folder: Number(x.FSObjType) === 1,
        text,
        raw,
        colour: colourOf(x),
    };
}

/** @returns view of `page`, else the default one */
const viewOf = (views: ViewJson[], page: string): ViewJson | undefined =>
    views.find((v) => (v.ServerRelativeUrl ?? '').toLowerCase() === page.toLowerCase()) ??
    views.find((v) => v.DefaultView);

/** @returns fields of the view (name fields left out), the view of `page` or else the default one */
export function viewFields(views: ViewJson[], page: string, fields: ZenField[]): string[] {
    const view = viewOf(views, page);
    const known = new Set(fields.map((f) => f.name));
    return many(view?.ViewFields?.Items).filter((n) => !NAME_FIELDS.has(n) && known.has(n));
}

/**
 * Order of the items as in Sharepoint's list: the sort chosen there (address: sortField, isAscending),
 * else the view's (its query: OrderBy), else by name
 * @param search query of the page's address
 */
export function viewOrder(views: ViewJson[], page: string, search: string): Order[] {
    const col = (name: string) => (NAME_FIELDS.has(name) ? NAME : name);
    const params = new URLSearchParams(search);
    const field = params.get('sortField');
    if (field) return [{ col: col(field), dir: params.get('isAscending') === 'false' ? -1 : 1 }];
    const query = viewOf(views, page)?.ViewQuery ?? '';
    const orderBy = query.match(/<OrderBy[^>]*>([\s\S]*?)<\/OrderBy>/i)?.[1] ?? '';
    const order = [...orderBy.matchAll(/<FieldRef\b([^>]*)\/?>/gi)].flatMap((m) => {
        const name = m[1].match(/\bName\s*=\s*"([^"]+)"/i)?.[1];
        const desc = /\bAscending\s*=\s*"(false|0)"/i.test(m[1]);
        return name ? [{ col: col(name), dir: desc ? -1 : 1 }] : [];
    });
    return order.length ? order : [{ col: NAME, dir: 1 }];
}

/** @returns sort key of a value as Sharepoint orders it: numbers and dates as such, else the text shown */
function orderKey(item: ZenItem, col: string): string | number {
    const raw = item.raw[col];
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && /^\d{4}-\d\d-\d\dT/.test(raw)) return Date.parse(raw);
    return item.text[col] ?? '';
}

/** @returns items in the order given (columns not known: left out; ties: as Sharepoint sent them) */
export function sortItems(items: ZenItem[], order: Order[], fields: ZenField[]): ZenItem[] {
    const known = order.filter((o) => fields.some((f) => f.name === o.col));
    const text = new Intl.Collator(undefined, { sensitivity: 'base' }); // as Sharepoint: 10 before 2
    const cmp = (a: string | number, b: string | number) =>
        typeof a === 'number' && typeof b === 'number' ? a - b : text.compare(String(a), String(b));
    return items
        .map((item, i) => ({ item, i }))
        .sort((a, b) => {
            for (const o of known) {
                const c = cmp(orderKey(a.item, o.col), orderKey(b.item, o.col));
                if (c) return o.dir * c;
            }
            return a.i - b.i;
        })
        .map((x) => x.item);
}

/**
 * Reads fields (not hidden), views and the items of a folder (in the order of Sharepoint's list).
 * @param library server-relative @param folder server-relative, in the library
 * @returns data, or why not (refused, HTTP status, setting)
 */
export async function loadFolder(library: string, folder: string): Promise<ZenData | string> {
    const site = siteOf(library);
    const list = `${site}/_api/web/GetList(@list)`;
    const at = `@list=${encodeURIComponent(quote(library))}`;
    const fieldsUrl =
        `${list}/Fields?$filter=Hidden eq false` +
        `&$select=InternalName,EntityPropertyName,Title,TypeAsString,ReadOnlyField,Choices&${at}`;
    const viewsUrl = `${list}/Views?$select=Id,ServerRelativeUrl,DefaultView,ViewQuery&$expand=ViewFields&${at}`;
    const [listJson, fieldsJson, viewsJson] = await Promise.all([
        getJson<{ Title?: string }>(`${list}?$select=Title&${at}`),
        getJson<{ value?: FieldJson[] }>(fieldsUrl),
        getJson<{ value?: ViewJson[] }>(viewsUrl),
    ]);
    const title = (typeof listJson === 'string' ? '' : listJson?.Title) || (library.split('/').pop() ?? library);
    if (typeof fieldsJson === 'string') return `fields: ${fieldsJson}`;
    const fields = (fieldsJson?.value ?? []).flatMap((f) => toField(f) ?? []);
    if (!fields.some((f) => f.name === NAME))
        fields.unshift(toField({ InternalName: NAME, Title: 'Name', TypeAsString: 'File' }) as ZenField);
    const views = typeof viewsJson === 'string' ? [] : (viewsJson?.value ?? []);
    const page = decodeURIComponent(location.pathname);
    const view = viewFields(views, page, fields);
    const own = viewOf(views, page);

    const json = await folderItems(
        library,
        folder,
        '*,Id,FileLeafRef,FileRef,FSObjType,File/Length',
        'FieldValuesAsText,File',
    );
    if (typeof json === 'string') return `items: ${json}`;
    const order = viewOrder(views, page, location.search);
    const items = sortItems(
        json.map((x) => toItem(x, fields)),
        order,
        fields,
    );
    return {
        library,
        title,
        folder,
        fields,
        view: view.length ? view : defaultView(fields),
        viewId: own?.Id ?? null,
        viewAll: many(own?.ViewFields?.Items),
        items,
    };
}

/**
 * Items of a folder (JSON as Sharepoint answers): a query scoped to the folder (as Sharepoint's own list),
 * not a filter on the list (a filter on FileDirRef is refused in libraries above the list view threshold
 * of 5,000 items); pages by item id, in the default order (an order on a column could hit the threshold again)
 * @returns items, or why not
 */
async function folderItems(library: string, folder: string, select: string, expand = ''): Promise<ItemJson[] | string> {
    const site = siteOf(library);
    const at = `@list=${encodeURIComponent(quote(library))}`;
    const more = expand ? `&$expand=${expand}` : '';
    const url = `${site}/_api/web/GetList(@list)/GetItems?$select=${select}${more}&${at}`;
    const viewXml = `<View><RowLimit Paged="TRUE">${ITEMS_PAGE}</RowLimit></View>`;
    const items: ItemJson[] = [];
    let paging = '';
    for (let page = 0; page < MAX_ITEM_PAGES; page++) {
        const position = paging ? { ListItemCollectionPosition: { PagingInfo: paging } } : {};
        const query = { ViewXml: viewXml, FolderServerRelativeUrl: folder, ...position };
        const data = await postJson<{ value?: ItemJson[] }>(site, url, { query });
        if (typeof data === 'string') return data;
        const got = data?.value ?? [];
        items.push(...got);
        if (got.length < ITEMS_PAGE) break;
        paging = `Paged=TRUE&p_ID=${Number(got[got.length - 1].Id ?? got[got.length - 1].ID)}`;
    }
    return items;
}

/** @returns files and folders of a folder (name, path, folder or not; no properties), or why not */
export async function loadEntries(library: string, folder: string): Promise<ZenEntry[] | string> {
    const json = await folderItems(library, folder, 'Id,FileLeafRef,FileRef,FSObjType');
    if (typeof json === 'string') return json;
    return json.map((x) => ({
        name: String(x.FileLeafRef ?? ''),
        path: String(x.FileRef ?? ''),
        folder: Number(x.FSObjType) === 1,
    }));
}

// No view found: the editable fields, then Modified and Modified By
function defaultView(fields: ZenField[]): string[] {
    const names = fields.filter((f) => f.editable).map((f) => f.name);
    for (const n of ['Modified', 'Editor']) if (fields.some((f) => f.name === n)) names.push(n);
    return names;
}

// ---------------------------------------------------------------------------
// Saving: as Sharepoint's own form (ValidateUpdateListItem: checks each value, keeps versions)
// ---------------------------------------------------------------------------

/** @returns value as the form sends it (yes / no: 1 / 0; several choices: ;#a;#b;#) */
export function formValue(field: ZenField | undefined, value: string): string {
    if (field?.type === 'Boolean') return value === '1' || value === 'true' ? '1' : '0';
    if (field?.type === 'MultiChoice') {
        const parts = value
            .split(/;#|;/)
            .map((s) => s.trim())
            .filter(Boolean);
        return parts.length ? `;#${parts.join(';#')};#` : '';
    }
    return value;
}

/**
 * Saves changed values (a new name too: FileLeafRef) of one item.
 * @param values field -> value as edited
 * @returns per field the reason it was not saved (empty: all saved)
 */
export async function saveItem(
    library: string,
    id: number,
    values: Record<string, string>,
    fields: ZenField[],
): Promise<Record<string, string>> {
    const site = siteOf(library);
    const url =
        `${site}/_api/web/GetList(@list)/items(${id})/ValidateUpdateListItem` +
        `?@list=${encodeURIComponent(quote(library))}`;
    const formValues = Object.entries(values).map(([name, value]) => ({
        FieldName: name,
        FieldValue: formValue(
            fields.find((f) => f.name === name),
            value,
        ),
    }));
    const data = await postJson<{ value?: FieldResult[] }>(site, url, { formValues, bNewDocumentUpdate: false });
    const errors: Record<string, string> = {};
    if (typeof data === 'string') {
        for (const name of Object.keys(values)) errors[name] = `Not saved: ${data}`;
        return errors;
    }
    for (const r of data?.value ?? []) {
        if (r.HasException && r.FieldName) errors[r.FieldName] = r.ErrorMessage || 'Not saved';
    }
    return errors;
}

// ---------------------------------------------------------------------------
// Columns of the Sharepoint view (Upload of the columns pane)
// ---------------------------------------------------------------------------

/**
 * Writes the columns into the view (for everyone): its fields cleared, then added in order
 * (the name fields first, as they were); needs the right to manage the list
 * @param columns shown, in order (no name fields) @returns '' when done, else why not
 */
export async function uploadView(data: ZenData, columns: string[]): Promise<string> {
    if (!data.viewId) return 'no Sharepoint view found for this page';
    const site = siteOf(data.library);
    const at = `@list=${encodeURIComponent(quote(data.library))}`;
    const base = `${site}/_api/web/GetList(@list)/Views(guid'${data.viewId}')/ViewFields`;
    const names = [...data.viewAll.filter((n) => NAME_FIELDS.has(n)), ...columns];
    const cleared = await postJson<unknown>(site, `${base}/removeAllViewFields?${at}`, undefined);
    if (typeof cleared === 'string') return cleared;
    for (const n of names) {
        const added = await postJson<unknown>(site, `${base}/addViewField(${quote(n)})?${at}`, undefined);
        if (typeof added === 'string') return `${n}: ${added}`;
    }
    return '';
}
