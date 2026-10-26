// File names: checks, where an edit goes, saving under another name (write mode)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { fileStamp } from '../readers/request.ts';
import { markEdited } from './edit.ts';

import type { Target } from '../_core/types.ts';
import type { Viewer } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// SharePoint's rules for names (cf. https://support.microsoft.com/office/64883a5d-228e-48f5-b3d2-eb39e07630fa)
const BAD_CHARS = /["*:<>?/\\|]/;
const RESERVED = /^(?:\.lock|con|prn|aux|nul|com\d|lpt\d|desktop\.ini)$/i;

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
        const problem = nameProblem(name);
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
// Title: name shown, renaming (write mode, click or F2)
// ---------------------------------------------------------------------------

/** @returns name can be changed (write mode, file in its own folder) */
export const renamable = (v: Viewer): boolean => !!(v.writeMode && v.file && !v.linked);

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
        on ? 'Click (or F2) to save under another name.' : '',
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
        const problem = nameProblem(name);
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

/** @returns text for the question before an upload under another name */
export function uploadQuestion(v: Viewer, t: Target, exists: boolean): string {
    const what = exists
        ? `"${t.name}" already exists in this folder and will be replaced by your text.`
        : `Your text will be uploaded as a new file "${t.name}".`;
    const original = v.source?.fresh ? '' : `\nThe original "${v.file?.name}" stays unchanged.`;
    return `${what}${original}\n\nUpload now?`;
}
