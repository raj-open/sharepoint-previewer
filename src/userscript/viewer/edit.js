import { currentFolder } from '../list.js';
import { CSV_QUOTE_KEY, CSV_SEP_KEY, csvFormat, savePref, view } from '../prefs.js';
import { LARGE_FILE_BYTES } from '../settings.js';
import { csvSeparator, SEPARATOR_NAMES } from '../text/highlight/csv.js';
import { listRegion } from './layout.js';
import { viewer } from './open.js';
import { close3d } from './view3d.js';

/** @typedef {import('../types.js').Viewer} Viewer */

// ---------------------------------------------------------------------------
// Read / write mode
// ---------------------------------------------------------------------------

/** @param {Viewer} v @returns {boolean} */
export const canWrite = (v) => !!(v.source && !v.source.isParquet && !v.source.isZip && !v.source.isSheet); // read only

/** @param {Viewer} v @returns {Promise<void>} */
export async function enterWrite(v) {
  const src = v.source;
  if (v.writeMode || !canWrite(v)) return;
  if (src.total > LARGE_FILE_BYTES) {
    alert(
      'This file is too large to edit in the previewer.\n' +
        'Please download it, edit it outside, and upload it again yourself.',
    );
    return;
  }
  if (!src.done) {
    if (!confirm('To edit, the whole file has to be cached first. Cache it now?')) return;
    if (!(await v.loadAll()) || !src.done) return;
  }
  close3d(v); // edits happen in text
  v.writeMode = true;
  v.dirty = false;
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
    v.stopBtn.title = 'Cancel changes';
    v.readBtn.setAttribute('aria-pressed', 'false');
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
  v.stopBtn.title = 'Cancel changes';
  v.readBtn.setAttribute('aria-pressed', 'false');
  v.writeBtn.setAttribute('aria-pressed', 'true');
  v.editor.focus();
}

// Pending: unsaved edits (v.dirty), saved not uploaded (v.staged)

// Ask before pending changes lost; false = user keeps them
/** @param {Viewer} v @returns {boolean} */
export function confirmDiscard(v) {
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

// Drop pending changes; show file as cached
/** @param {Viewer} v @returns {void} */
export function discardEdits(v) {
  const src = v.source;
  if (src && src.originalText != null) {
    src.text = src.originalText;
    src.originalText = null;
    src.lintResult = null;
    v.text = src.text;
  }
  v.dirty = false;
  v.staged = null;
  v.saveBtn.disabled = true;
  v.uploadBtn.disabled = true;
}

// Back to read view (keeps saved changes, drops unsaved edits)
/** @param {Viewer} v @returns {void} */
export function exitWriteView(v) {
  v.writeMode = false;
  v.dirty = false;
  v.tableEditing = false;
  v.csvBar.style.display = 'none'; // metadata is redrawn by rerender below
  v.editorWrap.style.display = 'none';
  v.editor.value = '';
  v.content.style.display = '';
  v.saveBtn.disabled = true;
  v.uploadBtn.disabled = v.staged == null;
  v.stopBtn.title = 'Stop caching';
  v.stopBtn.disabled = !v.busy;
  v.readBtn.setAttribute('aria-pressed', 'true');
  v.writeBtn.setAttribute('aria-pressed', 'false');
  v.rerender?.();
}

// Text being edited: text box, or CSV table
/** @param {Viewer} v @returns {string} */
export function editedText(v) {
  return v.tableEditing ? v.lineView.csvText() + (v.source.trailingNewline ? '\n' : '') : v.editor.value;
}

// Edited: save (again) before upload
/** @param {Viewer} v @returns {void} */
export function markEdited(v) {
  v.dirty = true;
  v.saveBtn.disabled = false;
  v.uploadBtn.disabled = true;
}

// Draw attention to button: blue glow that fades out over 3 seconds
/** @param {HTMLElement} btn @returns {void} */
export function flash(btn) {
  btn.classList.remove('tp-attn');
  void btn.offsetWidth; // restart animation
  btn.classList.add('tp-attn');
  setTimeout(() => btn.classList.remove('tp-attn'), 3000);
}

// Upload as user would (drop, or SharePoint's upload dialogue); no API. HEAD request
// confirms change; otherwise user can save file locally.
/** @param {Viewer} v @param {string} edited @returns {Promise<boolean>} true once SharePoint has the new file */
export async function uploadEdits(v, edited) {
  const src = v.source;
  const url = v.file.url;
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

  let text = edited;
  if (src.crlf) text = text.replace(/\r?\n/g, '\r\n');
  const file = new File([src.bom ? `﻿${text}` : text], v.fileName, {
    type: 'text/plain',
    lastModified: Date.now(),
  });
  const transfer = new DataTransfer();
  transfer.items.add(file);

  // How file looks on SharePoint right now; upload changes this
  const fetchUrl = url.split('/').map(encodeURIComponent).join('/');
  const stamp = async () => {
    try {
      const r = await fetch(fetchUrl, { method: 'HEAD', credentials: 'same-origin', cache: 'reload' });
      return r.ok
        ? `${r.headers.get('etag')}|${r.headers.get('last-modified')}|${r.headers.get('content-length')}`
        : null;
    } catch {
      return null;
    }
  };
  const before = await stamp();
  // Watch for SharePoint to change file (it may first ask "replace?"): up to `ms`
  const changed = async (ms) => {
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
  const target = listRegion() || document.querySelector('[role="grid"], [role="treegrid"]');
  if (target) {
    const r = target.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + Math.min(r.height / 2, 200) };
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, ...at }));
    }
    done = await changed(20000);
  }

  // 2. Like choice in SharePoint's own upload dialogue
  if (!done) {
    const input = [...document.querySelectorAll('input[type="file"]')].find((i) => !i.closest('.tp-viewer'));
    if (input) {
      input.files = transfer.files;
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
      a.download = v.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    return false;
  }

  // Confirmed: uploaded text is file from now on
  src.text = text;
  src.originalText = null;
  v.text = text;
  src.lintResult = null;
  return true;
}

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

// Fill and wires delimiter / quote selects; `fileSep` is file's own delimiter
/** @param {Viewer} v @param {string} fileSep @returns {void} */
function setupCsvBar(v, fileSep) {
  const sepSel = v.csvBar.querySelector('.tp-csv-sep');
  const quoteSel = v.csvBar.querySelector('.tp-csv-quote');
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
