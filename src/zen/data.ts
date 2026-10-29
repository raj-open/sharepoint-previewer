// Zen list data: fields, view and items of a library folder (REST reads), saving properties and names (REST write)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { getJson } from '../readers/api.ts';
import { postJson } from '../readers/api.ts';
import { quote } from '../readers/api.ts';
import { siteOf } from '../readers/api.ts';

import type { ZenData } from '../_core/types.ts';
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
type ViewJson = { ServerRelativeUrl?: string; DefaultView?: boolean; ViewFields?: { Items?: Many<string> } };
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
    };
}

/** @returns fields of the view (name fields left out), the view of `page` or else the default one */
export function viewFields(views: ViewJson[], page: string, fields: ZenField[]): string[] {
    const lower = page.toLowerCase();
    const view =
        views.find((v) => (v.ServerRelativeUrl ?? '').toLowerCase() === lower) ?? views.find((v) => v.DefaultView);
    const known = new Set(fields.map((f) => f.name));
    return many(view?.ViewFields?.Items).filter((n) => !NAME_FIELDS.has(n) && known.has(n));
}

/**
 * Reads fields (not hidden), views and the items of a folder.
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
    const viewsUrl = `${list}/Views?$select=ServerRelativeUrl,DefaultView&$expand=ViewFields&${at}`;
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
    const view =
        typeof viewsJson === 'string'
            ? []
            : viewFields(viewsJson?.value ?? [], decodeURIComponent(location.pathname), fields);

    // Items of the folder: a query scoped to the folder (as Sharepoint's own list), not a filter on the list
    // (a filter on FileDirRef is refused in libraries above the list view threshold of 5,000 items);
    // pages by item id, in the default order (an order on a column could hit the threshold again)
    const items: ZenItem[] = [];
    const url = `${list}/GetItems?$select=*,Id,FileLeafRef,FileRef,FSObjType&$expand=FieldValuesAsText&${at}`;
    const viewXml = `<View><RowLimit Paged="TRUE">${ITEMS_PAGE}</RowLimit></View>`;
    let paging = '';
    for (let page = 0; page < MAX_ITEM_PAGES; page++) {
        const position = paging ? { ListItemCollectionPosition: { PagingInfo: paging } } : {};
        const query = { ViewXml: viewXml, FolderServerRelativeUrl: folder, ...position };
        const data = await postJson<{ value?: ItemJson[] }>(site, url, { query });
        if (typeof data === 'string') return `items: ${data}`;
        const got = data?.value ?? [];
        for (const x of got) items.push(toItem(x, fields));
        if (got.length < ITEMS_PAGE) break;
        paging = `Paged=TRUE&p_ID=${items[items.length - 1].id}`;
    }
    return { library, title, folder, fields, view: view.length ? view : defaultView(fields), items };
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
