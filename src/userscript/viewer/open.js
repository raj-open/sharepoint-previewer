import { currentFolder, refreshEyes, rowFilePath, rowName } from '../list.js';
import { csvFormat, view } from '../prefs.js';
import { linkTarget } from '../readers/links.js';
import { PARQUET_RE } from '../readers/parquet/meta.js';
import { openParquetSource } from '../readers/parquet/source.js';
import { SHEET_RE, sheetFormat } from '../readers/sheets/cells.js';
import { openSheetSource } from '../readers/sheets/index.js';
import { openSource } from '../readers/text.js';
import { openZipSource, ZIP_RE } from '../readers/zip.js';
import { FOLLOW_LINKS, MAX_3D_BYTES, MAX_BYTES, MAX_LINE_CHARS, MAX_LINK_HOPS } from '../settings.js';
import { csvSeparator, SEPARATOR_NAMES } from '../text/highlight/csv.js';
import { HIGHLIGHTERS } from '../text/highlight/index.js';
import { indentation, LANG_NAMES, langOf } from '../text/lang.js';
import { LINTERS } from '../text/lint/index.js';
import { lintFile } from '../text/lint/worker.js';
import { LOAD_ALL_SVG } from '../ui/icons.js';
import { esc, formatBytes, nextFrame } from '../util.js';
import { mountLines, renderLines } from '../view/lines.js';
import { mountTable, parseCsv, QUOTE_MODES } from '../view/table.js';
import { cancelLoad, clearedUrls, keepInMemory, makeRoom, memoryCache, trimMemory } from './cache.js';
import { canWrite, confirmDiscard, exitWriteView, markEdited } from './edit.js';
import { layoutPage, restorePage, setMode } from './layout.js';
import { renderLint, showLintWait, showPlain } from './messages.js';
import { createViewer } from './panel.js';
import { setBusy, showCached, showProgress } from './status.js';
import { close3d, ifcLibraryReady, toggle3d } from './view3d.js';
import { colourOn, showSheets, updateViews } from './views.js';

/** @typedef {import('../types.js').Source} Source */
/** @typedef {import('../types.js').Viewer} Viewer */

export let viewer = null; // single open viewer, if any

/** @returns {void} */
export function closeViewer() {
  if (!viewer) return;
  setTimeout(refreshEyes); // row highlight off, once viewer is gone
  if (!confirmDiscard(viewer)) return; // pending: keep viewer open
  if (viewer.writeMode) exitWriteView(viewer);
  cancelLoad(viewer);
  viewer.lineView?.stop();
  close3d(viewer);
  if (viewer.mode !== 'popup') layoutPage('popup');
  restorePage();
  viewer.removeListeners();
  viewer.backdrop.remove();
  viewer.box.remove();
  viewer = null;
}

/** @param {Element|null} row @returns {Promise<void>} */
// Opens a file (following .url links): { src } or { message }, plus final name and hops
/** @returns {Promise<{ src: Source|null, message: string|null, fileName: string, hops: string[] }>} */
async function openFile(fetchUrl, fileName, hops, getSignal, reload, onProgress, onLink, force) {
  hops = [...hops];
  for (let hop = 0; ; hop++) {
    const result = PARQUET_RE.test(fileName)
      ? await openParquetSource(fetchUrl, getSignal, reload, onProgress, force)
      : SHEET_RE.test(fileName)
        ? await openSheetSource(fetchUrl, getSignal, reload, onProgress)
        : ZIP_RE.test(fileName)
          ? await openZipSource(fetchUrl, getSignal, reload, onProgress, force)
          : await openSource(fetchUrl, getSignal, reload, onProgress);
    if (result.deferred) return { src: null, deferred: result, message: null, fileName, hops };
    if (result.error) return { src: null, message: `${result.error}\n${hops.join('\n→ ')}`, fileName, hops };
    if (result.binary) {
      return {
        src: null,
        message: 'Not a plain text file: use the standard SharePoint preview, or download the file.',
        fileName,
        hops,
      };
    }
    if (hop > 0 && result.name) fileName = result.name;
    const target = FOLLOW_LINKS && hop < MAX_LINK_HOPS && result.done ? linkTarget(fileName, result.text) : null;
    if (!target) return { src: result, message: null, fileName, hops };
    hops.push(target.display);
    fileName = target.name;
    fetchUrl = target.fetchUrl;
    onLink(`Link → ${target.display}`);
  }
}
export const pendingOpens = new Map(); // url -> first fetch still running { promise, relay, ctl }
export const forcedUrls = new Set(); // big Parquet / IFCZIP files the user chose to cache in full
const knownSizes = new Map(); // url -> file size seen before (shown right away next time)

// Same file, any encoding / case of path
/** @param {string} a @param {string} b @returns {boolean} */
export function sameFile(a, b) {
  const norm = (x) => {
    try {
      x = decodeURIComponent(x);
    } catch {}
    return x.replace(/\/+$/, '').toLowerCase();
  };
  return norm(a) === norm(b);
}

// Header eye: viewer without file (look around, settings, ...). Same toggle as row eyes:
// again on the empty viewer = close; with a file open = switch to empty.
/** @returns {void} */
export function openEmptyViewer() {
  if (viewer && !viewer.file) return void closeViewer();
  if (!viewer) {
    viewer = createViewer();
    setMode(view.mode);
  }
  showEmpty(viewer);
}

// Viewer back to no file; false if user keeps pending changes
/** @param {Viewer} v @returns {boolean} */
function showEmpty(v) {
  if (!confirmDiscard(v)) return false;
  close3d(v);
  if (v.writeMode) exitWriteView(v);
  cancelLoad(v);
  setBusy(v, false);
  v.loadToken++; // ignore anything still on its way
  v.file = null;
  v.source = null;
  v.rerender = null;
  v.relint = null;
  v.text = '';
  for (const b of [v.copyBtn, v.loadAllBtn, v.writeBtn, v.tableBtn, v.view3dBtn, v.clearBtn]) b.disabled = true;
  showSheets(v, null);
  updateViews(v);
  v.titleName.textContent = '–';
  v.titleName.title = '';
  v.metaLine.innerHTML = '';
  v.metaLine.title = '';
  showPlain(v, 'No file opened. Click the eye-icon next to files to preview them.');
  refreshEyes();
  return true;
}

export async function openPreview(row) {
  const name = row && rowName(row);
  if (!name) {
    alert('Preview: could not find the file name in this row.');
    return;
  }
  const folder = currentFolder();
  const url = rowFilePath(row, name) || (folder && `${folder}/${name}`);
  if (url && viewer?.file && sameFile(viewer.file.url, url)) return void closeViewer(); // eye of open file: same as close
  if (url) showFile(name, url, false);
}

// Load file into viewer; `reload` skips browser's cache (refresh button)
/** @param {string} name @param {string} url @param {boolean} reload @returns {Promise<void>} */
export async function showFile(name, url, reload) {
  const encodedUrl = url.split('/').map(encodeURIComponent).join('/');

  // Reuse open viewer (e.g. in split mode, click through files one after another)
  if (!viewer) {
    viewer = createViewer();
    setMode(view.mode);
  }
  const v = viewer;
  if (!confirmDiscard(v)) return; // pending in open file: stay
  close3d(v);
  if (v.writeMode) exitWriteView(v);
  cancelLoad(v); // previous file may still be on its way
  const token = ++v.loadToken;
  const current = () => viewer === v && token === v.loadToken; // not closed / replaced
  v.file = { name, url };
  refreshEyes(); // highlight its row

  if (clearedUrls.delete(url)) reload = true; // cleared before: skip stored copy once
  v.userStopped = false;

  v.titleName.textContent = name;
  v.titleName.title = url;
  // what is known before the content: format, then size (from the first response)
  const earlyFormat = PARQUET_RE.test(name) ? 'Parquet' : sheetFormat(name) || LANG_NAMES[langOf(name)] || 'Text';
  const earlyMeta = (total) => {
    const parts = [
      total ? `size: ${formatBytes(total)} (${total.toLocaleString()} bytes)` : '',
      `format: ${earlyFormat}`,
    ];
    v.metaLine.innerHTML = `<strong>Properties:</strong> ${esc(parts.filter(Boolean).join(' · '))}`;
  };
  earlyMeta(knownSizes.get(url) || 0);
  v.metaLine.title = '';
  v.text = '';
  v.copyBtn.disabled = true;
  v.loadAllBtn.disabled = true;
  v.writeBtn.disabled = true;
  v.tableBtn.disabled = true;
  v.view3dBtn.disabled = true;
  showSheets(v, null);
  updateViews(v);
  v.clearBtn.disabled = false;
  setBusy(v, true);
  showPlain(v, '');
  showProgress(v, 0, 0);
  v.content.focus();

  // First chunk (close cancels); .url link files are followed
  let src = null;
  let message = null; // shown instead of file (errors, binary files)
  let deferred = null; // big Parquet / IFCZIP: waits for "cache all"
  const forced = forcedUrls.has(url); // "cache all" was asked for
  let fileName = name; // name of file actually shown (after links are followed)
  const fetchUrl = encodedUrl;
  const hops = [url];
  v.abort = new AbortController();
  // relay: progress and signal of this file's source, also once another file is shown
  const relay = { fn: null, controller: null };
  const getSignal = () => {
    if (relay.controller) return relay.controller.signal;
    v.abort ||= new AbortController();
    return v.abort.signal;
  };
  let rendered = false; // once text is shown, progress goes to "Cache next" bar

  let metaSize = 0;
  const progress = (loaded, total) => {
    if (!current()) return;
    if (total) loaded = Math.min(loaded, total); // overlapping reads may count twice
    showProgress(v, loaded, total);
    if (!rendered && total && total !== metaSize) {
      metaSize = total;
      earlyMeta(total);
    }
    // all bytes in, view still built (e.g. Parquet rows decoded)
    if (total && loaded >= total) v.progressText.textContent += ' · preparing view …';
  };
  relay.fn = progress; // the showFile that shows this source now
  const relayed = (loaded, total) => relay.fn(loaded, total);
  if (reload && memoryCache.delete(url)) refreshEyes(); // refresh: fetch anew
  const kept = memoryCache.get(url);
  // New file and the cache at its limit: clear the others first (OK / Cancel)
  if (!kept && !pendingOpens.has(url) && !makeRoom(v, Math.min(MAX_BYTES, knownSizes.get(url) || MAX_BYTES))) {
    setBusy(v, false);
    showPlain(
      v,
      'Not opened: the cache is full. Clear cached files (⋯ menu) or raise the cache limit in the settings.',
    );
    return;
  }
  if (kept) {
    // Previewed before while this page is open: reuse it, nothing is fetched
    memoryCache.delete(url);
    memoryCache.set(url, kept); // most recently viewed last
    src = kept.src;
    if (src.relay) src.relay.fn = progress;
    fileName = kept.fileName;
    hops.push(...kept.hops.slice(1));
  } else
    try {
      // The first fetch (Parquet / IFCZIP: often the whole file) goes on when the user moves
      // to another file; coming back joins it instead of starting anew
      let pending = pendingOpens.get(url);
      if (pending) pending.relay.fn = progress;
      else {
        const ctl = new AbortController();
        relay.controller = ctl;
        pending = {
          relay,
          ctl,
          promise: openFile(
            fetchUrl,
            fileName,
            hops,
            getSignal,
            reload,
            relayed,
            (m) => current() && showPlain(v, m),
            forcedUrls.has(url),
          ),
        };
        pendingOpens.set(url, pending);
        refreshEyes(); // half open while it caches
        pending.promise
          .then(
            (r) => {
              if (r.src) {
                r.src.relay = relay;
                keepInMemory(url, { src: r.src, fileName: r.fileName, hops: [...r.hops] });
              }
            },
            () => {},
          )
          .finally(() => {
            relay.controller = null;
            pendingOpens.delete(url);
            refreshEyes();
          });
      }
      v.abort = pending.ctl;
      v.opening = true;
      const r = await pending.promise;
      src = r.src;
      deferred = r.deferred;
      message = r.message;
      fileName = r.fileName;
      hops.splice(0, hops.length, ...r.hops);
    } catch (err) {
      if (err.name === 'AbortError') {
        if (current() && v.userStopped) showPlain(v, 'Caching stopped. Use refresh to cache this file again.');
        return;
      }
      message = `Caching failed: ${err.message}\n${hops.join('\n→ ')}`;
    }
  if (current()) v.opening = false;
  if (current()) setBusy(v, false);
  if (hops.length > 1) {
    v.titleName.textContent = `${name} → ${fileName}`;
    v.titleName.title = hops.join('\n→ ');
  }
  v.abort = null;

  if (!current()) return;

  if (deferred) {
    // Big Parquet / IFCZIP: only on request (whole file); "cache all" opens it in full
    v.source = { total: deferred.size, loaded: 0, done: false, dates: deferred.dates, deferred: true };
    knownSizes.set(url, deferred.size);
    v.text = '';
    v.copyBtn.disabled = true;
    v.writeBtn.disabled = true;
    v.rerender = null;
    v.relint = null;
    v.loadAllBtn.disabled = false;
    v.loadAll = async () => {
      forcedUrls.add(url);
      await showFile(name, url, false);
      return true;
    };
    showPlain(
      v,
      `To show this ${deferred.deferred} file (${formatBytes(deferred.size)}), the whole file has to be cached first.\nClick ⟦icon⟧ to do this.`,
    );
    const icon = LOAD_ALL_SVG.replace(/\s+/g, ' ').trim(); // no line breaks (the text is pre-formatted)
    const line2 = v.content.querySelectorAll('.tp-code')[1];
    line2.innerHTML = line2.innerHTML.replace('⟦icon⟧', `<span class="tp-inline-icon">${icon}</span>`);
    v.metaLine.innerHTML = `<strong>Properties:</strong> size: ${formatBytes(deferred.size)} · format: ${deferred.deferred}`;
    updateViews(v);
    return;
  }
  v.copyBtn.disabled = false;

  if (!src) {
    v.text = message;
    v.source = null;
    v.writeBtn.disabled = true;
    v.rerender = null;
    v.relint = null;
    v.loadAllBtn.disabled = true;
    showPlain(v, message);
    return;
  }

  // Copy gets whole file: rest is cached first if needed
  v.source = src;
  v.fileName = fileName;
  v.lang = PARQUET_RE.test(fileName) ? 'parquet' : src.isSheet ? 'sheet' : langOf(fileName);
  v.linked = hops.length > 1;
  v.writeBtn.disabled = !canWrite(v);
  v.writeBtn.title = src.isSheet ? 'Edit: not available for spreadsheets (read only)' : 'Edit (beta, text files only)';
  v.tableBtn.disabled = !['parquet', 'sheet', 'csv'].includes(v.lang);
  const ifcSize = src.ifcBytes ? src.ifcBytes.length : src.total;
  const tooBig = ifcSize > MAX_3D_BYTES;
  v.view3dBtn.disabled = langOf(fileName) !== 'ifc' || tooBig;
  v.view3dBtn.title = tooBig
    ? `3D view: only for IFC files up to ${formatBytes(MAX_3D_BYTES)}`
    : '3D view (IFC, IFCZIP)';
  updateViews(v);
  v.text = src.text;

  const lang = ['parquet', 'sheet'].includes(v.lang) ? 'csv' : langOf(fileName); // their rows come as CSV
  const highlight = HIGHLIGHTERS[lang] || ((t) => [['', t]]);
  let problemsByLine = new Map();
  let lines = [];

  // Cached lines; unfinished last line waits (unless there is no break at all)
  const loadedLines = () => {
    let t = src.text;
    if (!src.done && !src.wholeLines && t.includes('\n')) t = t.slice(0, t.lastIndexOf('\n'));
    return t.split(/\r?\n/);
  };

  // Table view: sort and filters stay while this file is open (also across "Cache next"); per sheet
  const tableState = { sort: null, filters: new Map() };
  const sheetStates = new Map();
  const sheetState = (i) => {
    if (!sheetStates.has(i)) sheetStates.set(i, { sort: null, filters: new Map() });
    return sheetStates.get(i);
  };

  // Metadata line: dates, size, format and, for tables, their shape

  const updateMeta = () => {
    const d = src.dates || {};
    const info = [
      // from the file's own response only (no list columns, no API)
      ['created', d.created],
      ['modified', d.modified || 'n/a'],
      ['size', src.total ? `${formatBytes(src.total)} (${src.total.toLocaleString()} bytes)` : null],
      ['format', src.format || `${LANG_NAMES[lang] || 'Text'}${src.encoding ? `, ${src.encoding}` : ''}`],
    ];
    if (!src.format && lang !== 'csv') info.push(['indent', indentation(src.text)]);
    if (src.info)
      info.push(...src.info); // Parquet, archives, spreadsheets
    else if (lang === 'csv') {
      const sep = csvSeparator(src.text);
      const header = src.text.slice(0, (src.text.indexOf('\n') + 1 || src.text.length + 1) - 1);
      const cols = header ? header.split(sep).length : 0;
      const rows = Math.max(0, lines.filter((l) => l.trim()).length - 1);
      const to = v.tableEditing && csvFormat.sep && csvFormat.sep !== sep ? ` → ${SEPARATOR_NAMES[csvFormat.sep]}` : '';
      info.push(['delimiter', `${SEPARATOR_NAMES[sep]}${to}`]);
      if (v.tableEditing && csvFormat.quote)
        info.push(['quotes', QUOTE_MODES[csvFormat.quote].replace('Quotes: ', '')]);
      info.push(['shape', `${src.done ? '' : '≥ '}${rows.toLocaleString()} rows × ${cols} columns`]);
    }
    const shown = info.filter(([, x]) => x !== null && x !== undefined && x !== '');
    v.metaLine.innerHTML = `<strong>Properties:</strong> ${esc(shown.map(([k, x]) => `${k}: ${x}`).join(' · '))}`;
    v.metaLine.title = shown.map(([k, x]) => `${k}: ${x}`).join('\n');
  };

  // Very long lines (e.g. minified files) are cut for display; copy still gets everything
  const render = () => {
    rendered = true;
    lines = loadedLines();
    v.content.style.setProperty('--tp-ln-w', `${String(lines.length).length + 1}ch`);
    const scrollTop = v.content.scrollTop;
    const truncated = new Map();
    const visible = lines.map((line, i) => {
      if (line.length <= MAX_LINE_CHARS) return line;
      truncated.set(i + 1, line.length - MAX_LINE_CHARS);
      return line.slice(0, MAX_LINE_CHARS);
    });
    v.lineView?.stop();
    const sheet = src.isSheet ? src.sheets[src.current] : null;
    if (sheet && !sheet.data?.rows.length) {
      // chart sheet, empty or unreadable sheet: a note instead
      v.lineView = mountLines(v.content, renderLines([['', sheet.note || 'Empty sheet: no cells.']], new Map()));
      v.content.firstElementChild.classList.add('tp-notice');
    } else if (sheet && view.table) {
      v.lineView = mountTable(v.content, src.header(), sheet.data.rows, {
        state: sheetState(src.current),
        colour: colourOn(v),
      });
    } else if (view.table && lang === 'csv') {
      const sep = csvSeparator(src.text);
      const rows = parseCsv(src.done ? src.text.replace(/\r?\n$/, '') : lines.join('\n'), sep);
      v.lineView = mountTable(v.content, rows[0] || [], rows.slice(1), {
        state: tableState,
        sep,
        editable: v.tableEditing,
        colour: colourOn(v),
        format: v.tableEditing ? csvFormat : null,
        onEdit: () => markEdited(v),
      });
    } else {
      const tokens = (colourOn(v) ? highlight : (t) => [['', t]])(visible.join('\n'));
      v.lineView = mountLines(v.content, renderLines(tokens, problemsByLine, truncated));
    }
    v.content.scrollTop = scrollTop;

    updateMeta();
    showSheets(v, src);
    v.loadMoreBtn.style.display = src.done ? 'none' : 'block';
    v.loadMoreBtn.disabled = false;
    v.loadAllBtn.disabled = src.done;
    if (!v.busy) showCached(v); // the "fully cache" hint needs the button state
    const of = src.total ? ` of ${formatBytes(src.total)}` : '';
    v.loadMoreBtn.textContent = src.label
      ? `${src.label()} · ${src.nextLabel}`
      : `${lines.length.toLocaleString()} lines · ${formatBytes(src.loaded)}${of} cached · ` +
        `Cache next ${formatBytes(MAX_BYTES)}`;
  };

  const goToLine = (n) => {
    n = Math.max(1, Math.min(n, lines.length));
    v.lineView?.show(n);
    const el = v.content.querySelector(`[data-line="${n}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('tp-flash');
    setTimeout(() => el.classList.remove('tp-flash'), 1500);
  };

  // Problem check: needs whole file, so it runs once everything is cached
  let linted = false;

  const runLint = async () => {
    if (linted || !src.done || !LINTERS[lang]) return;
    linted = true;
    showLintWait(v, lang);
    await nextFrame();
    if (!current()) return;
    const result = src.lintResult || (await lintFile(v, lang, src.text));
    src.lintResult = result;
    v.lintWorker = null;
    if (!current()) return;
    problemsByLine = new Map();
    for (const p of result.problems) {
      if (!problemsByLine.has(p.line)) problemsByLine.set(p.line, []);
      problemsByLine.get(p.line).push(p);
    }
    renderLint(v, lang, result, goToLine);
    if (result.problems.length) render();
  };

  // Load more (one chunk, or everything; or `job`, e.g. one sheet), then shows it
  const load = async (all, job = src.more, need = MAX_BYTES) => {
    if (src.done) return true;
    if (!all && !src.fullJob && !makeRoom(v, need)) return false;
    if (src.fullJob) all = true; // join the "cache all" still running
    v.loadMoreBtn.disabled = true;
    v.loadAllBtn.disabled = true;
    v.userStopped = false;
    setBusy(v, true);
    showProgress(v, src.loaded, src.total);
    try {
      if (all) {
        // runs on when the user moves to another file; joined on return
        if (!src.fullJob) {
          src.controller = v.abort ||= new AbortController();
          if (src.relay) src.relay.controller = src.controller; // its requests: this signal
          src.fullJob = src.loadAll().finally(() => {
            src.fullJob = null;
            src.controller = null;
            if (src.relay) src.relay.controller = null;
          });
        } else v.abort = src.controller;
        await src.fullJob;
      } else await job();
    } catch (err) {
      if (!current()) return false;
      setBusy(v, false);
      v.abort = null;
      if (err.name === 'AbortError') {
        v.text = src.text;
        render(); // stopped: show what is cached so far, "Cache next" works again
        return false;
      }
      v.loadMoreBtn.disabled = false;
      v.loadAllBtn.disabled = false;
      v.loadMoreBtn.textContent = `Caching failed: ${err.message} · Refresh to try again`;
      return false;
    }
    trimMemory();
    if (!current()) return false;
    v.abort = null;
    setBusy(v, false);
    v.text = src.text;
    render();
    runLint();
    return true;
  };
  v.loadAll = () => load(true);
  v.rerender = render; // colours switched on / off
  v.applyColour?.(); // colour button for this file's view
  v.updateMeta = updateMeta;
  v.relint = () => {
    // forget last result and check again (in write mode: saved or cached text)
    src.lintResult = null;
    src.needsLint = false;
    linted = false;
    problemsByLine = new Map();
    runLint();
  };
  v.loadMoreBtn.onclick = () => load(false);

  // Other sheet: cached on first choice (stop keeps the sheet shown before)
  v.selectSheet = async (i) => {
    if (!src.isSheet || i === src.current || !src.sheets[i]) return;
    if (src.sheets[i].data === undefined) {
      const job = async () => {
        await src.loadSheet(i);
        src.select(i);
      };
      const ok = await load(false, job, src.sheets[i].size);
      if (!current()) return;
      if (!ok) return void showSheets(v, src); // drop-down back to sheet shown
    }
    if (src.current !== i) {
      src.select(i);
      v.text = src.text;
      render();
    }
    v.content.scrollTop = 0;
    v.content.scrollLeft = 0;
  };

  if (LINTERS[lang] && !src.done) {
    v.lint.style.display = 'block';
    v.lint.className = 'tp-lint tp-lint-wait';
    v.lint.innerHTML = `<div class="tp-lint-summary">${lang.toUpperCase()}: checked once the whole file is cached</div>`;
  } else if (!LINTERS[lang]) {
    v.lint.style.display = 'none'; // TOML / plain text: colours only
  }

  // Text first, so it is readable while (possibly slow) check runs
  v.content.scrollTop = 0;
  render();
  runLint();

  // "Cache all" still running from an earlier visit (or asked for a big Parquet / IFCZIP)
  if (src.fullJob || (forced && !src.done)) load(true);

  // 3D view chosen before: show it again, but only if its library is already loaded
  if (view.show3d && ifcLibraryReady && !v.view3dBtn.disabled) toggle3d(v);
}
