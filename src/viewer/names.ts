// File names: checks, where an edit goes, another name (edited text: saved so; read only: a copy)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { formatOf } from '../readers/formats.ts';
import { readerOf } from '../readers/formats.ts';
import { encodePath } from '../readers/request.ts';
import { fileStamp } from '../readers/request.ts';
import { canWrite } from './edit.ts';
import { markEdited } from './edit.ts';
import { uploadable } from './edit.ts';
import { uploadFile } from './edit.ts';
import { showFile } from './open.ts';

import type { Target } from '../_core/types.ts';
import type { Viewer } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// SharePoint's rules for names (cf. https://support.microsoft.com/office/64883a5d-228e-48f5-b3d2-eb39e07630fa)
const BAD_CHARS = /["*:<>?/\\|]/;
const RESERVED = /^(?:\.lock|con|prn|aux|nul|com\d|lpt\d|desktop\.ini)$/i;
// Common binary types without a reader of their own (no text: never a new or edited file under such a name)
const BINARY_RE =
    /\.(?:png|jpe?g|gif|bmp|tiff?|webp|ico|heic|pdf|docx?|docm|pptx?|odt|odp|zip|7z|rar|gz|tgz|bz2|xz|tar|exe|dll|msi|bin|iso|dmg|mp[34]|m4a|wav|avi|mov|mkv|webm|woff2?|ttf|otf|sqlite|db|mdb|accdb|pbix)$/i;

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Names and targets
// ---------------------------------------------------------------------------

/** @returns why SharePoint would refuse the name; '' if it is fine */
export function nameProblem(name: string): string {
    if (!name.trim()) return 'Please enter a file name.';
    if (name !== name.trim()) return 'A file name may not start or end with a space.';
    if (BAD_CHARS.test(name)) return 'A file name may not contain any of " * : < > ? / \\ |';
    if (name.endsWith('.')) return 'A file name may not end with a full stop.';
    if (RESERVED.test(name) || name.startsWith('~$') || /_vti_/i.test(name))
        return `SharePoint does not allow the name "${name}".`;
    return '';
}

/** @returns why the name does not suit a text (new file, edited text); '' if it does */
export function textNameProblem(name: string): string {
    if (readerOf(formatOf(name)) === 'text' && !BINARY_RE.test(name)) return '';
    const ext = name.slice(name.lastIndexOf('.'));
    return `A ${ext} file is not plain text: please choose a text format (e.g. .txt, .csv, .json, .md).`;
}

/** @returns same name for SharePoint (it ignores case) */
export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** @param name another name (null: the file's own) @returns where the edit of the open file goes */
export function target(v: Viewer, name: string | null = v.newName ?? null): Target {
    const url = v.file?.url ?? '';
    const own = v.file?.name ?? '';
    const to = name ?? own;
    const isNew = !!v.source?.fresh || !sameName(to, own);
    return { name: to, url: `${url.slice(0, url.lastIndexOf('/'))}/${to}`, isNew };
}

/** Asks for the name of a new file in `folder` (checked; a name there already: asked) @returns name, or null */
export async function askName(folder: string): Promise<string | null> {
    let name = '';
    for (;;) {
        const given = prompt(`Name of the new file (in "${folder.split('/').pop()}"):`, name);
        if (given == null) return null;
        name = given.trim();
        const problem = nameProblem(name) || textNameProblem(name);
        if (problem) alert(problem);
        else if (await nameFree({ name, url: `${folder}/${name}`, isNew: true })) return name;
    }
}

/** New name: asks if a file of that name is there already (an upload replaces it); false = choose another */
export async function nameFree(t: Target): Promise<boolean> {
    if ((await fileStamp(t.url)) == null) return true;
    return confirm(
        `A file named "${t.name}" already exists in this folder.\n` +
            'Uploading under this name replaces it.\n\n' +
            'Keep this name?',
    );
}

// ---------------------------------------------------------------------------
// Title: name shown, renaming (click or F2: text files in write mode, read-only files any time)
// ---------------------------------------------------------------------------

/** @returns name can be changed: file in its own folder; text in write mode, read-only files (copy) any time */
export const renamable = (v: Viewer): boolean => !!(v.file && !v.linked && !v.busy && (v.writeMode || !canWrite(v)));

/** Title shows the name the edit goes to (files reached through a link keep their path) */
export function showName(v: Viewer): void {
    if (!v.file || v.linked) return;
    const t = target(v);
    const on = renamable(v);
    v.titleName.textContent = t.name;
    v.titleName.classList.toggle('tp-new-name', t.isNew);
    v.titleName.classList.toggle('tp-renamable', on);
    const notes = [
        t.url,
        !t.isNew
            ? ''
            : v.source?.fresh
              ? 'New file: in SharePoint once uploaded.'
              : `New file: "${v.file.name}" stays unchanged.`,
        !on
            ? ''
            : v.writeMode
              ? 'Click (or F2) to save under another name.'
              : 'Click (or F2) to upload a copy under another name.',
    ];
    v.titleName.title = notes.filter(Boolean).join('\n');
}

// Name edited in place of the title: Enter or leaving the box takes it (checked), Esc keeps the old one
export function startRename(v: Viewer): void {
    if (!renamable(v) || v.title.querySelector('.tp-name-input')) return;
    const input = document.createElement('input');
    input.className = 'tp-name-input';
    input.spellcheck = false;
    input.value = target(v).name;
    input.title = 'New name: Enter takes it, Esc keeps the old one. The original file stays unchanged.';
    v.titleName.hidden = true;
    v.titleName.after(input);
    input.focus();
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length); // name without extension, as file managers do

    let closed = false;
    let checking = false; // name being looked up
    const close = () => {
        closed = true;
        input.remove();
        v.titleName.hidden = false;
    };
    const take = async () => {
        if (closed || checking) return;
        const name = input.value.trim();
        if (sameName(name, target(v).name)) return close(); // unchanged
        const problem = nameProblem(name) || (v.writeMode ? textNameProblem(name) : '');
        if (problem) {
            alert(problem);
            return void input.focus();
        }
        const t = target(v, name);
        checking = true;
        input.disabled = true;
        const free = !t.isNew || (await nameFree(t));
        checking = false;
        if (closed) return;
        input.disabled = false;
        if (!free) return void input.focus();
        close();
        if (!v.writeMode) return void (t.isNew && copyAs(v, t)); // read only: a copy, right away
        v.newName = t.isNew ? name : null; // back to the own name (any case): the file itself
        markEdited(v); // saved with the text
        showName(v);
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            take();
        } else if (e.key === 'Escape') close(); // viewer's Esc leaves this box alone
    });
    input.addEventListener('blur', () => take());
}

// Read-only file (spreadsheet, Parquet, binary) under another name: uploaded unchanged as a copy, then shown
async function copyAs(v: Viewer, t: Target): Promise<void> {
    const file = v.file;
    if (!file || !uploadable(v) || !confirm(uploadQuestion(v, t, (await fileStamp(t.url)) != null))) return;
    let blob: Blob;
    try {
        const r = await fetch(encodePath(file.url), { credentials: 'same-origin', cache: 'reload' });
        if (!r.ok) throw new Error(`error ${r.status}`);
        blob = await r.blob();
    } catch (err) {
        return void alert(`The file could not be read: ${(err as Error).message}`);
    }
    const copy = new File([blob], t.name, { type: blob.type, lastModified: Date.now() });
    if ((await uploadFile(v, copy, t)) && v.file === file) showFile(t.name, t.url, true);
}

/** @returns text for the question before an upload under another name */
export function uploadQuestion(v: Viewer, t: Target, exists: boolean): string {
    const what = exists
        ? `"${t.name}" already exists in this folder and will be replaced.`
        : `A new file "${t.name}" will be uploaded.`;
    const original = v.source?.fresh ? '' : `\nThe original "${v.file?.name}" stays unchanged.`;
    return `${what}${original}\n\nUpload now?`;
}
