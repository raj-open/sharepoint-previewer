// Read / write mode

// ===========================================================================
// IMPORTS
// ===========================================================================

import { currentFolder } from '../_core/list.ts';
import { CSV_QUOTE_KEY } from '../_core/prefs.ts';
import { CSV_SEP_KEY } from '../_core/prefs.ts';
import { csvFormat } from '../_core/prefs.ts';
import { savePref } from '../_core/prefs.ts';
import { view } from '../_core/prefs.ts';
import { LARGE_FILE_BYTES } from '../_core/settings.ts';
import { fileStamp } from '../readers/request.ts';
import { csvSeparator } from '../text/highlight/csv.ts';
import { SEPARATOR_NAMES } from '../text/highlight/csv.ts';
import { listRegion } from './layout.ts';
import { showName } from './names.ts';
import { target } from './names.ts';
import { uploadQuestion } from './names.ts';
import { viewer } from './open.ts';
import { close3d } from './view3d.ts';

import type { Viewer } from '../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

export const canWrite = (v: Viewer): boolean =>
    !!(v.source && !v.source.isParquet && !v.source.isZip && !v.source.isSheet); // read only

export async function enterWrite(v: Viewer): Promise<void> {
    const src = v.source;
    if (!src || v.writeMode || !canWrite(v)) return;
    if (src.total > LARGE_FILE_BYTES) {
        alert(
            'This file is too large to edit in the previewer.\n' +
                'Please download it, edit it outside, and upload it again yourself.',
        );
        return;
    }
    if (!src.done) {
        if (!confirm('To edit, the whole file has to be cached first. Cache it now?')) return;
        if (!(await v.loadAll?.()) || !src.done) return;
    }
    close3d(v); // edits happen in text
    v.writeMode = true;
    v.dirty = false;
    showName(v); // name can be changed now
    v.uploadBtn.disabled = v.staged == null; // saved changes stay uploadable
    if (v.lang === 'csv' && view.table) {
        // CSV in table view: edit cells directly
        src.crlf = src.text.includes('\r\n');
        src.trailingNewline = /\n$/.test(src.text);
        v.tableEditing = true;
        setupCsvBar(v, csvSeparator(src.text));
        v.csvBar.style.display = 'flex';
        v.rerender?.(); // also shows chosen format in metadata
        v.saveBtn.disabled = true;
        if (csvFormat.sep || csvFormat.quote) markEdited(v); // remembered format: file changes when saved
        v.stopBtn.disabled = false;
        v.stopBtn.title = 'Cancel changes (Esc)';
        v.writeBtn.setAttribute('aria-pressed', 'true');
        return;
    }
    src.crlf = src.text.includes('\r\n'); // Windows line ends are restored on save
    v.editor.value = src.text;
    v.updateGutter();
    v.editorWrap.style.display = '';
    v.content.style.display = 'none';
    v.loadMoreBtn.style.display = 'none';
    v.saveBtn.disabled = true;
    v.stopBtn.disabled = false;
    v.stopBtn.title = 'Cancel changes (Esc)';
    v.writeBtn.setAttribute('aria-pressed', 'true');
    v.editor.focus();
}

// ---------------------------------------------------------------------------
// Pending: unsaved edits (v.dirty), saved not uploaded (v.staged)
// ---------------------------------------------------------------------------

// Ask before pending changes lost; false = user keeps them
export function confirmDiscard(v: Viewer): boolean {
    if (!v.dirty && v.staged == null) return true;
    const btn = v.dirty ? v.saveBtn : v.uploadBtn;
    flash(btn);
    const question = v.dirty
        ? 'You have unsaved changes. Discard them?'
        : 'Your saved changes have not been uploaded and will be lost. Discard them?';
    if (!confirm(question)) {
        flash(btn); // show where to click
        return false;
    }
    discardEdits(v);
    return true;
}

// Cancel (button, Esc): drop all changes (unsaved and saved) after asking, back to read view;
// false = user keeps them
export function cancelEdits(v: Viewer): boolean {
    if (!v.writeMode || !confirmDiscard(v)) return false;
    exitWriteView(v);
    return true;
}

// Drop pending changes; show file as cached
export function discardEdits(v: Viewer): void {
    const src = v.source;
    if (src && src.originalText != null) {
        src.text = src.originalText;
        src.originalText = null;
        src.lintResult = null;
        v.text = src.text;
    }
    v.dirty = false;
    v.staged = null;
    v.newName = null;
    v.stagedName = null;
    v.saveBtn.disabled = true;
    v.uploadBtn.disabled = true;
    showName(v);
}

// Back to read view (keeps saved changes, drops unsaved edits)
export function exitWriteView(v: Viewer): void {
    v.writeMode = false;
    v.dirty = false;
    v.newName = v.stagedName ?? null; // unsaved name dropped too
    showName(v);
    v.tableEditing = false;
    v.csvBar.style.display = 'none'; // metadata is redrawn by rerender below
    v.editorWrap.style.display = 'none';
    v.editor.value = '';
    v.content.style.display = '';
    v.saveBtn.disabled = true;
    v.uploadBtn.disabled = v.staged == null;
    v.stopBtn.title = 'Stop caching';
    v.stopBtn.disabled = !v.busy;
    v.writeBtn.setAttribute('aria-pressed', 'false');
    v.rerender?.();
}

// Text being edited: text box, or CSV table
export function editedText(v: Viewer): string {
    if (!v.tableEditing) return v.editor.value;
    return (v.lineView?.csvText?.() ?? '') + (v.source?.trailingNewline ? '\n' : '');
}

// Edited: save (again) before upload
export function markEdited(v: Viewer): void {
    v.dirty = true;
    v.saveBtn.disabled = false;
    v.uploadBtn.disabled = true;
}

// Draw attention to button: blue glow that fades out over 3 seconds
export function flash(btn: HTMLElement): void {
    btn.classList.remove('tp-attn');
    void btn.offsetWidth; // restart animation
    btn.classList.add('tp-attn');
    setTimeout(() => btn.classList.remove('tp-attn'), 3000);
}

// Upload as user would (drop, or SharePoint's upload dialogue); no API. HEAD request
// confirms change; otherwise user can save file locally. Under another name: a new file, the original stays.
/** @returns true once SharePoint has the new file */
export async function uploadEdits(v: Viewer, edited: string): Promise<boolean> {
    const src = v.source;
    if (!src || !v.file) return false;
    const url = v.file.url;
    const to = target(v, v.stagedName);
    const folder = currentFolder();
    const dir = url.slice(0, url.lastIndexOf('/'));
    if (v.linked || !folder || dir.toLowerCase() !== folder.toLowerCase()) {
        alert(
            'Uploading only works for a file in the folder that is open in SharePoint\n' +
                '(not for search results or files reached through a link).\n' +
                "Open the file's folder and upload from there.",
        );
        return false;
    }
    if (
        src.encoding &&
        src.encoding !== 'UTF-8' &&
        !confirm(`This file is ${src.encoding}. It will be uploaded as UTF-8. Continue?`)
    ) {
        return false;
    }
    if (to.isNew && !confirm(uploadQuestion(v, to, (await fileStamp(to.url)) != null))) return false;

    let text = edited;
    if (src.crlf) text = text.replace(/\r?\n/g, '\r\n');
    const file = new File([src.bom ? `﻿${text}` : text], to.isNew ? to.name : (v.fileName ?? v.file.name), {
        type: 'text/plain',
        lastModified: Date.now(),
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);

    // How file looks on SharePoint right now (none: new file); upload changes this
    const stamp = () => fileStamp(to.url);
    const before = await stamp();
    // Watch for SharePoint to change file (it may first ask "replace?"): up to `ms`
    const changed = async (ms: number) => {
        for (const end = Date.now() + ms; Date.now() < end; ) {
            await new Promise((r) => setTimeout(r, 1500));
            const now = await stamp();
            if (now && now !== before) return true;
        }
        return false;
    };

    v.uploadBtn.disabled = true;
    v.uploadBtn.title = 'Upload in progress …';
    let done = false;

    // 1. Like drop into file list
    const list = listRegion()?.card || document.querySelector('[role="grid"], [role="treegrid"]');
    if (list) {
        const r = list.getBoundingClientRect();
        const at = { clientX: r.left + r.width / 2, clientY: r.top + Math.min(r.height / 2, 200) };
        for (const type of ['dragenter', 'dragover', 'drop']) {
            list.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, ...at }));
        }
        done = await changed(20000);
    }

    // 2. Like choice in SharePoint's own upload dialogue
    if (!done) {
        const input = [...document.querySelectorAll('input[type="file"]')].find((i) => !i.closest('.tp-viewer'));
        if (input) {
            (input as HTMLInputElement).files = transfer.files;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            done = await changed(20000);
        }
    }

    v.uploadBtn.title = 'Upload the saved changes to SharePoint';
    if (!done) {
        v.uploadBtn.disabled = false;
        // 3. user does it: edited file is saved locally, ready to drag into folder
        if (
            confirm(
                'SharePoint did not take the file automatically.\n\n' +
                    'Download the edited file now, so you can drag it into the folder yourself?\n' +
                    '(Your saved changes stay in the viewer until an upload is confirmed.)',
            )
        ) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(file);
            a.download = file.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        }
        return false;
    }

    if (to.isNew) return true; // original unchanged: the caller opens the new file
    // Confirmed: uploaded text is file from now on
    src.text = text;
    src.originalText = null;
    v.text = text;
    src.lintResult = null;
    return true;
}

/** Page-wide edit guards: Ctrl+S / Cmd+S saves, unsaved changes ask before leaving. */
export function guardEdits(): void {
    // Ctrl+S / Cmd+S: save (not upload)
    document.addEventListener(
        'keydown',
        (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's' || !viewer?.writeMode) return;
            e.preventDefault(); // no "save page" dialogue
            if (!viewer.saveBtn.disabled) viewer.saveBtn.click(); // upload is separate step
        },
        true,
    );

    // Unsaved changes: browser asks before page is left
    window.addEventListener('beforeunload', (e) => {
        if (viewer && (viewer.dirty || viewer.staged != null)) e.preventDefault();
    });
}

// Fill and wires delimiter / quote selects; `fileSep` is file's own delimiter
function setupCsvBar(v: Viewer, fileSep: string): void {
    const sepSel = v.csvBar.querySelector('.tp-csv-sep') as HTMLSelectElement; // in the bar's HTML
    const quoteSel = v.csvBar.querySelector('.tp-csv-quote') as HTMLSelectElement;
    const fill = () => {
        sepSel.innerHTML =
            `<option value="">Delimiter: as in the file (${SEPARATOR_NAMES[fileSep]})</option>` +
            Object.entries(SEPARATOR_NAMES)
                .map(([x, n]) => `<option value="${x}">Delimiter: ${n}</option>`)
                .join('');
        sepSel.value = csvFormat.sep;
        quoteSel.value = csvFormat.quote;
    };
    fill();
    const changed = () => {
        savePref(CSV_SEP_KEY, csvFormat.sep);
        savePref(CSV_QUOTE_KEY, csvFormat.quote);
        fill();
        markEdited(v);
        v.updateMeta?.();
    };
    sepSel.onchange = () => {
        csvFormat.sep = sepSel.value;
        changed();
    };
    quoteSel.onchange = () => {
        csvFormat.quote = quoteSel.value;
        changed();
    };
}
