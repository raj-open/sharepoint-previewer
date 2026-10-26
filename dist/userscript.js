// ==UserScript==
// @name         Sharepoint Previewer
// @description  Previewer (text, table, spreadsheet, 3d-viewer) for various file types. Provides an editor for all pure text files.
// @version      0.0.0
// @copyright    2026, raj-open (https://github.com/raj-open/sharepoint-previewer)
// @license      MPL-2.0
// @match        https://*.sharepoint.com/*/*/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

// Built from the modules in /src (just build-src): do not edit by hand.
// Version and 3D checksums are dummies here: the release build stamps them.
// @ts-nocheck: the modules are type-checked (just type-check), not this file
(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: userscripts run as classic scripts, not as modules
  'use strict';

  // Module: _core/settings.ts

  // Settings: defaults below; own values in Tampermonkey's storage (menu → "Settings …"),
  // kept across updates. Values of wrong type are ignored.

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const DEFAULTS = {
      // 'popup', 'horizontal' (below list) or 'vertical' (right of it); start value
      'layout': 'horizontal',

      // Share of space for preview in split mode (0.2 – 0.8); start value
      'viewer-share': 1 / 3,

      // Show light markers for whitespace: · for spaces, → for tabs
      'show-whitespace': true,

      // Wrap long lines (start value)
      'wrap-lines': false,

      // Syntax colours: text view, table view, table view of logs (start values)
      'colours-text': true,
      'colours-table': false,
      'colours-log': true,

      // Column colours in table view of spreadsheets (start value; rows stay striped)
      'colours-sheet': false,

      // Spreadsheets show 'sheets' or 'tables' (start value; sheets if a file has no tables)
      'spreadsheet-view': 'tables',

      // Spreadsheets up to this size show their first sheet or table at once; larger ones wait for a choice
      'spreadsheet-autoload-bytes': 512 * 1024,

      // Bytes per cache step ("Cache next"); 512 KB ≈ 10,000 lines of code
      'cache-chunk-bytes': 512 * 1024,

      // Parquet files: rows shown at first; "Cache next" shows this many more
      'parquet-rows': 100,

      // Cache limit for all files together (bytes of the files); more asks to clear first
      'memory-cache-bytes': 256 * 1024 * 1024,

      // "cache all" button asks for confirmation for files bigger than this
      'cache-all-confirm-bytes': 16 * 1024 * 1024,

      // Longer lines are cut for display (copy still gets full text)
      'max-line-chars': 5000,

      // Follow link files (.url shortcuts) and show file they point to
      'follow-links': true,

      // Folder with ifc-lite-3d.js and ifc-lite_bg.wasm: relative to site, or from top
      // with leading '/'. Fetched on first use of 3D button, checked by SHA-256.
      'viewer-3d-folder': '',

      // 3D view only for IFC files up to this size (for .ifczip: unpacked IFC file)
      'viewer-3d-max-bytes': 8 * 1024 * 1024,

      // 'dark' or 'light' (start value)
      'theme': 'light',

      // Logo (top right) as data: URI; empty = none. No network request.
      'logo': '',
  };

  // Fixed values (internal)
  // Links followed in row at most (against loops)
  const MAX_LINK_HOPS = 5;

  // Bytes at start that decide whether file is text
  const SNIFF_BYTES = 512;

  // Most problems listed by checker
  const MAX_PROBLEMS = 500;

  // Space between list and preview in split mode, in pixels
  const SPLIT_GAP = 3;

  // Width of preview (eye) column, in pixels
  const COL_WIDTH = 32;

  // Checksums of 3D viewer files (they belong to this script version): dummies, stamped by the release build
  const VIEWER_3D_JS_SHA256 = '<sha256>';
  const VIEWER_3D_WASM_SHA256 = '<sha256>';

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function loadSettings() {
      const out = {};
      for (const [key, fallback] of Object.entries(DEFAULTS)) {
          let value = GM_getValue(key);
          if (value === undefined) {
              value = fallback;
              GM_setValue(key, value); // shown in Tampermonkey's storage
          }
          out[key] = typeof value === typeof fallback ? (value) : fallback;
      }
      return out; // types checked above
  }
  const {
      'layout': DEFAULT_MODE,
      'viewer-share': DEFAULT_PREVIEW_SIZE,
      'show-whitespace': SHOW_WHITESPACE,
      'wrap-lines': DEFAULT_WRAP,
      'colours-text': DEFAULT_COLOURS,
      'colours-table': DEFAULT_TABLE_COLOURS,
      'colours-log': DEFAULT_LOG_COLOURS,
      'colours-sheet': DEFAULT_SHEET_COLOURS,
      'spreadsheet-view': DEFAULT_SHEET_VIEW,
      'spreadsheet-autoload-bytes': SHEET_AUTOLOAD_BYTES,
      'cache-chunk-bytes': MAX_BYTES,
      'parquet-rows': PARQUET_ROWS,
      'memory-cache-bytes': MEMORY_CACHE_BYTES,
      'cache-all-confirm-bytes': LARGE_FILE_BYTES,
      'max-line-chars': MAX_LINE_CHARS,
      'follow-links': FOLLOW_LINKS,
      'viewer-3d-folder': VIEWER_3D_FOLDER,
      'viewer-3d-max-bytes': MAX_3D_BYTES,
      'theme': THEME,
      'logo': LOGO,
  } = loadSettings();

  // Module: ui/icons.ts

  // Icons (inline SVG): eyes, modes, buttons

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Closed eye: lid line with lashes
  const EYE_CLOSED_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2 10s4 6 10 6 10-6 10-6"/>
      <path d="M5.5 14l-1.5 2.2M12 16v2.6M18.5 14l1.5 2.2"/>
    </svg>
  `;

  // Half-open eye: lowered lid, lower half of pupil visible
  const EYE_HALF_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1 12s4 7 11 7 11-7 11-7"/>
      <path d="M1 12c3-2.5 7-3.5 11-3.5s8 1 11 3.5"/>
      <path d="M9 12a3 3 0 0 0 6 0z" fill="currentColor"/>
    </svg>
  `;

  // Fully open eye with lashes (file completely cached; also column header)
  const EYE_FULL_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1 13.5s4-6 11-6 11 6 11 6-4 6-11 6-11-6-11-6z"/>
      <circle cx="12" cy="13.5" r="2.8"/>
      <path d="M12 7.5V4.2M6.6 8.6L5 6.3M17.4 8.6L19 6.3"/>
    </svg>
  `;

  const COPY_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  `;

  const CHECK_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  `;

  // ---------------------------------------------------------------------------
  // Viewer: popup (default), vertical split (preview right), horizontal split (preview below)
  // ---------------------------------------------------------------------------

  // Mode icons: filled part is where preview goes
  const SPLIT_V_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7z" fill="currentColor"/>
    </svg>
  `;

  const POPUP_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor"/>
    </svg>
  `;

  // Palette: syntax colours
  const COLOUR_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2
               0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.4-9-7.4z"/>
      <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor"/>
      <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor"/>
      <circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>
    </svg>
  `;

  const REFRESH_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
      <polyline points="21 3 21 9 15 9"/>
    </svg>
  `;

  // Cache all: filled top part, arrow down to whole frame
  // Half-filled circle: light / dark
  const THEME_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>
    </svg>
  `;

  // Grid: table view
  // Lines of text (text view)
  const TEXT_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M4 6h16M4 10h16M4 14h11M4 18h14"/>
    </svg>
  `;
  // Cube (3D view)
  const CUBE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z"/>
      <path d="M3.5 7.25L12 12l8.5-4.75M12 12v9.5"/>
    </svg>
  `;
  // Page with M and down arrow (Markdown view)
  const MARKDOWN_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <path d="M5.5 15V9l3 3.5 3-3.5v6M17 9v6M14.5 12.5 17 15l2.5-2.5"/>
    </svg>
  `;
  const TABLE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <path d="M3 9h18M3 14.5h18M9.5 9v11M15.5 9v11"/>
      <path d="M3 4h18v5H3z" fill="currentColor" stroke="none" opacity=".35"/>
    </svg>
  `;

  // Cloud with arrow: upload
  const UPLOAD_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 18a4.5 4.5 0 0 1-.8-8.9A6 6 0 0 1 17.8 8a4 4 0 0 1-.8 10"/>
      <path d="M12 12v8M9 15l3-3 3 3"/>
    </svg>
  `;

  // Sheet with folded corner and plus: new file
  const NEW_FILE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <path d="M14 3v6h6M12 12v6M9 15h6"/>
    </svg>
  `;

  // Three dots: more options
  const MORE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>
    </svg>
  `;

  // Small bin: delete table column
  const BIN_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>
    </svg>
  `;

  const SAVE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
      <path d="M7 3v5h8V3"/>
      <rect x="7" y="13" width="10" height="8"/>
    </svg>
  `;

  // Pen: write mode
  const WRITE_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>
    </svg>
  `;

  // Cancel: circle with diagonal slash (⊘)
  const STOP_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <path d="M5.6 5.6l12.8 12.8"/>
    </svg>
  `;

  const CLEAR_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="4 7 20 7"/>
      <path d="M9 7V4h6v3"/>
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/>
    </svg>
  `;

  const LOAD_ALL_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4z" fill="currentColor"/>
      <path d="M12 12v6"/>
      <polyline points="9 15 12 18 15 15"/>
    </svg>
  `;

  const SETTINGS_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M19.12 10.41 L21.52 10.76 L21.52 13.24 L19.12 13.59 L18.16 15.91 L19.61 17.85 L17.85 19.61 L15.91 18.16 L13.59 19.12 L13.24 21.52 L10.76 21.52 L10.41 19.12 L8.09 18.16 L6.15 19.61 L4.39 17.85 L5.84 15.91 L4.88 13.59 L2.48 13.24 L2.48 10.76 L4.88 10.41 L5.84 8.09 L4.39 6.15 L6.15 4.39 L8.09 5.84 L10.41 4.88 L10.76 2.48 L13.24 2.48 L13.59 4.88 L15.91 5.84 L17.85 4.39 L19.61 6.15 L18.16 8.09Z"/><circle cx="12" cy="12" r="3"/></svg>`; // gear
  const PROPS_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>`;
  const WRAP_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M3 12h15a3 3 0 0 1 0 6h-4"/>
      <polyline points="16 16 14 18 16 20"/>
      <line x1="3" y1="18" x2="10" y2="18"/>
    </svg>
  `;

  const SPLIT_H_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 12h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor"/>
    </svg>
  `;

  // Module: _core/util.ts

  // Small shared helpers: HTML escaping, next frame, byte sizes, CSV cells

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  // ===========================================================================
  // METHODS
  // ===========================================================================

  /** @returns HTML-escaped */
  const esc = (s) => s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  const formatBytes = (n) => {
      if (n < 1024) return `${n} B`;
      if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
      if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
      return `${(n / 1024 ** 3).toFixed(2)} GB`;
  };

  const csvCell = (s) =>
      s === null ? '' : /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

  // Module: view/lines.ts

  // Render: tokens -> one <div> per line, with line numbers and problem marks

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Big views in blocks of CHUNK_LINES: only blocks near visible area are filled
  const CHUNK_LINES = 200;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Whitespace markers (CSS only, copied text unchanged): · per space, → per tab
  function markWhitespace(html) {
      if (!SHOW_WHITESPACE) return html;
      return html.replace(/ +|\t/g, (ws) =>
          ws === '\t' ? '<span class="tp-tab">\t</span>' : `<span class="tp-sp">${ws}</span>`,
      );
  }

  // Fill blocks when they come near visible part of `root`, empties them when far away
  function watchBlocks(
      root,
      blocks,
      fill,
      empty,
  ) {
      const io = new IntersectionObserver(
          (entries) => {
              for (const e of entries) (e.isIntersecting ? fill : empty)(e.target);
          },
          { root, rootMargin: '1500px 0px' },
      );
      for (const b of blocks) io.observe(b);
      return io;
  }

  function mountLines(content, lineHtml) {
      const holder = document.createElement('div');
      holder.className = 'tp-lines';
      content.replaceChildren(holder);
      const lineHeight = parseFloat(getComputedStyle(content).lineHeight) || 19;

      const chunks = [];
      for (let from = 0; from < lineHtml.length; from += CHUNK_LINES) {
          const box = document.createElement('div');
          const count = Math.min(CHUNK_LINES, lineHtml.length - from);
          box.style.height = `${count * lineHeight}px`;
          box.dataset.from = String(from);
          box.dataset.count = String(count);
          holder.append(box);
          chunks.push(box);
      }

      const fill = (box) => {
          if (box.dataset.on) return;
          const from = Number(box.dataset.from);
          box.innerHTML = lineHtml.slice(from, from + Number(box.dataset.count)).join('');
          box.style.height = '';
          box.dataset.on = '1';
      };

      const empty = (box) => {
          if (!box.dataset.on) return;
          box.style.height = `${box.getBoundingClientRect().height}px`; // keep its place
          box.replaceChildren();
          delete box.dataset.on;
      };

      const io = watchBlocks(content, chunks, fill, empty);

      return {
          stop: () => io.disconnect(),
          show: (line) => {
              const box = chunks[Math.floor((line - 1) / CHUNK_LINES)];
              if (box) fill(box);
          },
      };
  }

  /** @returns one HTML string per line */
  function renderLines(
      tokens,
      problemsByLine,
      truncated = new Map(),
  ) {
      const out = [];
      let n = 1;
      let cur = '';

      const flush = () => {
          const p = problemsByLine.get(n);
          const cls = p ? (p.some((x) => x.severity === 'error') ? ' tp-err' : ' tp-warn') : '';
          const title = p ? ` title="${esc(p.map((x) => x.msg).join('\n'))}"` : '';
          const cut = truncated.get(n);
          const tail = cut ? `<span class="tp-trunc"> … ${cut.toLocaleString()} more characters</span>` : '';
          out.push(
              `<div class="tp-line${cls}" data-line="${n}"${title}>` +
                  `<span class="tp-ln">${n}</span><span class="tp-code">${cur || ' '}${tail}</span></div>`,
          );
          n++;
          cur = '';
      };
      for (const [cls, val] of tokens) {
          const parts = val.split('\n');
          for (let i = 0; i < parts.length; i++) {
              if (i) flush();
              if (parts[i]) {
                  const html = markWhitespace(esc(parts[i]));
                  cur += cls ? `<span class="tp-${cls}">${html}</span>` : html;
              }
          }
      }
      flush();
      return out; // one HTML string per line
  }

  // Module: view/table.ts

  // Table view: CSV parsing, rendering, sorting, filters, editing

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Quote styles as in Python's csv module ('none' can break file)
  const QUOTE_MODES = {
      minimal: 'Quotes: only when needed',
      all: 'Quotes: all cells',
      nonnumeric: 'Quotes: all but numbers',
      none: 'Quotes: none',
  };
  const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
  const MAX_TITLE = 2000; // characters of a cell's tooltip

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // CSV text -> rows of cells; row.raw keeps original text for unedited rows
  function parseCsv(text, sep) {
      const rows = [];
      let row = [];
      let cell = '';
      let quoted = false;
      let start = 0;
      const endRow = (end) => {
          row.push(cell);
          row.raw = text.slice(start, end);
          rows.push(row);
          row = [];
          cell = '';
      };
      for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (quoted) {
              if (c === '"') {
                  if (text[i + 1] === '"') cell += text[++i];
                  else quoted = false;
              } else cell += c;
          } else if (c === '"') quoted = true;
          else if (c === sep[0] && text.startsWith(sep, i)) {
              row.push(cell);
              cell = '';
              i += sep.length - 1;
          } else if (c === '\n' || c === '\r') {
              const end = i;
              if (c === '\r' && text[i + 1] === '\n') i++;
              endRow(end);
              start = i + 1;
          } else cell += c;
      }
      if (cell || row.length || start < text.length) endRow(text.length);
      return rows;
  }

  // One CSV cell, quoted as quote style says
  function csvQuote(value, sep, mode = 'minimal') {
      const quoted = `"${value.replace(/"/g, '""')}"`;
      if (mode === 'none') return value;
      if (mode === 'all') return quoted;
      if (mode === 'nonnumeric' && !NUMBER_RE.test(value.trim())) return quoted;
      const spaces = sep.startsWith(' ') && /^ | $/.test(value); // would blur into delimiter
      return value.includes(sep) || spaces || /["\r\n]/.test(value) ? quoted : value;
  }

  // Table view: fixed header and row numbers, sort, ▾ filter; opts.editable for CSV write mode
  /**
   * @param opts classOf: own colours per cell (with colour on);
   *   expand: rows that open a detail row below them (▸ in the row number)
   */
  function mountTable(
      content,
      header,
      rows,
      opts

  ,
  ) {
      const { state } = opts;
      for (const n of content.querySelectorAll(':scope > .tp-plus, :scope > .tp-col-widths')) n.remove(); // earlier table
      if (!state.widths) state.widths = new Map(); // column -> width in px (column edge drag)
      const widths = state.widths;
      const widthStyle = document.createElement('style');
      widthStyle.className = 'tp-col-widths';
      const tableId = Math.random().toString(36).slice(2);
      const applyWidths = () => {
          widthStyle.textContent = [...widths]
              .map(
                  ([c, w]) =>
                      `.tp-table[data-tid="${tableId}"] tr > :nth-child(${c + 2}) { width: ${w}px; min-width: ${w}px; max-width: ${w}px; }`,
              )
              .join('\n');
      };
      let cols = Math.max(header.length, ...rows.slice(0, 1000).map((r) => r.length));
      const edited = new Set(); // edited rows (row arrays themselves, so moves keep track)
      let allEdited = false; // columns added / moved: every line is written anew
      const table = document.createElement('table');
      table.className = opts.editable ? 'tp-table tp-editing' : 'tp-table';
      table.dataset.tid = tableId;
      let io = null;

      // Rows to show: filtered, then sorted (indexes into rows)
      const viewRows = () => {
          let idx = rows.map((_, i) => i);
          for (const [c, f] of state.filters) {
              const text = f.text.toLowerCase();
              idx = idx.filter((i) => {
                  const v = rows[i][c] ?? '';
                  return (!f.values || f.values.has(v)) && (!text || v.toLowerCase().includes(text));
              });
          }
          if (state.sort) {
              const { col, dir } = state.sort;
              const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
              idx.sort((a, b) => dir * cmp.compare(rows[a][col] ?? '', rows[b][col] ?? '') || a - b);
          }
          return idx;
      };

      const headHtml = () => {
          const all = opts.expand
              ? `<button class="tp-expand-all" title="${state.allOpen ? 'Collapse all rows shown' : 'Expand all rows shown (as filtered)'}">${state.allOpen ? '▾' : '▸'}</button>`
              : '';
          let cells = `<th class="tp-rn">${all}</th>`;
          const drag = opts.editable ? ' draggable="true"' : '';
          for (let c = 0; c < cols; c++) {
              const sort = state.sort && state.sort.col === c ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '';
              const active = state.filters.has(c) ? ' tp-on' : '';
              const bin = opts.editable
                  ? `<button class="tp-col-delete" data-c="${c}" draggable="false" title="Delete this column">${BIN_SVG}</button>`
                  : '';
              const line =
                  opts.colour && !opts.classOf
                      ? ` style="border-bottom-color: var(--tp-${CSV_COLOURS[c % CSV_COLOURS.length]})"`
                      : '';
              cells +=
                  `<th data-c="${c}"${drag}${line}><span class="tp-sort">${esc(header[c] ?? '')}${sort}</span>` +
                  `<button class="tp-filter${active}" data-c="${c}" title="Filter">▾</button>${bin}` +
                  `<span class="tp-resize" data-c="${c}" title="Drag to change the width"></span></th>`;
          }
          return `<thead><tr>${cells}</tr></thead>`;
      };

      const colourOf = (c, value) => {
          if (!opts.colour) return '';
          const cls = opts.classOf ? opts.classOf(c, value) : CSV_COLOURS[c % CSV_COLOURS.length];
          return cls ? ` class="tp-${cls}"` : '';
      };
      const rowHtml = (i, pos) => {
          const r = rows[i];
          const edit = opts.editable ? ' contenteditable="plaintext-only"' : '';
          let cells = '';
          for (let c = 0; c < cols; c++) {
              const t = esc(r[c] ?? '');
              const title = t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE)} …` : t; // long cells: tooltip shortened
              cells += `<td data-r="${i}" data-c="${c}"${colourOf(c, r[c] ?? '')} title="${title}"${edit}>${t}</td>`;
          }
          const drag = opts.editable ? ' draggable="true" title="Drag to move this row"' : '';
          const open = !!state.expanded?.has(i);
          const toggle = opts.expand?.can(i) ? toggleHtml(i, open) : '';
          const row =
              `<tr${pos % 2 ? ' class="tp-stripe"' : ''}><td class="tp-rn" data-row="${i}"${drag}>` +
              `${toggle}${(i + 1).toLocaleString()}</td>${cells}</tr>`;
          return open ? row + detailHtml(i) : row;
      };

      // Detail rows (expand): ▸ / ▾ in the row number, detail below the row; open ones kept in state
      const toggleHtml = (i, open) =>
          `<button class="tp-expand" data-x="${i}" title="${open ? 'Collapse' : esc(opts.expand?.title ?? '')}">${open ? '▾' : '▸'}</button>`;
      const detailHtml = (i) =>
          `<tr class="tp-detail"><td class="tp-rn"></td><td colspan="${cols}"><div class="tp-detail-box">` +
          `${opts.expand?.html(i) ?? ''}</div></td></tr>`;
      // All rows shown (filters applied) open or closed at once
      const toggleAll = () => {
          if (!state.expanded) state.expanded = new Set();
          const shown = viewRows().filter((i) => opts.expand?.can(i));
          state.allOpen = !state.allOpen;
          for (const i of shown) state.allOpen ? state.expanded.add(i) : state.expanded.delete(i);
          build();
      };
      const toggleDetail = (btn) => {
          const i = Number(btn.dataset.x);
          const tr = btn.closest('tr');
          if (!state.expanded) state.expanded = new Set();
          const open = !state.expanded.has(i);
          if (open) {
              state.expanded.add(i);
              tr.insertAdjacentHTML('afterend', detailHtml(i));
          } else {
              state.expanded.delete(i);
              if (tr.nextElementSibling?.classList.contains('tp-detail')) tr.nextElementSibling.remove();
          }
          btn.outerHTML = toggleHtml(i, open);
      };

      // Structure edits use file's order (sort and filters off first)
      const moveItem = (list, from, to) => {
          const [item] = list.splice(from, 1);
          list.splice(to > from ? to - 1 : to, 0, item);
      };
      const structure = (act, at, to) => {
          state.sort = null;
          state.filters.clear();
          if (act.startsWith('col-')) widths.clear(); // columns shift: widths start fresh
          if (act === 'row-insert') {
              rows.splice(at, 0, new Array(cols).fill(''));
          } else if (act === 'row-move') {
              if (at === to || at + 1 === to) return;
              moveItem(rows, at, to); // moves come with their target
          } else if (act === 'col-insert') {
              const name = prompt('Name of the new column:', '');
              if (name === null) return;
              for (const r of [header, ...rows]) {
                  while (r.length < at) r.push('');
                  r.splice(at, 0, r === header ? name : '');
              }
              cols++;
              allEdited = true;
          } else if (act === 'col-delete') {
              if (!confirm(`Delete the column "${header[at] ?? ''}" and its contents?`)) return;
              for (const r of [header, ...rows]) if (r.length > at) r.splice(at, 1);
              cols--;
              allEdited = true;
          } else if (act === 'col-move') {
              if (at === to || at + 1 === to) return;
              for (const r of [header, ...rows]) {
                  while (r.length < cols) r.push('');
                  moveItem(r, at, to);
              }
              allEdited = true;
          }
          build();
          opts.onEdit?.();
      };

      const ROW_HEIGHT = 23 * (Number(content.style?.getPropertyValue?.('--tp-zoom')) || 1); // text size (panel)
      const spacer = (h) => `<tr class="tp-spacer"><td colspan="${cols + 1}" style="height:${h}px"></td></tr>`;

      const build = () => {
          io?.disconnect();
          const view = viewRows();
          table.innerHTML = headHtml();
          const blocks = [];
          for (let from = 0; from < view.length; from += CHUNK_LINES) {
              const body = document.createElement('tbody');
              body.dataset.from = String(from);
              body.dataset.count = String(Math.min(CHUNK_LINES, view.length - from));
              body.innerHTML = spacer(Number(body.dataset.count) * ROW_HEIGHT);
              table.append(body);
              blocks.push(body);
          }
          const fill = (b) => {
              if (b.dataset.on) return;
              b.innerHTML = view
                  .slice(Number(b.dataset.from), Number(b.dataset.from) + Number(b.dataset.count))
                  .map((i, k) => rowHtml(i, Number(b.dataset.from) + k))
                  .join('');
              b.dataset.on = '1';
          };
          const empty = (b) => {
              if (!b.dataset.on || b.contains(document.activeElement)) return; // keep cell being edited
              b.innerHTML = spacer(b.getBoundingClientRect().height);
              delete b.dataset.on;
          };
          io = watchBlocks(content, blocks, fill, empty);
      };

      // Sort: click column title
      table.addEventListener('click', (e) => {
          if ((e.target).closest('.tp-resize')) return; // end of width change, not sort
          const expand = (e.target).closest('.tp-expand');
          if (expand) return void toggleDetail(expand);
          if ((e.target).closest('.tp-expand-all')) return void toggleAll();
          const del = (e.target).closest('.tp-col-delete');
          if (del) return void structure('col-delete', Number(del.dataset.c));
          const btn = (e.target).closest('.tp-filter');
          if (btn) return void openFilter(btn, Number(btn.dataset.c));
          const th = (e.target).closest('th[data-c]');
          if (!th) return;
          const col = Number(th.dataset.c);
          const s = state.sort;
          state.sort = !s || s.col !== col ? { col, dir: 1 } : s.dir > 0 ? { col, dir: -1 } : null;
          build();
      });

      // Filter panel: unique values with checkboxes, plus "contains" text field
      let panel = null;
      const closePanel = () => {
          panel?.remove();
          panel = null;
          document.removeEventListener('pointerdown', outside, true);
      };
      const outside = (e) => {
          if (panel && !panel.contains(e.target) && !(e.target).closest('.tp-filter'))
              closePanel();
      };
      const openFilter = (btn, c) => {
          closePanel();
          const f = state.filters.get(c) || { values: null, text: '' };
          const counts = new Map();
          for (const r of rows) counts.set(r[c] ?? '', (counts.get(r[c] ?? '') || 0) + 1);
          const cmp = new Intl.Collator(undefined, { numeric: true }).compare;
          const values = [...counts.keys()].sort(cmp).slice(0, 1000);
          panel = document.createElement('div');
          panel.className = 'tp-filter-panel';
          const items = values
              .map(
                  (val, i) => `
          <label><input type="checkbox" data-i="${i}"${!f.values || f.values.has(val) ? ' checked' : ''}>
          ${esc(val || '(empty)')} <span>${counts.get(val)}</span></label>`,
              )
              .join('');
          const more =
              counts.size > values.length ? `<small>first ${values.length} of ${counts.size} values</small>` : '';
          panel.innerHTML = `
        <input type="text" placeholder="contains …" value="${esc(f.text)}">
        <label><input type="checkbox" data-all> <em>all</em></label>
        <div class="tp-filter-list">${items}
        </div>
        ${more}
      `;
          const r = btn.getBoundingClientRect();
          const box = content.getBoundingClientRect();
          panel.style.left = `${Math.max(0, Math.min(r.left - box.left, box.width - 240))}px`;
          panel.style.top = `${r.bottom - box.top + 2}px`;
          (content.parentElement).append(panel); // content sits in the viewer
          document.addEventListener('pointerdown', outside, true);

          const boxes = [...panel.querySelectorAll('[data-i]')]; // checkboxes
          const all = panel.querySelector('[data-all]'); // in the panel's HTML above
          const input = panel.querySelector('input[type="text"]');
          all.checked = boxes.every((b) => b.checked);
          const apply = () => {
              const checked = boxes.filter((b) => b.checked).map((b) => values[Number(b.dataset.i)]);
              const everything = checked.length === values.length;
              const nf = { values: everything ? null : new Set(checked), text: input.value };
              if (!nf.values && !nf.text) state.filters.delete(c);
              else state.filters.set(c, nf);
              build();
          };
          all.onchange = () => {
              for (const b of boxes) b.checked = all.checked;
              apply();
          };
          (panel.querySelector('.tp-filter-list')).onchange = () => {
              all.checked = boxes.every((b) => b.checked);
              apply();
          };
          input.oninput = () => {
              const t = input.value.toLowerCase();
              for (const b of boxes) {
                  (b.parentElement).style.display = values[Number(b.dataset.i)].toLowerCase().includes(t)
                      ? ''
                      : 'none';
              }
              apply();
          };
          input.focus();
      };

      // Write mode: drag row numbers / column titles to move; "+" at edges to insert
      if (opts.editable) {
          let dragging = null; // { kind: 'row'|'col', from }
          const dropTarget = (e) => {
              if (!dragging) return null;
              const el =
                  dragging.kind === 'row'
                      ? (e.target).closest('td.tp-rn[data-row]')
                      : (e.target).closest('th[data-c]');
              if (!el) return null;
              const r = el.getBoundingClientRect();
              const i = dragging.kind === 'row' ? Number(el.dataset.row) : Number(el.dataset.c);
              const after = dragging.kind === 'row' ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
              return { el, to: after ? i + 1 : i, after };
          };
          const clearMarks = () => {
              for (const el of table.querySelectorAll('.tp-drop-before, .tp-drop-after')) {
                  el.classList.remove('tp-drop-before', 'tp-drop-after');
              }
          };
          table.addEventListener('dragstart', (e) => {
              const rn = (e.target).closest?.('td.tp-rn[data-row]');
              const th = (e.target).closest?.('th[data-c]');
              if (!rn && !th) return;
              if ((e.target).closest?.('.tp-col-delete, .tp-filter, .tp-resize'))
                  return void e.preventDefault();
              dragging = rn
                  ? { kind: 'row', from: Number(rn.dataset.row) }
                  : { kind: 'col', from: Number((th).dataset.c) };
              const transfer = e.dataTransfer; // always set on dragstart
              transfer.effectAllowed = 'move';
              transfer.setData('text/x-tp-move', '1');
              e.stopPropagation();
          });
          table.addEventListener('dragover', (e) => {
              const t = dropTarget(e);
              if (!t) return;
              e.preventDefault();
              e.stopPropagation();
              clearMarks();
              t.el.classList.add(t.after ? 'tp-drop-after' : 'tp-drop-before');
          });
          table.addEventListener('drop', (e) => {
              const t = dropTarget(e);
              clearMarks();
              if (!t) return;
              e.preventDefault();
              e.stopPropagation();
              const { kind, from } = dragging; // drop target found: dragging
              dragging = null;
              structure(kind === 'row' ? 'row-move' : 'col-move', from, t.to);
          });
          table.addEventListener('dragend', () => {
              dragging = null;
              clearMarks();
          });

          const plus = document.createElement('button');
          plus.className = 'tp-plus';
          plus.textContent = '+';
          plus.hidden = true;
          let plusAt = null;
          const EDGE = 6; // px from line that count as "on line"
          const showPlus = (kind, at, x, y) => {
              const box = content.getBoundingClientRect();
              plus.style.left = `${x - box.left + content.scrollLeft - 8}px`;
              plus.style.top = `${y - box.top + content.scrollTop - 8}px`;
              plus.title = kind === 'row' ? 'Insert a row here' : 'Insert a column here';
              plus.hidden = false;
              plusAt = { kind, at };
          };
          table.addEventListener('mousemove', (e) => {
              if (dragging) return;
              const rn = (e.target).closest('td.tp-rn[data-row]');
              const corner = (e.target).closest('th.tp-rn');
              const th = (e.target).closest('th[data-c]');
              if (rn || corner) {
                  const r = ((rn || corner)).getBoundingClientRect();
                  const i = rn ? Number(rn.dataset.row) : -1;
                  if (rn && e.clientY - r.top < EDGE) return showPlus('row', i, r.left, r.top);
                  if (r.bottom - e.clientY < EDGE) return showPlus('row', i + 1, r.left, r.bottom);
              } else if (th) {
                  const r = th.getBoundingClientRect();
                  const c = Number(th.dataset.c);
                  const upper = e.clientY - r.top < r.height * 0.4; // lower part: width handle
                  if (upper && e.clientX - r.left < EDGE) return showPlus('col', c, r.left, r.top + 6);
                  if (upper && r.right - e.clientX < EDGE) return showPlus('col', c + 1, r.right, r.top + 6);
              }
              plus.hidden = true;
          });
          content.addEventListener('mouseleave', () => (plus.hidden = true));
          plus.onclick = () => {
              plus.hidden = true;
              if (plusAt) structure(plusAt.kind === 'row' ? 'row-insert' : 'col-insert', plusAt.at);
          };
          content.append(plus);
      }

      // Cell edits (CSV write mode)
      if (opts.editable) {
          table.addEventListener('input', (e) => {
              const td = (e.target).closest('td[data-r]');
              if (!td) return;
              const i = Number(td.dataset.r);
              while (rows[i].length < cols) rows[i].push('');
              rows[i][Number(td.dataset.c)] = td.textContent;
              edited.add(rows[i]);
              opts.onEdit?.();
          });
          table.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' && !e.shiftKey && (e.target).closest('td[data-r]')) {
                  e.preventDefault();
                  (e.target).blur();
              }
          });
      }

      const extras = [...content.querySelectorAll(':scope > .tp-plus')];
      content.replaceChildren(table, widthStyle, ...extras);
      applyWidths();
      build();

      // Column widths: drag lower right edge of title (upper part has "+")
      table.addEventListener('pointerdown', (e) => {
          const handle = (e.target).closest('.tp-resize');
          if (!handle) return;
          e.preventDefault();
          e.stopPropagation();
          const c = Number(handle.dataset.c);
          const startX = e.clientX;
          const startW = (handle.parentElement).getBoundingClientRect().width;
          handle.setPointerCapture(e.pointerId);
          const move = (ev) => {
              widths.set(c, Math.max(40, Math.round(startW + ev.clientX - startX)));
              applyWidths();
          };
          const up = () => {
              handle.removeEventListener('pointermove', move);
              handle.removeEventListener('pointerup', up);
              handle.removeEventListener('pointercancel', up);
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', up);
          handle.addEventListener('pointercancel', up);
      });

      return {
          stop: () => {
              io?.disconnect();
              closePanel();
          },
          show: () => {},
          // As CSV: edited rows rewritten, others as before (all with chosen format)
          csvText: () => {
              const sep = (opts.format?.sep || opts.sep); // tables in write mode come with their delimiter
              const quote = opts.format?.quote || 'minimal';
              const all = allEdited || !!opts.format?.sep || !!opts.format?.quote;
              return [header, ...rows]
                  .map((r) =>
                      all || edited.has(r) || (r).raw === undefined
                          ? r.map((v) => csvQuote(v ?? '', sep, quote)).join(sep)
                          : ((r).raw),
                  )
                  .join('\n');
          },
      };
  }

  // Module: text/highlight/csv.ts

  // CSV highlighting: delimiter detection, column colours

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // CSV: one colour per column (cycles); "quoted" fields may hold separators, "" and breaks
  const SEPARATOR_NAMES = {
      ',': 'comma',
      ';': 'semicolon',
      '\t': 'tab',
      '  ': '2 spaces',
      '    ': '4 spaces',
      '        ': '8 spaces',
  };
  const CSV_COLOURS = ['key', 'str', 'num', 'type', 'enum', 'meta', 'anchor', 'attr'];

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Delimiter: , ; or tab, one in every first line most often (ties: that order);
  // else widest run of spaces that splits all lines alike
  /** @returns ',' ';' tab, or a run of spaces */
  function csvSeparator(text) {
      const lines = text
          .split('\n', 6)
          .filter((l) => l.trim())
          .slice(0, 5);
      let best = ',';
      let bestScore = -1;
      for (const sep of [',', ';', '\t']) {
          const counts = lines.map((line) => {
              let n = 0;
              let quoted = false;
              for (const c of line) {
                  if (c === '"') quoted = !quoted;
                  else if (c === sep && !quoted) n++;
              }
              return n;
          });
          const score = counts.length ? Math.min(...counts) : 0;
          if (score > bestScore) {
              bestScore = score;
              best = sep;
          }
      }
      if (bestScore > 0) return best;
      // Spaces: widest gap that splits every line into same number (> 1) of columns
      for (const sep of ['        ', '    ', '  ']) {
          const counts = new Set(parseCsv(lines.join('\n'), sep).map((r) => r.length));
          if (lines.length && counts.size === 1 && !counts.has(1)) return sep;
      }
      return best;
  }

  function highlightCsv(text) {
      const sep = csvSeparator(text);
      const out = [];
      let col = 0;
      let field = '';
      let quoted = false;

      const flush = () => {
          if (field) out.push([CSV_COLOURS[col % CSV_COLOURS.length], field]);
          field = '';
      };
      for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (quoted) {
              field += c;
              if (c === '"') {
                  if (text[i + 1] === '"')
                      field += text[++i]; // "" inside quotes
                  else quoted = false;
              }
          } else if (c === '"') {
              field += c;
              quoted = true;
          } else if (c === sep) {
              flush();
              out.push(['punct', c]);
              col++;
          } else if (c === '\n') {
              flush();
              out.push(['', c]);
              col = 0;
          } else {
              field += c;
          }
      }
      flush();
      return out;
  }

  // Module: _core/prefs.ts

  // Preferences kept in the browser (localStorage): theme, colours, wrap, CSV format, view choices (some per file)

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const THEME_KEY = 'tp-preview-theme';
  const COLOUR_KEY = 'tp-preview-colours-text';
  const WRAP_KEY = 'tp-preview-wrap';
  const ZOOM_KEY = 'tp-preview-zoom'; // text size in the content area (1 = 100 %)
  const ZOOM_RANGE = [0.5, 3];
  const PROPS_KEY = 'tp-preview-properties'; // properties line shown (default) or hidden
  const CSV_SEP_KEY = 'tp-preview-csv-sep'; // '' = as in file
  const CSV_QUOTE_KEY = 'tp-preview-csv-quote'; // '' = as in file

  const COLOUR_TABLE_KEY = 'tp-preview-colours-table';
  const COLOUR_SHEET_KEY = 'tp-preview-colours-sheet';
  const COLOUR_LOG_KEY = 'tp-preview-colours-log';
  const COLOUR_KEYS = { text: COLOUR_KEY, table: COLOUR_TABLE_KEY, sheet: COLOUR_SHEET_KEY, log: COLOUR_LOG_KEY };

  // Spreadsheets: sheets or tables, per file (most recent first, the oldest dropped)
  const SHEET_MODES_KEY = 'tp-preview-sheet-modes';
  const MAX_SHEET_MODES = 500;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Settings remembered in browser (localStorage): light / dark, colours, line wrap
  function loadPref(key, fallback) {
      try {
          return localStorage.getItem(key) ?? fallback;
      } catch {
          return fallback;
      }
  }

  function removePref(key) {
      try {
          localStorage.removeItem(key);
      } catch {}
  }

  function savePref(key, value) {
      try {
          localStorage.setItem(key, value);
      } catch {}
  }

  // Sheets or tables chosen for a spreadsheet (file path -> mode)
  function sheetModes() {
      try {
          const modes = JSON.parse(loadPref(SHEET_MODES_KEY, '{}'));
          return modes && typeof modes === 'object' && !Array.isArray(modes) ? modes : {};
      } catch {
          return {};
      }
  }

  // View of a spreadsheet: last choice for this file, else the setting
  function sheetMode(url) {
      const mode = sheetModes()[url] ?? DEFAULT_SHEET_VIEW;
      return mode === 'tables' ? 'tables' : 'sheets';
  }

  function rememberSheetMode(url, mode) {
      const modes = sheetModes();
      delete modes[url];
      const kept = Object.entries(modes).slice(0, MAX_SHEET_MODES - 1);
      savePref(SHEET_MODES_KEY, JSON.stringify(Object.fromEntries([[url, mode], ...kept])));
  }

  // Delimiter / quote style chosen in write mode ('' = keep file's own)
  const csvFormat = { sep: loadPref(CSV_SEP_KEY, '') || '', quote: loadPref(CSV_QUOTE_KEY, '') || '' };
  if (!(csvFormat.sep in SEPARATOR_NAMES)) csvFormat.sep = '';
  if (csvFormat.quote && !QUOTE_MODES[csvFormat.quote]) csvFormat.quote = '';

  const colourPrefs = {
      text: loadPref(COLOUR_KEY, DEFAULT_COLOURS ? '1' : '0') === '1',
      table: loadPref(COLOUR_TABLE_KEY, DEFAULT_TABLE_COLOURS ? '1' : '0') === '1',
      sheet: loadPref(COLOUR_SHEET_KEY, DEFAULT_SHEET_COLOURS ? '1' : '0') === '1',
      log: loadPref(COLOUR_LOG_KEY, DEFAULT_LOG_COLOURS ? '1' : '0') === '1',
  };

  // Remembered view choices (localStorage); settings give the start values
  const view = {
      // View choices: settings are start values, last choice is remembered (localStorage)
      table: loadPref('tp-preview-table', '1') === '1',
      logTable: loadPref('tp-preview-log-table', '0') === '1', // logs: text first (table experimental)
      // Lines of metadata shown (drag grip below it)
      metaLines: Math.max(1, Math.min(6, Number(loadPref('tp-preview-meta-lines', '1')) || 1)),
      props: loadPref('tp-preview-properties', '0') === '1',
      // Layout: popup / vertical / horizontal
      mode: (['popup', 'vertical', 'horizontal'].includes(loadPref('tp-preview-mode', ''))
          ? loadPref('tp-preview-mode', '')
          : DEFAULT_MODE),
      theme: ['light', 'dark'].includes(loadPref(THEME_KEY, '')) ? loadPref(THEME_KEY, '') : THEME,
      wrap: loadPref(WRAP_KEY, DEFAULT_WRAP ? '1' : '0') === '1',
      // 3D view chosen by user
      show3d: loadPref('tp-preview-3d', '0') === '1',
      // Markdown rendered (else its text)
      markdown: loadPref('tp-preview-markdown', '1') === '1',
      // Text size in the content area (text, table, Markdown, editor)
      zoom: Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], Number(loadPref(ZOOM_KEY, '1')) || 1)),
  };

  // Module: ui/move.ts

  // Movable windows (settings, popup): position kept in localStorage, inside screen

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function loadOffset(key) {
      try {
          const o = JSON.parse(loadPref(key, 'null'));
          if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return o;
      } catch {}
      return { x: 0, y: 0 };
  }

  // Offset clamped so top edge and 80 px of window stay on screen
  function clampOffset(o, base) {
      return {
          x: Math.round(Math.min(innerWidth - 80 - base.left, Math.max(80 - base.left - base.width, o.x))),
          y: Math.round(Math.min(innerHeight - 40 - base.top, Math.max(-base.top, o.y))),
      };
  }

  // Apply remembered offset to `target` (CSS translate)
  function placeMoved(target, key) {
      target.style.translate = '0 0';
      if (!target.isConnected) return void requestAnimationFrame(() => target.isConnected && placeMoved(target, key));
      const base = target.getBoundingClientRect();
      const o = clampOffset(loadOffset(key), base);
      target.style.translate = `${o.x}px ${o.y}px`;
  }

  // Drag `target` from pointerdown on its handle
  function startMove(e, target, key) {
      e.preventDefault();
      const handle = e.currentTarget; // the element the listener is on
      handle.setPointerCapture(e.pointerId);
      const now = target.getBoundingClientRect();
      const o = loadOffset(key);
      // current offset ("10px 20px"; browser shortens "10px 0px" to "10px")
      const [tx = 0, ty = 0] = (target.style.translate || '').split(' ').map((v) => parseFloat(v) || 0);
      const base = new DOMRect(now.left - tx, now.top - ty, now.width, now.height);
      const start = { x: e.clientX - tx, y: e.clientY - ty };
      let last = { x: tx, y: ty };
      const move = (ev) => {
          last = clampOffset({ x: ev.clientX - start.x, y: ev.clientY - start.y }, base);
          target.style.translate = `${last.x}px ${last.y}px`;
      };
      const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          if (last.x !== o.x || last.y !== o.y) savePref(key, JSON.stringify(last));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
  }

  // Module: _core/settings-form.ts

  // Settings form (Tampermonkey menu): form and JSON views, validation, reset

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Settings form, opened from Tampermonkey menu: [key, label, choices or unit]
  const SETTING_FORM = [
      ['layout', 'Layout', ['horizontal', 'vertical', 'popup']],
      ['viewer-share', 'Viewer takes up % of screen'],
      ['theme', 'Colours', ['dark', 'light']],
      ['show-whitespace', 'Display whitespaces'],
      ['wrap-lines', 'Wrap long lines'],
      ['colours-text', 'Syntax highlighting (text view)'],
      ['colours-table', 'Syntax highlighting (table view)'],
      ['colours-log', 'Syntax highlighting (table view of logs)'],
      ['colours-sheet', 'Column colours (spreadsheets)'],
      ['spreadsheet-view', 'Spreadsheets show', ['tables', 'sheets']],
      ['spreadsheet-autoload-bytes', 'Spreadsheets: show first sheet / table at once up to', 'KB'],
      ['cache-chunk-bytes', 'Cache chunk size', 'KB'],
      ['memory-cache-bytes', 'Cache limit (all files)', 'MB'],
      ['cache-all-confirm-bytes', 'Warn full file cache if file size exceeds', 'MB'],
      ['parquet-rows', 'Table rows shown'],
      ['max-line-chars', 'Lines cut after (characters)'],
      ['follow-links', 'Follow .url link files'],
      ['viewer-3d-folder', '3D viewer folder', 'Shared Documents/previewer  or  /sites/…/previewer'],
      ['viewer-3d-max-bytes', '3D view up to', 'MB'],
      ['logo', 'Logo (data:image/… URI, empty = no image)'],
  ];
  const UNIT_BYTES = { KB: 1024, MB: 1024 * 1024 };

  // Defaults by key (any setting)
  const defaults = DEFAULTS;

  // Start-value settings for viewer choices in browser storage
  const REMEMBERED_BY = {
      'layout': 'tp-preview-mode',
      'viewer-share': 'tp-preview-split',
      'theme': 'tp-preview-theme',
      'wrap-lines': 'tp-preview-wrap',
      'colours-text': 'tp-preview-colours-text',
      'colours-table': 'tp-preview-colours-table',
      'colours-log': 'tp-preview-colours-log',
      'colours-sheet': 'tp-preview-colours-sheet',
      'spreadsheet-view': 'tp-preview-sheet-modes',
  };
  const SETTINGS_POS_KEY = 'tp-preview-settings-pos';
  const POPUP_POS_KEY = 'tp-preview-popup-pos';

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function openSettingsForm() {
      document.querySelector('.tp-settings')?.remove();
      const wrap = document.createElement('div');
      wrap.className = 'tp-settings';
      // Follow viewer's light / dark choice; soft colours instead of pure white
      const dark = view.theme === 'dark';
      const c = dark
          ? {
                bg: '#2b2b2e',
                fg: '#e6e6e6',
                field: '#1f1f22',
                border: '#55555a',
                muted: '#a8a8ad',
                bad: '#f1707b',
                warn: '#e3b341',
            }
          : {
                bg: '#f4f3f1',
                fg: '#242322',
                field: '#fbfaf9',
                border: '#c8c6c4',
                muted: '#605e5c',
                bad: '#c50f1f',
                warn: '#8a5300',
            };
      const font = "'Segoe UI', system-ui, -apple-system, sans-serif"; // single quotes: used inside style="…"
      const mono = 'Consolas, monospace';
      wrap.style.cssText = `position:fixed; inset:0; z-index:2147483100; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; font:13px ${font};`;
      const form = document.createElement('form');
      form.style.cssText = `background:${c.bg}; color:${c.fg}; padding:20px 24px; border-radius:10px; width:min(620px, 92vw); max-height:86vh; overflow:auto; box-shadow:0 8px 32px rgba(0,0,0,.3); font:13px ${font}; color-scheme:${dark ? 'dark' : 'light'}; user-select:text;`;
      const field = `font:13px ${font}; color:${c.fg}; background:${c.field}; padding:4px 8px; border:1px solid ${c.border}; border-radius:6px; box-sizing:border-box;`;
      const stored = Object.fromEntries(
          SETTING_FORM.map(([key]) => [key, GM_getValue(key, defaults[key])]),
      );

      const rows = SETTING_FORM.map(([key, label, extra]) => {
          if (key === 'logo') {
              // full line, four lines high, wraps, scrolls
              return (
                  `<div style="grid-column:1 / -1; margin-top:4px; user-select:text; cursor:text">${esc(label)}</div>` +
                  `<textarea name="${key}" rows="4" spellcheck="false" style="grid-column:1 / -1; ${field} width:100%; ` +
                  `resize:none; overflow-y:auto; word-break:break-all; font-family:${mono}; font-size:12px; line-height:16px; height:${4 * 16 + 10}px"></textarea>`
              );
          }
          let input;
          if (key === 'viewer-share') {
              // slider over full 0–100 %, held between 20 and 80 %
              input =
                  `<input type="range" name="${key}" min="0" max="100" step="1" style="width:140px; margin:0">` +
                  '<span data-pct style="margin-left:8px; min-width:3em"></span>';
          } else if (Array.isArray(extra)) {
              const options = extra.map((o) => `<option>${o}</option>`).join('');
              input = `<select name="${key}" style="${field} width:140px">${options}</select>`;
          } else if (typeof defaults[key] === 'boolean') {
              input = `<input type="checkbox" name="${key}" style="margin:0; width:16px; height:16px">`;
          } else if (typeof defaults[key] === 'number') {
              input =
                  `<input type="number" step="any" name="${key}" style="${field} width:140px">` +
                  (extra ? `<span style="margin-left:6px">${extra}</span>` : '');
          } else {
              input = `<input type="text" name="${key}" placeholder="${esc(extra || '')}" style="${field} width:100%">`;
          }
          // plain text (not a <label>): selectable, and click doesn't toggle field
          return (
              `<span style="align-self:center; user-select:text; cursor:text">${esc(label)}</span>` +
              `<div style="display:flex; align-items:center; min-width:0">${input}</div>`
          );
      });
      const tab = (mode, text) =>
          `<button type="button" data-mode="${mode}" style="border:none; padding:4px 12px; font:12px ${font}; cursor:pointer">${text}</button>`;
      form.innerHTML = `<div data-drag title="Drag to move" style="display:flex; align-items:center; gap:12px; margin:0 0 14px; cursor:move">
        <div style="display:flex; border:1px solid ${c.border}; border-radius:6px; overflow:hidden">${tab('form', 'Form')}${tab('json', 'JSON')}</div>
        <h3 style="flex:1; margin:0; font:600 16px ${font}">Sharepoint Previewer: settings</h3>
        <button type="button" data-act="close" title="Close" style="width:28px; height:28px; padding:0; border:none; border-radius:6px; background:transparent; color:${c.fg}; font:18px/1 ${font}; cursor:pointer">✕</button>
      </div>
      <div data-pane="form" style="display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:10px 16px">${rows.join('')}</div>
      <div data-pane="json" style="display:none">
        <div style="position:relative">
          <textarea data-json spellcheck="false" style="${field} width:100%; height:360px; resize:none; overflow-x:hidden; overflow-y:auto; white-space:pre-wrap; word-break:break-all; font:12px/17px ${mono}"></textarea>
          <button type="button" data-act="copy" title="Copy all" style="${field} position:absolute; top:6px; right:28px; width:28px; height:28px; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:.9">${COPY_SVG}</button>
        </div>
        <div data-errors style="color:${c.bad}; margin-top:6px; height:34px; overflow-y:auto; white-space:pre-line; font-size:12px; line-height:17px"></div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-top:18px">
        <button type="button" data-act="reset" title="Fill in the defaults (saved only with Save)" style="${field} cursor:pointer; padding:5px 12px">Reset to defaults</button>
        <span data-note style="flex:1; min-width:0; color:${c.muted}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis"></span>
        <button type="button" data-act="cancel" style="${field} cursor:pointer; padding:5px 16px">Cancel</button>
        <button type="submit" data-act="save" style="${field} padding:5px 16px">Save</button>
      </div>`;
      // Parts of the form (all written in its HTML above)
      const part = (selector) => form.querySelector(selector);
      /** @returns input or select of a setting */
      const setting = (name) => form.elements.namedItem(name);
      const json = part('[data-json]');
      const errorsEl = part('[data-errors]');
      const note = part('[data-note]');
      const saveBtn = part('[data-act="save"]');
      const slider = setting('viewer-share');
      let mode = 'form';

      // Form inputs <-> stored values
      const setForm = (values) => {
          for (const [key, , extra] of SETTING_FORM) {
              const el = setting(key);
              const value = values[key];
              if (key === 'viewer-share') {
                  el.value = String(Math.round(Math.min(0.8, Math.max(0.2, Number(value))) * 100));
                  part('[data-pct]').textContent = `${el.value} %`;
              } else if (typeof defaults[key] === 'boolean') el.checked = Boolean(value);
              else if (typeof defaults[key] === 'number') {
                  const n = Number(value);
                  el.value = String(+(extra && UNIT_BYTES[String(extra)] ? n / UNIT_BYTES[String(extra)] : n).toFixed(2));
              } else el.value = String(value);
          }
      };
      const readForm = () =>
          Object.fromEntries(
              SETTING_FORM.map(([key, , extra]) => {
                  const el = setting(key);
                  const fallback = defaults[key];
                  let value;
                  if (key === 'viewer-share') value = Math.min(80, Math.max(20, Number(el.value))) / 100;
                  else if (typeof fallback === 'boolean') value = el.checked;
                  else if (typeof fallback === 'number') {
                      value = Number(el.value) * (UNIT_BYTES[String(extra)] || 1);
                      if (!Number.isFinite(value) || value <= 0) value = fallback;
                  } else value = el.value.trim();
                  return [key, value];
              }),
          );

      // JSON text <-> stored values (LOGO last, as it is long); reasons when it is not valid
      // (missing settings = defaults, unknown ones ignored: Save writes the completed JSON back)
      const toJson = (values) =>
          JSON.stringify(
              Object.fromEntries([
                  ...SETTING_FORM.filter(([key]) => key !== 'logo').map(([key]) => [key, values[key]]),
                  ['logo', values.logo],
              ]),
              null,
              2,
          );
      const readJson = () => {
          let data;
          try {
              data = JSON.parse(json.value);
          } catch (err) {
              return { errors: [`Not valid JSON: ${(err).message}`] };
          }
          if (!data || typeof data !== 'object' || Array.isArray(data))
              return { errors: ['The settings must be one JSON object { … }'] };
          data = completeSettings(data);
          const errors = [];
          const values = {};
          for (const [key, , extra] of SETTING_FORM) {
              const type = typeof defaults[key];
              const expected = type === 'boolean' ? 'true or false' : `a ${type}`;
              if (typeof data[key] !== type) {
                  errors.push(`${key}: must be ${expected}`);
                  continue;
              }
              const value = data[key]; // type checked above
              if (Array.isArray(extra) && !extra.includes(String(value))) {
                  const allowed = extra.map((o) => `"${o}"`).join(', ');
                  errors.push(`${key}: must be one of ${allowed}`);
              } else if (key === 'viewer-share' && (Number(value) < 0.2 || Number(value) > 0.8))
                  errors.push(`${key}: must be between 0.2 and 0.8`);
              else if (typeof value === 'number' && !(value > 0 && Number.isFinite(value)))
                  errors.push(`${key}: must be greater than 0`);
              // trimmed; share rounded to whole % (as form shows it)
              values[key] =
                  typeof value === 'string'
                      ? value.trim()
                      : key === 'viewer-share'
                        ? Math.round(Number(value) * 100) / 100
                        : value;
          }
          return errors.length ? { errors } : { values };
      };

      // JSON text replaced (Save, reset); border flashes briefly if it changed
      const setJson = (text) => {
          if (text === json.value) return;
          json.value = text;
          json.animate?.([{ borderColor: '#0078d4', boxShadow: '0 0 0 3px #0078d4' }, {}], {
              duration: 900,
              easing: 'ease-out',
          });
      };

      // Values currently entered (null: JSON not valid)
      const current = () => (mode === 'json' ? readJson().values || null : readForm());
      let saved = '';
      const changed = () => {
          const now = current();
          return now === null || JSON.stringify(now) !== saved;
      };

      // Save: blue while there are valid unsaved changes; clearly greyed out otherwise
      const update = () => {
          if (mode === 'json') {
              const { errors } = readJson();
              errorsEl.textContent = errors ? errors.join('\n') : '';
              errorsEl.style.color = c.bad;
              json.style.borderColor = errors ? c.bad : c.border;
              json.style.boxShadow = errors ? `0 0 0 1px ${c.bad}` : 'none';
          }
          const now = current();
          const on = now !== null && (JSON.stringify(now) !== saved || (mode === 'json' && json.value !== toJson(now)));
          saveBtn.disabled = !on;
          saveBtn.style.background = on ? '#0078d4' : 'transparent';
          saveBtn.style.borderColor = on ? '#0078d4' : c.border;
          saveBtn.style.borderStyle = on ? 'solid' : 'dashed';
          saveBtn.style.color = on ? '#fff' : c.muted;
          saveBtn.style.opacity = on ? '1' : '.45';
          saveBtn.style.cursor = on ? 'pointer' : 'not-allowed';
          if (changed()) note.textContent = '';
      };

      // Form / JSON switch: other view takes over values entered so far
      const setMode = (next) => {
          if (next === mode) return;
          if (next === 'form') {
              const { values, errors } = readJson();
              if (errors) {
                  note.textContent = 'Fix the JSON first (see the reasons below it).';
                  return;
              }
              setForm(values);
          } else {
              json.value = toJson(readForm());
          }
          mode = next;
          for (const pane of form.querySelectorAll('[data-pane]')) {
              pane.style.display = pane.dataset.pane !== mode ? 'none' : pane.dataset.pane === 'form' ? 'grid' : 'block';
          }
          for (const b of form.querySelectorAll('[data-mode]')) {
              const active = b.dataset.mode === mode;
              b.style.background = active ? '#0078d4' : 'transparent';
              b.style.color = active ? '#fff' : c.fg;
          }
          errorsEl.textContent = '';
          update();
      };
      form.querySelectorAll('[data-mode]').forEach((b) => {
          b.onclick = () => setMode(b.dataset.mode ?? '');
      });
      part('[data-act="reset"]').onclick = () => {
          setForm(DEFAULTS);
          if (mode === 'json') setJson(toJson(readForm()));
          update();
          note.textContent = 'Defaults filled in: Save to keep them.';
      };
      part('[data-act="copy"]').onclick = async () => {
          try {
              await navigator.clipboard.writeText(json.value);
          } catch {
              json.select();
              document.execCommand('copy');
          }
          note.textContent = 'Copied.';
      };

      setForm(stored);
      Object.assign(stored, readForm()); // as form shows them (e.g. 33 % instead of 1/3)
      mode = 'json'; // so that setMode below draws switch for form
      json.value = toJson(stored);
      saved = JSON.stringify(stored);
      setMode('form');
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      slider.oninput = () => {
          slider.value = String(Math.min(80, Math.max(20, Number(slider.value)))); // blocked below 20 %, above 80 %
          part('[data-pct]').textContent = `${slider.value} %`;
          update();
      };

      // JSON entered: obsolete settings dropped and missing ones added on Save (warning below JSON)
      const completions = () => {
          const keys = Object.keys(JSON.parse(json.value));
          const dropped = keys.filter((key) => !(key in DEFAULTS));
          const added = Object.keys(DEFAULTS).filter((key) => !keys.includes(key));
          return [
              dropped.length ? `Unrecognised/obsolete settings dropped: ${dropped.join(', ')}` : '',
              added.length ? `Missing settings added (defaults): ${added.join(', ')}` : '',
          ].filter(Boolean);
      };

      form.onsubmit = (e) => {
          e.preventDefault();
          const values = current();
          if (!values) return;
          const fresh = JSON.stringify(values) !== saved;
          if (fresh) {
              for (const [key, value] of Object.entries(values)) {
                  // changed start value replaces choice remembered from viewer
                  if (value !== stored[key] && REMEMBERED_BY[key]) removePref(REMEMBERED_BY[key]);
                  GM_setValue(key, value);
              }
              Object.assign(stored, values);
              saved = JSON.stringify(values);
          }
          const warnings = mode === 'json' ? completions() : [];
          if (mode === 'json') setJson(toJson(values));
          update();
          note.textContent = fresh ? 'Saved. Reload the page to apply.' : 'JSON completed: nothing new to save.';
          if (warnings.length) {
              errorsEl.style.color = c.warn;
              errorsEl.textContent = warnings.join('\n');
          }
      };

      // Close (✕, Cancel, Esc, click beside): asks first if unsaved
      const close = () => {
          if (changed() && !confirm('Close without saving your changes?')) return;
          document.removeEventListener('keydown', onKey, true);
          wrap.remove();
      };
      const onKey = (e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          close();
      };
      document.addEventListener('keydown', onKey, true);
      part('[data-act="close"]').onclick = close;
      part('[data-act="cancel"]').onclick = close;
      // click beside form closes it; selection dragged out of it doesn't
      let downOnBackdrop = false;
      wrap.onpointerdown = (e) => {
          downOnBackdrop = e.target === wrap;
      };
      wrap.onclick = (e) => {
          if (downOnBackdrop && e.target === wrap) close(); // block body: `return false` would cancel clicks
      };
      // Drag title row (not its buttons) to move window
      part('[data-drag]').addEventListener('pointerdown', (e) => {
          if (e.button === 0 && !(e.target).closest('button')) startMove(e, form, SETTINGS_POS_KEY);
      });

      wrap.append(form);
      document.body.append(wrap);
      // JSON view as high as form view: no jump on switch
      const formHeight = part('[data-pane="form"]').getBoundingClientRect().height;
      json.style.height = `${Math.max(200, Math.round(formHeight) - 43)}px`;
      placeMoved(form, SETTINGS_POS_KEY);
  }
  /**
   * Settings as given, missing ones from defaults, unknown ones dropped (values not checked).
   */
  function completeSettings(data) {
      return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, key in data ? data[key] : defaults[key]]));
  }
  /** Tampermonkey menu: settings form, reset to defaults. */
  function registerMenu() {
      GM_registerMenuCommand('Settings …', openSettingsForm);

      GM_registerMenuCommand('Reset settings to defaults', () => {
          if (!confirm('Reset all Sharepoint Previewer settings to their defaults?')) return;
          for (const [key, value] of Object.entries(DEFAULTS)) GM_setValue(key, value);
          alert('Settings reset. Reload the page to apply them.');
      });
  }

  // Module: text/lang.ts

  // Languages: names, detection from file names, indentation

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // File types (by extension) that get colours and checks
  const LANGS = [
      [
          'xml',
          /\.(xml|xsd|xsl|xslt|svg|xaml|config|csproj|vbproj|props|targets|resx|plist|kml|gpx|rss|atom|wsdl|addin)$/i,
      ], // .addin: Revit add-in manifest
      ['json', /\.(json|geojson|webmanifest|har)$/i],
      ['yaml', /\.ya?ml$/i],
      ['ifc', /\.ifc(zip)?$/i], // .ifczip: unpacked first
      ['toml', /\.toml$/i],
      ['m', /\.(pq|pqm|m)$/i], // Power Query M
      ['js', /\.(js|mjs|cjs|jsx)$/i], // JavaScript
      ['md', /\.(md|markdown|mdown|mkd)$/i], // Markdown
      ['rst', /\.rst$/i], // reStructuredText
      ['csv', /\.(csv|tsv)$/i], // CSV / TSV
      ['xlf', /\.xlf$/i], // Excel formulas
      ['sql', /\.sql$/i], // SQL
      ['py', /\.(py|pyw|pyi)$/i], // Python
      ['log', /\.log$/i], // log files
  ];

  const LANG_NAMES = {
      json: 'JSON',
      xml: 'XML',
      yaml: 'YAML',
      ifc: 'IFC (STEP)',
      toml: 'TOML',
      log: 'Log',
      m: 'Power Query M',
      js: 'JavaScript',
      md: 'Markdown',
      rst: 'reStructuredText',
      csv: 'CSV',
      xlf: 'Excel formulas',
      sql: 'SQL',
      py: 'Python',
  };

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // Language detection
  // ---------------------------------------------------------------------------

  // Indentation style of text: tabs, 2 / 4 / ... spaces, or mixed (from first 5,000 lines)
  function indentation(text) {
      let tabs = 0;
      let spaces = 0;
      let prev = 0;
      const steps = new Map(); // indent change between lines -> how often
      let count = 0;
      for (const line of text.split('\n', 5000)) {
          if (!line.trim()) continue;
          const lead = line.match(/^[ \t]*/)?.[0] ?? '';
          if (lead.includes('\t')) {
              tabs++;
              prev = 0;
              continue;
          }
          if (lead.length) spaces++;
          const step = Math.abs(lead.length - prev);
          if (step) steps.set(step, (steps.get(step) || 0) + 1);
          prev = lead.length;
          count++;
      }
      if (!tabs && !spaces) return count ? 'none' : null;
      if (tabs && spaces > tabs / 4 && tabs > spaces / 4) return 'mixed (tabs and spaces)';
      if (tabs > spaces) return 'tabs';
      let best = 0;
      let most = 0;
      for (const [step, n] of steps) {
          if (step <= 8 && (n > most || (n === most && step < best))) {
              best = step;
              most = n;
          }
      }
      return best ? `${best} spaces` : 'spaces';
  }

  const langOf = (name) => (LANGS.find(([, re]) => re.test(name)) || [null])[0];

  // Module: ui/styles.ts

  // Styles for code view and syntax colours

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const CSS = `
    .tp-light {
      --tp-bg: #fff;
      --tp-fg: #1f1f1f;
      --tp-header-bg: #fff;
      --tp-thead-bg: rgba(59, 58, 57, .95);
      --tp-thead-fg: #fff;
      --tp-stripe: rgba(0, 0, 0, .045);
      --tp-title: #323130;
      --tp-border: #edebe9;
      --tp-edge: #e1dfdd;
      --tp-btn-bg: #f3f2f1;
      --tp-btn-fg: #323130;
      --tp-accent: #0078d4;
      --tp-ln-fg: #a0a0a0;
      --tp-ln-bg: #f8f8f8;
      --tp-ln-border: #eee;
      --tp-err-ln-bg: #e51400;
      --tp-err-ln-fg: #fff;
      --tp-err-bg: #fde7e9;
      --tp-warn-ln-bg: #f2c811;
      --tp-warn-ln-fg: #000;
      --tp-warn-bg: #fff8e1;
      --tp-flash: #fff4ce;
      --tp-ok-bg: #dff6dd;
      --tp-ok-fg: #107c10;
      --tp-bad-bg: #fde7e9;
      --tp-bad-fg: #a80000;
      --tp-wait-bg: #f3f2f1;
      --tp-wait-fg: #605e5c;
      --tp-hover: #f3f2f1;
      --tp-sev-error: #a80000;
      --tp-sev-warning: #8a6d00;
      --tp-key: #0451a5;
      --tp-str: #a31515;
      --tp-num: #098658;
      --tp-lit: #0000ff;
      --tp-punct: #777;
      --tp-com: #008000;
      --tp-tag: #800000;
      --tp-attr: #e50000;
      --tp-aval: #0000ff;
      --tp-meta: #af00db;
      --tp-ent: #b5651d;
      --tp-ref: #af00db;
      --tp-type: #267f99;
      --tp-enum: #0070c1;
      --tp-kw: #af00db;
      --tp-anchor: #795e26;
      --tp-trunc: #8a8886;
      --tp-ws: rgba(0, 0, 0, .2);
      --tp-well-bg: #f3f2f1;
      --tp-well-shadow: inset 0 1px 3px rgba(0, 0, 0, .18), inset 0 -1px 0 rgba(255, 255, 255, .9);
    }
    .tp-dark {
      --tp-bg: #1e1e1e;
      --tp-fg: #d4d4d4;
      --tp-header-bg: #252526;
      --tp-thead-bg: rgba(72, 72, 74, .95);
      --tp-thead-fg: #f3f3f3;
      --tp-stripe: rgba(255, 255, 255, .045);
      --tp-title: #cccccc;
      --tp-border: #333;
      --tp-edge: #616161;
      --tp-btn-bg: #3c3c3c;
      --tp-btn-fg: #cccccc;
      --tp-accent: #0e639c;
      --tp-ln-fg: #858585;
      --tp-ln-bg: #1e1e1e;
      --tp-ln-border: #333;
      --tp-err-ln-bg: #be1100;
      --tp-err-ln-fg: #fff;
      --tp-err-bg: rgba(255, 0, 0, .15);
      --tp-warn-ln-bg: #cca700;
      --tp-warn-ln-fg: #000;
      --tp-warn-bg: rgba(204, 167, 0, .15);
      --tp-flash: rgba(255, 255, 0, .2);
      --tp-ok-bg: #1d3320;
      --tp-ok-fg: #89d185;
      --tp-bad-bg: #3a1d1d;
      --tp-bad-fg: #f48771;
      --tp-wait-bg: #2d2d2d;
      --tp-wait-fg: #a0a0a0;
      --tp-hover: #2a2d2e;
      --tp-sev-error: #f48771;
      --tp-sev-warning: #cca700;
      --tp-key: #9cdcfe;
      --tp-str: #ce9178;
      --tp-num: #b5cea8;
      --tp-lit: #569cd6;
      --tp-punct: #808080;
      --tp-com: #6a9955;
      --tp-tag: #569cd6;
      --tp-attr: #9cdcfe;
      --tp-aval: #ce9178;
      --tp-meta: #c586c0;
      --tp-ent: #d7ba7d;
      --tp-ref: #c586c0;
      --tp-type: #4ec9b0;
      --tp-enum: #4fc1ff;
      --tp-kw: #c586c0;
      --tp-anchor: #dcdcaa;
      --tp-trunc: #808080;
      --tp-ws: rgba(255, 255, 255, .18);
      --tp-well-bg: #1e1e1e;
      --tp-well-shadow: inset 0 1px 3px rgba(0, 0, 0, .6), inset 0 -1px 0 rgba(255, 255, 255, .06);
      color-scheme: dark;
    }

    .tp-viewer { background: var(--tp-bg); }
    .tp-header { background: var(--tp-header-bg); border-bottom: 1px solid var(--tp-border); }
    .tp-title { color: var(--tp-title); }
    /* File name sits in a recessed "valley" */
    .tp-well {
      padding: 0 10px;
      border-radius: 8px;
      background: var(--tp-well-bg);
      box-shadow: var(--tp-well-shadow);
    }
    /* Name in write mode: click to save under another name (box in its place); new file: marked */
    .tp-title-name.tp-renamable { cursor: text; border-bottom: 1px dashed currentColor; }
    .tp-title-name.tp-new-name::after { content: ' (new file)'; font-style: italic; opacity: .7; }
    .tp-name-input {
      width: 28ch;
      max-width: 60%;
      padding: 0 4px;
      font: inherit;
      color: var(--tp-fg);
      background: var(--tp-bg);
      border: 1px solid var(--tp-accent);
      border-radius: 3px;
      outline: none;
    }
    .tp-new-file {
      flex: none;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border: none;
      border-radius: 4px;
      background: var(--tp-accent);
      color: #fff;
      font: 12px sans-serif;
      cursor: pointer;
    }
    .tp-new-file[hidden] { display: none; }
    .tp-new-file svg { width: 14px; height: 14px; }
    .tp-mode-btn { background: var(--tp-btn-bg); color: var(--tp-btn-fg); }
    .tp-mode-btn[aria-pressed="true"] { background: var(--tp-accent); color: #fff; }
    .tp-mode-btn:disabled { opacity: .4; cursor: default; }
    /* Unavailable buttons are only greyed out, never shown as "on" (e.g. table view for non-tables) */
    .tp-viewer .tp-mode-btn[aria-pressed="true"]:disabled { background: transparent; color: var(--tp-btn-fg); }
    .tp-viewer .tp-mode-btn:not([aria-pressed="true"]) { background: transparent; color: var(--tp-btn-fg); }
    .tp-viewer .tp-mode-btn:not([aria-pressed="true"]):not(:disabled):hover { background: var(--tp-btn-bg); }
    .tp-menu {
      position: absolute;
      z-index: 6;
      min-width: 210px;
      padding: 4px;
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,.3);
    }
    .tp-menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 6px 10px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--tp-fg);
      font: 13px sans-serif;
      text-align: left;
      cursor: pointer;
    }
    .tp-menu-item:hover:not(:disabled) { background: var(--tp-hover); }
    .tp-menu-item:disabled { opacity: .4; cursor: default; }
    .tp-menu-item[aria-pressed="true"]::after { content: '✓'; margin-left: auto; color: var(--tp-accent); font-weight: 700; }
    .tp-attn { animation: tp-attn 3s ease-out; }
    @keyframes tp-attn {
      from { box-shadow: 0 0 0 4px rgba(0, 120, 212, .9); }
      to { box-shadow: 0 0 0 4px rgba(0, 120, 212, 0); }
    }
    .tp-load-more {
      background: var(--tp-header-bg);
      color: var(--tp-accent);
      border: none;
      border-top: 1px solid var(--tp-border);
    }
    .tp-dark .tp-load-more { color: #3794ff; }

    .tp-content {
      flex: 1;
      min-height: 0;
      overflow: auto;
      outline: none;
      font: calc(13px * var(--tp-zoom, 1))/1.45 Consolas, "Courier New", monospace;
      color: var(--tp-fg);
      background: var(--tp-bg);
    }
    .tp-editor-wrap {
      flex: 1;
      min-height: 0;
      display: flex;
      margin: 4px;
      border: 2px solid #d13438;
      border-radius: 4px;
      overflow: hidden;
    }
    .tp-gutter {
      flex: none;
      margin: 0;
      padding: 4px 10px 12px 8px;
      overflow: hidden;
      text-align: right;
      font: calc(13px * var(--tp-zoom, 1))/1.45 Consolas, "Courier New", monospace;
      color: var(--tp-ln-fg);
      background: var(--tp-ln-bg);
      border-right: 1px solid var(--tp-ln-border);
      user-select: none;
    }
    .tp-viewer .tp-editor, .tp-viewer .tp-gutter {
      font-family: Consolas, "Courier New", monospace !important; /* SharePoint styles text boxes */
    }
    .tp-editor {
      flex: 1;
      min-height: 0;
      min-width: 0;
      margin: 0;
      padding: 4px 12px 12px;
      border: none;
      outline: none;
      resize: none;
      box-sizing: border-box;
      font: calc(13px * var(--tp-zoom, 1))/1.45 Consolas, "Courier New", monospace;
      color: var(--tp-fg);
      background: var(--tp-bg);
      white-space: pre;
      tab-size: 4;
    }
    .tp-table {
      border-collapse: separate;
      border-spacing: 0;
      font: calc(12px * var(--tp-zoom, 1))/1.4 sans-serif;
      color: var(--tp-fg);
    }
    .tp-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 4px 10px;
      text-align: left;
      white-space: nowrap;
      font-weight: 600;
      color: var(--tp-thead-fg);
      background: var(--tp-thead-bg);
      border-bottom: 3px solid var(--tp-border);
    }
    .tp-table th button { color: inherit; }
    .tp-table tr.tp-stripe td { background: var(--tp-stripe); }
    .tp-table tr.tp-stripe td.tp-rn { background: linear-gradient(var(--tp-stripe), var(--tp-stripe)), var(--tp-bg); }
    .tp-table td {
      padding: 3px 10px;
      max-width: 360px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-bottom: 1px solid var(--tp-border);
    }
    /* Row numbers: first column without header, numbers aligned right; stays in place when
       scrolling sideways (like the header row when scrolling down) */
    .tp-table .tp-rn {
      position: sticky;
      left: 0;
      text-align: right;
      color: var(--tp-ln-fg);
      background: var(--tp-bg);
      border-right: 1px solid var(--tp-border);
    }
    .tp-table td.tp-rn { z-index: 1; }
    .tp-table th.tp-rn { z-index: 2; background: var(--tp-thead-bg); }
    .tp-table tbody tr:not(.tp-spacer):hover td { background: var(--tp-hover); }
    .tp-table tr.tp-spacer td { padding: 0; border: none; }
    .tp-table th[data-c] { cursor: pointer; user-select: none; }
    .tp-filter {
      margin-left: 6px;
      padding: 0 4px;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--tp-ln-fg);
      cursor: pointer;
      font-size: 11px;
    }
    .tp-filter.tp-on { background: var(--tp-accent); color: #fff; }
    .tp-content:has(.tp-plus) { position: relative; }
    .tp-plus {
      position: absolute;
      z-index: 4;
      width: 16px;
      height: 16px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--tp-accent);
      color: #fff;
      font: bold 13px/16px sans-serif;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,.3);
    }
    .tp-table [draggable="true"] { cursor: grab; }
    .tp-resize {
      position: absolute;
      top: 40%;
      bottom: 0;
      right: -3px;
      width: 7px;
      z-index: 3;
      cursor: col-resize;
    }
    .tp-resize:hover { background: linear-gradient(90deg, transparent 2px, var(--tp-accent) 2px 5px, transparent 5px); }
    .tp-col-delete {
      visibility: hidden; /* appears when hovering over the column title */
      margin-left: 2px;
      padding: 0 2px;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--tp-ln-fg);
      vertical-align: middle;
      cursor: pointer;
    }
    .tp-col-delete svg { width: 12px; height: 12px; display: block; }
    .tp-table th:hover .tp-col-delete { visibility: visible; }
    .tp-col-delete:hover { background: #d13438; color: #fff; }
    /* Write mode: room on the left for the "+" between rows */
    .tp-table.tp-editing { margin-left: 14px; }
    .tp-table.tp-editing .tp-rn { left: 14px; }
    .tp-table .tp-drop-before { box-shadow: inset 0 3px 0 var(--tp-accent); }
    .tp-table .tp-drop-after { box-shadow: inset 0 -3px 0 var(--tp-accent); }
    .tp-table th.tp-drop-before { box-shadow: inset 3px 0 0 var(--tp-accent); }
    .tp-table th.tp-drop-after { box-shadow: inset -3px 0 0 var(--tp-accent); }
    .tp-table td[contenteditable] { cursor: text; outline: none; }
    .tp-statusbar {
      position: relative;
      flex: none;
      height: 30px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 8px;
      background: var(--tp-header-bg);
      border-top: 1px solid var(--tp-border);
    }
    .tp-progress {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
      font: 11px sans-serif;
      color: var(--tp-fg);
      white-space: nowrap;
    }
    .tp-progress.tp-off { opacity: .4; }
    /* fully cached: calm, no accent (dark grey / soft light grey) */
    .tp-progress.tp-full .tp-progress-fill, .tp-progress.tp-idle .tp-progress-fill { background: #3b3a39; }
    .tp-dark .tp-progress.tp-full .tp-progress-fill, .tp-dark .tp-progress.tp-idle .tp-progress-fill { background: #c8c8c8; }
    .tp-progress .tp-click { cursor: pointer; }
    .tp-progress .tp-click:hover { color: var(--tp-accent); }
    .tp-progress.tp-full .tp-progress-bar { overflow: visible; }
    .tp-views {
      display: flex;
      flex: none;
      margin-left: auto;
      border: 1px solid var(--tp-border);
      border-radius: 6px;
      overflow: hidden;
    }
    .tp-viewer .tp-view-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      height: 22px;
      padding: 0 10px;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--tp-fg);
      font: 12px sans-serif;
      cursor: pointer;
    }
    .tp-viewer .tp-view-btn + .tp-view-btn { border-left: 1px solid var(--tp-border); }
    .tp-viewer .tp-view-btn svg { width: 14px; height: 14px; }
    .tp-viewer .tp-view-btn[aria-pressed="true"] { background: #0078d4; color: #fff; }
    .tp-viewer .tp-view-btn:disabled { opacity: .4; cursor: default; }
    .tp-viewer .tp-view-btn:not(:disabled):not([aria-pressed="true"]):hover { background: var(--tp-hover); }
    /* Text size: − 100 % + (left of the view switch) */
    .tp-zoom + .tp-views, .tp-format + .tp-zoom { margin-left: 0; }
    /* Format (left of the text size): recognised, or chosen (accent) */
    .tp-format:has(> .tp-picker[hidden]) { display: none; }
    .tp-viewer .tp-format .tp-picker { border-left: none; }
    .tp-viewer .tp-format .tp-picker.tp-chosen { color: var(--tp-accent); font-style: italic; }
    .tp-viewer .tp-zoom .tp-view-btn { padding: 0 8px; font-size: 13px; }
    .tp-viewer .tp-zoom .tp-zoom-value { min-width: 52px; justify-content: center; font-size: 11px; }
    /* Sheet or table choice (spreadsheets): segment right of the table button; menu above it */
    .tp-viewer .tp-picker {
      height: 22px;
      max-width: 200px;
      padding: 0 8px;
      overflow: hidden;
      border: none;
      border-left: 1px solid var(--tp-border);
      border-radius: 0;
      background: transparent;
      color: var(--tp-fg);
      font: 12px sans-serif;
      white-space: nowrap;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .tp-viewer .tp-picker:hover, .tp-viewer .tp-picker[aria-expanded="true"] { background: var(--tp-hover); }
    .tp-viewer .tp-picker + .tp-view-btn { border-left: 1px solid var(--tp-border); }
    .tp-picker-menu {
      position: absolute;
      z-index: 6;
      display: flex;
      flex-direction: column;
      width: 260px;
      max-height: min(60vh, 340px);
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,.3);
      outline: none;
    }
    .tp-picker-menu[hidden] { display: none; }
    .tp-picker-head { flex: none; display: flex; gap: 2px; padding: 4px; border-bottom: 1px solid var(--tp-border); }
    .tp-picker-head button {
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--tp-fg);
      font: 12px sans-serif;
      cursor: pointer;
    }
    .tp-picker-head button:hover { background: var(--tp-hover); }
    .tp-picker-step { flex: none; width: 24px; font-size: 15px !important; }
    .tp-picker-tab { flex: 1; padding: 4px 6px; }
    .tp-picker-tab span { opacity: .6; }
    .tp-picker-tab[aria-pressed="true"] { background: #0078d4 !important; color: #fff !important; }
    .tp-picker-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px; }
    .tp-picker-item {
      display: block;
      width: 100%;
      padding: 5px 8px;
      overflow: hidden;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--tp-fg);
      font: 12px sans-serif;
      text-align: left;
      white-space: nowrap;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .tp-picker-item:hover, .tp-picker-item.tp-active { background: var(--tp-hover); }
    .tp-picker-item.tp-chosen { font-weight: 600; }
    .tp-picker-item.tp-chosen::after { content: ' ✓'; color: var(--tp-accent); }
    .tp-picker-empty { padding: 8px; font: 12px sans-serif; color: var(--tp-fg); opacity: .6; }
    .tp-progress-bar {
      width: 140px;
      height: 3px;
      border-radius: 2px;
      background: var(--tp-border);
      overflow: hidden;
    }
    .tp-progress-fill { height: 100%; width: 0; background: #0078d4; transition: width .15s; }
    /* Row of the file in the viewer (SharePoint's own hover colour) */
    [role="row"].tp-row-shown, [role="row"].tp-row-shown:hover { background-color: #f3f2f1 !important; }
    .tp-notice .tp-code { font-style: italic; color: #d13438; }
    .tp-inline-icon svg { width: 14px; height: 14px; vertical-align: -2px; }
    .tp-notice .tp-sp { background-image: none; } /* notices: no whitespace markers */
    .tp-notice .tp-tab::before { content: none; }
    .tp-dark .tp-notice .tp-code { color: #9d9d9d; }
    .tp-csv-bar {
      display: none;
      gap: 6px;
      align-items: center;
      padding: 4px 8px;
      font: 12px sans-serif;
      color: var(--tp-fg);
      background: var(--tp-header-bg);
      border-bottom: 1px solid var(--tp-border);
    }
    .tp-csv-bar select {
      font: 12px sans-serif;
      color: var(--tp-fg);
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 3px;
    }
    .tp-table td[contenteditable]:focus { box-shadow: inset 0 0 0 2px #d13438; }
    .tp-filter-panel {
      position: absolute;
      z-index: 5;
      width: 240px;
      max-height: 320px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      font: 12px sans-serif;
      color: var(--tp-fg);
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,.25);
    }
    .tp-filter-panel input[type="text"] {
      padding: 3px 6px;
      color: var(--tp-fg);
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 3px;
    }
    .tp-filter-list { overflow: auto; display: flex; flex-direction: column; }
    .tp-filter-panel label { display: flex; gap: 6px; align-items: center; white-space: nowrap; }
    .tp-filter-panel label span { margin-left: auto; color: var(--tp-ln-fg); }
    .tp-lines { display: inline-block; min-width: 100%; padding: 4px 0 12px; }
    .tp-line { display: flex; }
    .tp-ln {
      position: sticky;
      left: 0;
      flex: none;
      box-sizing: content-box;
      width: var(--tp-ln-w, 3ch); /* fixed: every row the same width */
      overflow: hidden;
      padding: 0 10px 0 8px;
      text-align: right;
      color: var(--tp-ln-fg);
      background: var(--tp-ln-bg);
      border-right: 1px solid var(--tp-ln-border);
      user-select: none;
    }
    .tp-code { white-space: pre; padding: 0 12px; flex: 1; }
    .tp-wrap .tp-lines { display: block; }
    .tp-wrap .tp-code { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
    .tp-err .tp-ln { color: var(--tp-err-ln-fg); background: var(--tp-err-ln-bg); }
    .tp-err .tp-code { background: var(--tp-err-bg); }
    .tp-warn .tp-ln { color: var(--tp-warn-ln-fg); background: var(--tp-warn-ln-bg); }
    .tp-warn .tp-code { background: var(--tp-warn-bg); }
    .tp-flash .tp-code { background: var(--tp-flash) !important; transition: background .3s; }

    /* Markdown view */
    .tp-md {
      max-width: 920px;
      padding: 8px 24px 24px;
      font: calc(14px * var(--tp-zoom, 1))/1.6 -apple-system, "Segoe UI", sans-serif;
      overflow-wrap: anywhere;
    }
    .tp-md h1, .tp-md h2, .tp-md h3, .tp-md h4, .tp-md h5, .tp-md h6 { margin: 1.2em 0 .5em; line-height: 1.25; font-weight: 600; }
    .tp-md h1 { font-size: 1.9em; padding-bottom: .25em; border-bottom: 1px solid var(--tp-border); }
    .tp-md h2 { font-size: 1.45em; padding-bottom: .25em; border-bottom: 1px solid var(--tp-border); }
    .tp-md h3 { font-size: 1.2em; }
    .tp-md h4 { font-size: 1em; }
    .tp-md h5, .tp-md h6 { font-size: .9em; }
    .tp-md p, .tp-md ul, .tp-md ol, .tp-md blockquote, .tp-md pre, .tp-md table { margin: 0 0 .9em; }
    .tp-md ul, .tp-md ol { padding-left: 2em; }
    .tp-md li > ul, .tp-md li > ol { margin: 0; }
    .tp-md li.tp-md-task { list-style: none; }
    .tp-md li.tp-md-task input { margin: 0 .4em 0 -1.4em; vertical-align: middle; }
    .tp-md a { color: var(--tp-accent); }
    .tp-md code {
      padding: .1em .35em;
      border-radius: 4px;
      background: var(--tp-ln-bg);
      font: .9em Consolas, "Courier New", monospace;
    }
    .tp-md pre {
      padding: 10px 12px;
      overflow: auto;
      border: 1px solid var(--tp-ln-border);
      border-radius: 6px;
      background: var(--tp-ln-bg);
      line-height: 1.45;
    }
    .tp-md pre code { padding: 0; background: none; white-space: pre; }
    .tp-md blockquote { padding: 0 1em; border-left: 4px solid var(--tp-border); opacity: .85; }
    .tp-md blockquote > :last-child { margin-bottom: 0; }
    .tp-md hr { border: none; border-top: 2px solid var(--tp-border); margin: 1.4em 0; }
    .tp-md table { border-collapse: collapse; display: block; overflow: auto; }
    .tp-md th, .tp-md td { padding: 4px 12px; border: 1px solid var(--tp-border); }
    .tp-md th { font-weight: 600; background: var(--tp-header-bg); }
    .tp-md img { max-width: 100%; }

    .tp-key { color: var(--tp-key); }
    .tp-str { color: var(--tp-str); }
    .tp-num { color: var(--tp-num); }
    .tp-lit { color: var(--tp-lit); font-weight: 600; }
    .tp-punct { color: var(--tp-punct); }
    .tp-com { color: var(--tp-com); font-style: italic; }
    .tp-tag { color: var(--tp-tag); }
    .tp-attr { color: var(--tp-attr); }
    .tp-aval { color: var(--tp-aval); }
    .tp-meta { color: var(--tp-meta); }
    .tp-ent { color: var(--tp-ent); }
    .tp-ref { color: var(--tp-ref); }
    .tp-type { color: var(--tp-type); font-weight: 600; }
    .tp-enum { color: var(--tp-enum); }
    .tp-kw { color: var(--tp-kw); font-weight: 700; }
    .tp-anchor { color: var(--tp-anchor); }
    .tp-lv-err { color: var(--tp-sev-error); font-weight: 700; }
    .tp-lv-warn { color: var(--tp-sev-warning); font-weight: 700; }
    .tp-lv-info { color: var(--tp-lit); font-weight: 700; }
    .tp-lv-debug { color: var(--tp-trunc); }
    .tp-log-date { color: var(--tp-type); }
    .tp-log-frame { color: var(--tp-trunc); }
    .tp-table td.tp-multi::before { content: '⏎ '; color: var(--tp-trunc); } /* log message over several lines */
    .tp-table .tp-expand-all { border: none; background: none; padding: 0; font: inherit; color: inherit; cursor: pointer; }
    .tp-table .tp-expand-all:hover { color: var(--tp-accent); }
    .tp-table .tp-expand { border: none; background: none; padding: 0 4px 0 0; font: inherit; color: var(--tp-ln-fg); cursor: pointer; }
    .tp-table .tp-expand:hover { color: var(--tp-accent); }
    .tp-table tr.tp-detail td, .tp-table tbody tr.tp-detail:not(.tp-spacer):hover td { max-width: none; white-space: normal; background: var(--tp-stripe); }
    .tp-detail-box { max-width: 80vw; padding: 4px 0; }
    .tp-seg + .tp-seg { margin-top: 8px; }
    .tp-seg-label { color: var(--tp-ln-fg); font-style: italic; }
    .tp-seg pre { margin: 0; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
    .tp-log-url { color: var(--tp-enum); text-decoration: underline; }
    .tp-sp {
      background-image: radial-gradient(circle, var(--tp-ws) 0.9px, transparent 1.3px);
      background-size: 1ch 100%;
      background-repeat: repeat-x;
    }
    .tp-tab { position: relative; }
    .tp-tab::before {
      content: '→';
      position: absolute;
      left: 0;
      color: var(--tp-ws);
      pointer-events: none;
    }
    .tp-trunc { color: var(--tp-trunc); font-style: italic; user-select: none; }

    .tp-splitter { display: none; position: absolute; z-index: 2; touch-action: none; }
    .tp-splitter-vertical { display: block; left: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize; }
    .tp-splitter-horizontal { display: block; left: 0; right: 0; top: 0; height: 6px; cursor: row-resize; }
    .tp-splitter:hover, .tp-splitter.tp-drag { background: rgba(0, 120, 212, .35); }
    .tp-splitter-vertical { border-radius: 8px 0 0 8px; }
    .tp-splitter-horizontal { border-radius: 8px 8px 0 0; }

    /* Check result: a short line across the whole width at the bottom of the header; the problem
       list opens over the text */
    /* Grip at the lower edge of the header (like the splitter): drag for more metadata lines */
    .tp-meta-grip {
      position: absolute;
      left: 0;
      right: 0;
      bottom: -3px;
      height: 6px;
      z-index: 2;
      cursor: row-resize;
    }
    .tp-meta-grip:hover, .tp-meta-grip.tp-drag { background: rgba(0, 120, 212, .35); }
    .tp-lint {
      position: absolute;
      top: var(--tp-lint-top, 63px);
      left: 0;
      right: 0;
      font: 12px sans-serif;
    }
    .tp-lint-summary {
      display: block;
      width: 100%;
      padding: 1px 12px;
      border: none;
      border-radius: 0;
      text-align: left;
      font: 600 11px/16px sans-serif;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .tp-lint-ok .tp-lint-summary { background: var(--tp-ok-bg); color: var(--tp-ok-fg); cursor: default; }
    .tp-lint-bad .tp-lint-summary { background: var(--tp-bad-bg); color: var(--tp-bad-fg); }
    .tp-lint-wait .tp-lint-summary { background: var(--tp-wait-bg); color: var(--tp-wait-fg); cursor: default; }
    .tp-lint-list {
      position: absolute;
      top: 20px;
      left: 0;
      right: 0;
      z-index: 3;
      max-height: 25vh;
      overflow: auto;
      background: var(--tp-bg);
      color: var(--tp-fg);
      border: 1px solid var(--tp-border);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,.25);
    }
    .tp-lint-item { padding: 3px 12px; cursor: pointer; white-space: pre-wrap; }
    .tp-lint-item:hover { background: var(--tp-hover); }
    .tp-lint-item b { display: inline-block; min-width: 6em; }
    .tp-lint-item.tp-sev-error b { color: var(--tp-sev-error); }
    .tp-lint-item.tp-sev-warning b { color: var(--tp-sev-warning); }
  `;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  /** Adds the stylesheet (both themes) to the page. */
  function injectStyles() {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.documentElement.append(style);
  }

  // Module: readers/request.ts

  // Requests for files: this SharePoint only (nothing is sent elsewhere); dates from the file's own response

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const OUTSIDE = 'Not opened: the link points outside this SharePoint';

  // ===========================================================================
  // METHODS
  // ===========================================================================

  /** @param url relative or absolute @returns on this SharePoint */
  const sameOrigin = (url) => new URL(url, location.href).origin === location.origin;

  /** @param path server-relative, as SharePoint names it @returns each part URL-encoded (for requests) */
  const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

  // How a file is on SharePoint now (HEAD request, not cached): changes with each upload
  /** @param path server-relative @returns ETag, date and size; null if the file is not there (or unreachable) */
  async function fileStamp(path) {
      try {
          const r = await fetch(encodePath(path), { method: 'HEAD', credentials: 'same-origin', cache: 'reload' });
          const h = (k) => r.headers.get(k);
          return r.ok ? `${h('etag')}|${h('last-modified')}|${h('content-length')}` : null;
      } catch {
          return null;
      }
  }

  // Dates from file's own response headers
  /** @param cd Content-Disposition */
  function responseDates(response, cd) {
      const iso = (v) => {
          const d = v ? new Date(v.replace(/^"|"$/g, '')) : null;
          // "2026-10-24 08:35:13 UTC" (list dates are local time, so UTC is named)
          return d && !Number.isNaN(d.getTime()) ? `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC` : null;
      };
      return {
          modified: iso(response.headers.get('last-modified') || (cd.match(/modification-date="?([^";]+)/i) || [])[1]),
          created: iso((cd.match(/creation-date="?([^";]+)/i) || [])[1]),
      };
  }

  // Module: readers/search.ts

  // Files by name below the open folder: rows of search results in a library carry no path, only the name

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const SITE_RE = /^\/(?:sites|teams)\/[^/]+/i; // site of a server-relative path ('' = root site)
  const JSON_HEADERS = { Accept: 'application/json;odata=nometadata' };

  /** path guessed from folder and name -> path found */
  const foundPaths = new Map();

  /** path guessed -> how the lookup went (shown when the file is not found) */
  const lookupNotes = new Map();

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // File `name` in `folder` or below: library's own list first (exact, any file type),
  // else search index (as the search results; large lists may refuse the filter)
  // NOTE: same name in several sub-folders: the one in `folder` itself, else the first found
  /** @param folder server-relative @returns server-relative path */
  async function findFile(folder, name) {
      const guess = `${folder}/${name}`;
      const known = foundPaths.get(guess);
      if (known) return known;
      const site = folder.match(SITE_RE)?.[0] ?? '';
      const below = `${folder.toLowerCase()}/`;
      const pick = (paths) => {
          const inside = paths.filter((p) => p.split('/').pop() === name && p.toLowerCase().startsWith(below));
          return inside.find((p) => p.toLowerCase() === guess.toLowerCase()) ?? inside[0] ?? null;
      };
      const listed = await listPaths(site, name);
      let path = pick(listed.paths);
      const notes = [`library list: ${listed.note}`];
      if (!path) {
          const searched = await searchPaths(site, folder, name);
          path = pick(searched.paths);
          notes.push(`search: ${searched.note}`);
      }
      if (path) foundPaths.set(guess, path);
      lookupNotes.set(guess, `Looked up by name below ${folder}\n${notes.join('\n')}`);
      return path;
  }

  const summary = (paths) =>
      paths.length ? `${paths.length} found (${paths.slice(0, 3).join(', ')})` : 'none found';

  // Paths of files named `name` in the library of the open view (FileLeafRef = file name)
  async function listPaths(site, name) {
      const path = decodeURIComponent(location.pathname);
      const i = path.toLowerCase().indexOf('/forms/');
      if (i < 0) return { paths: [], note: 'not in a list view' };
      const quote = (s) => `'${s.replace(/'/g, "''")}'`;
      const url =
          `${site}/_api/web/GetList(@list)/items?$select=FileRef&$top=50` +
          `&$filter=FileLeafRef eq ${encodeURIComponent(quote(name))}&@list=${encodeURIComponent(quote(path.slice(0, i)))}`;
      const data = await getJson(url);
      if (typeof data === 'string') return { paths: [], note: data };
      const paths = (data?.value ?? []).flatMap((x) => (x.FileRef ? [x.FileRef] : []));
      return { paths, note: summary(paths) };
  }

  // Paths of files named `name` below `folder` by the search index; Path may be a form (DispForm.aspx?ID=…)
  // for file types the index does not read, then the file is ParentLink + Filename
  async function searchPaths(site, folder, name) {
      const query = `(filename:"${name}" OR "${name}") path:"${location.origin}${folder}"`.replace(/'/g, "''");
      const url =
          `${site}/_api/search/query?querytext='${encodeURIComponent(query)}'` +
          "&selectproperties='Path,ParentLink,Filename'&rowlimit=50&trimduplicates=false";
      const data = await getJson

  (url);
      if (typeof data === 'string') return { paths: [], note: data };
      const rows = data?.PrimaryQueryResult?.RelevantResults?.Table?.Rows ?? [];
      const pathOf = (value) => {
          try {
              return value ? decodeURIComponent(new URL(value, location.origin).pathname).replace(/\/+$/, '') : '';
          } catch {
              return '';
          }
      };
      const paths = rows.flatMap((r) => {
          const cell = (key) => r.Cells.find((c) => c.Key === key)?.Value;
          const parent = pathOf(cell('ParentLink'));
          return [pathOf(cell('Path')), parent && cell('Filename') ? `${parent}/${cell('Filename')}` : ''];
      });
      return { paths: paths.filter(Boolean), note: summary([...new Set(paths.filter(Boolean))]) };
  }

  /** @returns parsed JSON (of the shape the caller expects), or why not (refused, HTTP status, failed) */
  async function getJson(url) {
      if (!sameOrigin(url)) return 'refused (other origin)';
      try {
          const res = await fetch(url, { credentials: 'same-origin', headers: JSON_HEADERS });
          return res.ok ? ((await res.json())) : `HTTP ${res.status}`;
      } catch (e) {
          return `failed (${e instanceof Error ? e.message : e})`;
      }
  }

  // Module: readers/bytes.ts

  // Bytes and texts of binary formats (shared by the readers)

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const utf8 = new TextDecoder();
  const utf16le = new TextDecoder('utf-16le');

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function concatBytes(parts) {
      if (parts.length === 1) return parts[0];
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
          out.set(p, at);
          at += p.length;
      }
      return out;
  }

  const dataView = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

  // Little-endian unsigned 32-bit number at `pos`
  const u32 = (b, pos) =>
      (b[pos] | (b[pos + 1] << 8) | (b[pos + 2] << 16) | (b[pos + 3] << 24)) >>> 0;

  // Characters stored with 1 byte each: Unicode code points up to U+00FF
  function latin1(b) {
      let s = '';
      for (let i = 0; i < b.length; i += 8192)
          s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); // typed array as argument list
      return s;
  }

  // Module: readers/parquet/meta.ts

  // Parquet (read only, no library): footer and needed column parts by range, rows as CSV

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const PARQUET_RE = /\.parquet$/i;
  const CODEC_NAMES = ['none', 'SNAPPY', 'GZIP', 'LZO', 'BROTLI', 'LZ4', 'ZSTD', 'LZ4_RAW'];

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Thrift compact protocol (Parquet metadata): structs keyed by field id
  function thriftReader(bytes, start = 0) {
      let pos = start;

      const byte = () => {
          if (pos >= bytes.length) throw new RangeError('end of data');
          return bytes[pos++];
      };

      const varint = () => {
          let r = 0n;
          let shift = 0n;
          let b;
          do {
              b = byte();
              r |= BigInt(b & 0x7f) << shift;
              shift += 7n;
          } while (b & 0x80);
          return r;
      };
      const zigzag = (n) => (n >> 1n) ^ -(n & 1n);
      const small = (n) => (n >= -(2n ** 53n) && n <= 2n ** 53n ? Number(n) : n);

      function value(type) {
          switch (type) {
              case 1:
                  return true;
              case 2:
                  return false;
              case 3: {
                  const b = byte();
                  return b > 127 ? b - 256 : b;
              }
              case 4:
              case 5:
              case 6:
                  return small(zigzag(varint()));
              case 7: {
                  if (pos + 8 > bytes.length) throw new RangeError('end of data');
                  const v = new DataView(bytes.buffer, bytes.byteOffset + pos, 8).getFloat64(0, true);
                  pos += 8;
                  return v;
              }
              case 8: {
                  const len = Number(varint());
                  if (pos + len > bytes.length) throw new RangeError('end of data');
                  const v = bytes.subarray(pos, pos + len);
                  pos += len;
                  return v;
              }
              case 9:
              case 10: {
                  const h = byte();
                  let size = h >> 4;
                  const elem = h & 15;
                  if (size === 15) size = Number(varint());
                  const out = [];
                  for (let i = 0; i < size; i++) out.push(elem === 1 || elem === 2 ? byte() === 1 : value(elem));
                  return out;
              }
              case 11: {
                  const size = Number(varint());
                  const out = new Map();
                  if (size) {
                      const kv = byte();
                      for (let i = 0; i < size; i++) out.set(value(kv >> 4), value(kv & 15));
                  }
                  return out;
              }
              case 12:
                  return struct();
              default:
                  throw new Error(`unknown Thrift type ${type}`);
          }
      }

      function struct() {
          const out = {};
          let id = 0;
          for (;;) {
              const h = byte();
              if (h === 0) return out;
              const delta = h >> 4;
              id = delta ? id + delta : Number(zigzag(varint()));
              out[id] = value(h & 15);
          }
      }

      return { struct, pos: () => pos };
  }

  function parseFooter(bytes) {
      const m = thriftReader(bytes).struct(); // shape per the format
      const text = (b) => (b ? utf8.decode(b) : '');
      return {
          createdBy: m[6] ? text(m[6]) : '',
          numRows: Number(m[3] || 0),
          schema: (m[2] || []).map((e) => ({
              type: e[1],
              typeLength: e[2],
              repetition: e[3],
              name: text(e[4]),
              children: e[5] || 0,
              converted: e[6],
              scale: e[7],
              logical: e[10],
          })),
          rowGroups: (m[4] || []).map((rg) => ({
              numRows: Number(rg[3] || 0),
              columns: (rg[1] || []).map((c) => {
                  const md = c[3] || {};
                  return {
                      codec: md[4] || 0,
                      numValues: Number(md[5] || 0),
                      size: Number(md[7] || 0),
                      dataOffset: Number(md[9] || 0),
                      dictOffset: md[11] != null ? Number(md[11]) : null,
                  };
              }),
          })),
      };
  }

  // Leaf columns with their nesting depth (definition / repetition levels)
  /** @returns leaf columns with path, maxDef, maxRep */
  function leafColumns(schema) {
      const leaves = [];
      let i = 1;

      const walk = (path, maxDef, maxRep, count) => {
          for (let k = 0; k < count && i < schema.length; k++) {
              const e = schema[i++];
              const def = maxDef + (e.repetition ? 1 : 0); // OPTIONAL (1) and REPEATED (2) add level
              const rep = maxRep + (e.repetition === 2 ? 1 : 0);
              const p = [...path, e.name];
              if (e.children) walk(p, def, rep, e.children);
              else leaves.push({ ...e, path: p, maxDef: def, maxRep: rep });
          }
      };
      walk([], 0, 0, schema[0] ? schema[0].children : 0);
      return leaves;
  }

  const bitWidth = (max) => 32 - Math.clz32(max);

  // Module: readers/sheets/cells.ts

  // Spreadsheets (read only, no library): Excel (.xlsx .xlsm .xltx .xltm, .xlsb, .xls .xlt)
  // and OpenDocument (.ods .ots). Cached sheet by sheet: workbook, shared strings and styles
  // first, then only the sheets shown, by range (ODS keeps all sheets in one part).
  // Formats: ECMA-376 (OOXML), [MS-XLSB], [MS-XLS] in [MS-CFB], OASIS OpenDocument 1.2.

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const SHEET_RE = /\.(xlsx|xlsm|xltx|xltm|xlsb|xls|xlt|ods|ots)$/i;

  // Excel's own limits; cells in total kept per sheet (against damaged or hostile files)
  const MAX_SHEET_ROWS = 1048576;
  const MAX_SHEET_COLS = 16384;
  const MAX_SHEET_CELLS = 10000000;

  const SHEET_ERRORS = {
      0: '#NULL!',
      7: '#DIV/0!',
      15: '#VALUE!',
      23: '#REF!',
      29: '#NAME?',
      36: '#NUM!',
      42: '#N/A',
      43: '#GETTING_DATA',
  };

  // Built-in number formats other than plain numbers (ECMA-376 part 1, 18.8.30); only their kind counts
  const BUILTIN_FORMATS = {
      9: '0%',
      10: '0.00%',
      14: 'yyyy-mm-dd',
      15: 'd-mmm-yy',
      16: 'd-mmm',
      17: 'mmm-yy',
      18: 'h:mm AM/PM',
      19: 'h:mm:ss AM/PM',
      20: 'h:mm',
      21: 'h:mm:ss',
      22: 'yyyy-mm-dd h:mm',
      45: 'mm:ss',
      46: '[h]:mm:ss',
      47: 'mm:ss.0',
  };
  for (const id of [27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 57, 58]) BUILTIN_FORMATS[id] = 'yyyy-mm-dd'; // East Asian
  for (const id of [32, 33, 34, 35, 55, 56]) BUILTIN_FORMATS[id] = 'h:mm:ss';

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Format by file extension (shown before the file is read)
  function sheetFormat(name) {
      const ext = (name.match(SHEET_RE) || [])[1];
      if (!ext) return null;
      const upper = ext.toUpperCase();
      return /^o/i.test(ext) ? `OpenDocument spreadsheet (${upper})` : `Excel (${upper})`;
  }

  // ---------------------------------------------------------------------------
  // Cells: numbers as Excel's "General" (15 digits), dates and times as ISO 8601
  // ---------------------------------------------------------------------------

  // Number format code -> 'date' | 'time' | 'datetime' | 'elapsed' ([h]:mm) | 'percent' | '' (plain number)
  function formatKind(code) {
      if (!code) return '';
      const plain = code
          .split(';')[0] // positive part decides
          .replace(/"[^"]*"|\\.|_.|\*./g, '') // literal text, padding
          .replace(/\[(?![hms]+\])[^\]]*\]/gi, '') // colours, conditions, locales (not elapsed [h] [m] [s])
          .replace(/AM\/PM|A\/P/gi, '');
      if (/\[[hms]+\]/i.test(plain)) return 'elapsed';
      const time = /[hs]/i.test(plain);
      const date = /[yd]/i.test(plain) || (/m/i.test(plain) && !time);
      if (date || time) return date && time ? 'datetime' : date ? 'date' : 'time';
      return plain.includes('%') ? 'percent' : '';
  }

  const generalText = (n) => String(Number(n.toPrecision(15)));

  // Serial number -> text; 1900 system counts the non-existent 1900-02-29 (as Lotus 1-2-3 did)
  function numberText(n, kind, date1904) {
      if (!Number.isFinite(n)) return String(n);
      if (kind === 'percent') return `${generalText(n * 100)}%`;
      if (kind === 'elapsed') {
          const secs = Math.round(Math.abs(n) * 86400);
          const pad = (x) => String(x).padStart(2, '0');
          return `${n < 0 ? '-' : ''}${Math.floor(secs / 3600)}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
      }
      if (!kind || n < 0 || n >= 2958466) return generalText(n); // dates up to 9999-12-31
      const days = date1904 ? n + 1462 : n < 60 ? n + 1 : n;
      const iso = new Date(Math.round((days - 25569) * 86400) * 1000).toISOString(); // 25569 = 1970-01-01
      if (kind === 'date') return iso.slice(0, 10);
      if (kind === 'time') return iso.slice(11, 19);
      return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  }

  // Column letters <-> index (0-based): A, …, Z, AA, …
  /** @param ref e.g. "AB12" */
  function refCol(ref) {
      let c = 0;
      for (let i = 0; i < ref.length; i++) {
          const k = ref.charCodeAt(i) & ~32;
          if (k < 65 || k > 90) break;
          c = c * 26 + k - 64;
      }
      return c - 1;
  }

  function colName(c) {
      let s = '';
      for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      return s;
  }

  // Cell range "A1:C4" or "A1" ("$" ignored) <-> corners (0-based); null if unreadable
  function cellRange(ref) {
      const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})(?::\$?([A-Za-z]{1,3})\$?(\d{1,7}))?$/.exec(ref.trim());
      if (!m) return null;
      const r0 = Number(m[2]) - 1;
      const c0 = refCol(m[1]);
      const r1 = m[4] ? Number(m[4]) - 1 : r0;
      const c1 = m[3] ? refCol(m[3]) : c0;
      return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
  }

  const rangeText = ({ r0, c0, r1, c1 }) => `${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`;

  // Cells of one sheet -> rows (no gaps between rows; missing cells are empty)
  function sheetGrid() {
      const rows = [];
      let cols = 0;
      let cells = 0;
      let cut = false;
      return {
          set(r, c, text) {
              if (text === '' || !(r >= 0 && r < MAX_SHEET_ROWS && c >= 0 && c < MAX_SHEET_COLS)) return true;
              if (cells >= MAX_SHEET_CELLS) {
                  cut = true;
                  return false;
              }
              cells++;
              if (!rows[r]) rows[r] = [];
              rows[r][c] = text;
              if (c >= cols) cols = c + 1;
              return true;
          },
          done() {
              for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
              return { rows, cols, cut };
          },
      };
  }

  // Module: readers/text.ts

  // Text files: encoding sniffing and range reading

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Content types that are never plain text
  const BINARY_TYPE_RE =
      /^(image|audio|video|font)\/|^application\/(pdf|zip|x-zip|gzip|x-gzip|x-7z|x-rar|x-tar|msword|vnd\.ms-|vnd\.openxmlformats|vnd\.oasis)/i;

  // Signatures of common binary files (PDF, ZIP/Office, PNG, JPEG, GIF, ...)
  const BINARY_MAGIC = [
      [0x25, 0x50, 0x44, 0x46], // %PDF
      [0x50, 0x4b, 0x03, 0x04], // ZIP, docx/xlsx/pptx
      [0x89, 0x50, 0x4e, 0x47], // PNG
      [0xff, 0xd8, 0xff], // JPEG
      [0x47, 0x49, 0x46, 0x38], // GIF
      [0xd0, 0xcf, 0x11, 0xe0], // old Office (doc/xls)
      [0x1f, 0x8b], // gzip
      [0x37, 0x7a, 0xbc, 0xaf], // 7z
      [0x52, 0x61, 0x72, 0x21], // RAR
  ];

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Open file in chunks of MAX_BYTES, same origin only (nothing is sent elsewhere).
  // Ranges if supported, else paused transfer. Returns { error } | { binary } | source.
  async function openSource(
      url,
      getSignal,
      reload,
      onProgress,
  ) {
      if (!sameOrigin(url)) return { error: OUTSIDE };
      const request = (from) =>
          fetch(url, {
              credentials: 'same-origin',
              cache: reload ? 'reload' : 'default', // 'reload': fresh copy, which also updates cache
              headers: { Range: `bytes=${from}-${from + MAX_BYTES - 1}` },
              signal: getSignal(),
          });

      let response = await request(0);
      if (response.status === 416) response = await fetch(url, { credentials: 'same-origin', signal: getSignal() }); // empty file
      if (!response.ok) return { error: `Error ${response.status} on caching` };

      // File name from SharePoint (share links have none in URL)
      const cd = response.headers.get('content-disposition') || '';
      const cdName = (cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1];
      const name = cdName ? decodeURIComponent(cdName) : (cd.match(/filename="?([^";]+)"?/i) || [])[1];

      // Obvious binary types: stop before anything is cached
      if (BINARY_TYPE_RE.test(response.headers.get('content-type') || '')) {
          response.body?.cancel();
          return { binary: true, name };
      }

      const ranged = response.status === 206;
      const src = {
          name,
          dates: responseDates(response, cd),
          total: ranged
              ? +(response.headers.get('content-range') || '').split('/')[1] || 0
              : Number(response.headers.get('content-length')) || 0,
          loaded: 0,
          done: false,
          text: '',
          more,
          loadAll,
      };
      let decoder = null; // chosen from first bytes
      let reader = null; // open transfer (when SharePoint ignores ranges)

      // Add bytes to text; false = binary data (only first bytes decide)
      const feed = (bytes) => {
          if (!decoder) {
              const encoding = sniffText(bytes);
              if (!encoding) return false;
              decoder = new TextDecoder(encoding);
              src.encoding = encoding.toUpperCase();
              src.bom = encoding === 'utf-8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
          }
          src.loaded += bytes.length;
          src.text += decoder.decode(bytes, { stream: true });
          onProgress(src.loaded, src.total);
          return true;
      };

      const finish = () => {
          src.done = true;
          if (decoder) src.text += decoder.decode();
      };

      // Read `budget` bytes (after `skip`); 'more' | 'end' | 'binary'
      const read = async (
          res,
          budget,
          skip = 0,
      ) => {
          if (!res.body) {
              const all = new Uint8Array(await (res).arrayBuffer()).subarray(skip); // response without stream
              return feed(all) ? 'end' : 'binary';
          }
          const r = res.body.getReader();
          let got = 0;
          while (got < budget) {
              const { done, value } = await r.read();
              if (done) return 'end';
              let chunk = value;
              if (skip) {
                  const drop = Math.min(skip, chunk.length);
                  skip -= drop;
                  chunk = chunk.subarray(drop);
                  if (!chunk.length) continue;
              }
              if (!feed(chunk)) {
                  r.cancel();
                  return 'binary';
              }
              got += chunk.length;
          }
          reader = r; // budget reached: keep rest of this transfer for later
          return 'more';
      };

      const first = await read(response, MAX_BYTES);
      if (first === 'binary') return { binary: true, name };
      if (ranged) {
          (reader)?.cancel(); // read() may have set it
          reader = null;
          if (src.total && src.loaded >= src.total) finish();
      } else if (first === 'end') {
          finish();
      }

      async function more() {
          if (src.done) return;
          let state = null;
          if (reader) {
              // Resume paused transfer; if it was cut off, new request
              const r = reader;
              reader = null;
              const signal = getSignal(); // current one: aborted only by stop from now on
              try {
                  state = await read({ body: { getReader: () => r } }, MAX_BYTES);
              } catch (err) {
                  if (signal.aborted) throw err; // stopped by user now
                  state = null;
              }
          }
          if (!state) {
              // Next range (if SharePoint suddenly sends whole file, skip what we have)
              const res = await request(src.loaded);
              if (res.status === 416) {
                  finish(); // nothing left (size was unknown)
                  return;
              }
              if (!res.ok) throw new Error(`Error ${res.status} on caching`);
              state = await read(res, MAX_BYTES, res.status === 206 ? 0 : src.loaded);
              if (res.status === 206) {
                  (reader)?.cancel(); // read() may have set it
                  reader = null;
              }
          }
          if (state === 'end' || (src.total && src.loaded >= src.total)) finish();
      }

      async function loadAll() {
          while (!src.done) {
              const before = src.loaded;
              await more();
              if (!src.done && src.loaded === before) throw new Error('no progress from SharePoint');
          }
      }
      return src;
  }

  // First bytes -> text encoding, or null for binary
  /** @returns encoding, or null for binary data */
  function sniffText(bytes) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
      if (BINARY_MAGIC.some((sig) => sig.every((b, i) => bytes[i] === b))) return null;
      const head = bytes.subarray(0, SNIFF_BYTES);
      if (head.includes(0)) return null; // NUL bytes do not occur in text
      return 'utf-8';
  }

  // Module: readers/zip.ts

  // ZIP archives (.ifczip, spreadsheets): directory and single entries, read by range

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // .ifczip: ZIP with one IFC file, unpacked by browser (read only)
  const ZIP_RE = /\.ifczip$/i;
  const MAX_ZIP_BYTES = 256 * 1024 * 1024; // archive size limit

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Entries of ZIP archive from its central directory (at its end)
  async function zipEntries(read, size) {
      // End record: in last 22 bytes, unless archive has a comment (then up to 64 KB before)
      let base = 0;
      let tail = new Uint8Array(0);
      let end = -1;
      for (const span of [4096, 65557]) {
          base = Math.max(0, size - span);
          tail = await read(base, size);
          const dv = dataView(tail);
          for (let i = tail.length - 22; i >= 0; i--) {
              if (dv.getUint32(i, true) === 0x06054b50) {
                  end = i;
                  break;
              }
          }
          if (end >= 0 || base === 0) break;
      }
      if (end < 0) throw new Error('not a ZIP archive');
      const dv = dataView(tail);
      const count = dv.getUint16(end + 10, true);
      const length = dv.getUint32(end + 12, true);
      const at = dv.getUint32(end + 16, true);
      if (count === 0xffff || at === 0xffffffff) throw new Error('ZIP64 archives are not supported');
      const dir = at >= base ? tail.subarray(at - base, at - base + length) : await read(at, at + length);
      const d = dataView(dir);
      const entries = [];
      let p = 0;
      for (let k = 0; k < count; k++) {
          if (p + 46 > dir.length || d.getUint32(p, true) !== 0x02014b50) throw new Error('damaged ZIP directory');
          const nameLen = d.getUint16(p + 28, true);
          const extraLen = d.getUint16(p + 30, true);
          const commentLen = d.getUint16(p + 32, true);
          entries.push({
              name: utf8.decode(dir.subarray(p + 46, p + 46 + nameLen)),
              method: d.getUint16(p + 10, true),
              packed: d.getUint32(p + 20, true),
              size: d.getUint32(p + 24, true),
              offset: d.getUint32(p + 42, true),
              head: 30 + nameLen + extraLen, // local header: usually as long as this one
          });
          p += 46 + nameLen + extraLen + commentLen;
      }
      return entries;
  }

  // Bytes of one entry: stored (0) or deflated (8)
  async function zipEntryBytes(read, entry) {
      const at = entry.offset;
      let bytes = await read(at, at + entry.head + entry.packed);
      const dv = dataView(bytes);
      if (bytes.length < 30 || dv.getUint32(0, true) !== 0x04034b50) throw new Error('damaged ZIP entry');
      const start = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
      if (start + entry.packed > bytes.length) {
          bytes = concatBytes([bytes, await read(at + bytes.length, at + start + entry.packed)]); // longer local header
      }
      const packed = bytes.subarray(start, start + entry.packed);
      if (entry.method === 0) return packed;
      if (entry.method !== 8) throw new Error(`ZIP compression ${entry.method} is not supported`);
      const blob = new Blob([packed]);
      return new Uint8Array(
          await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer(),
      );
  }

  async function openZipSource(
      url,
      getSignal,
      reload,
      onProgress,
      force = false,
  ) {
      if (!sameOrigin(url)) return { error: OUTSIDE };
      const res = await fetch(url, {
          credentials: 'same-origin',
          cache: reload ? 'reload' : 'default',
          signal: getSignal(),
      });
      if (!res.ok) return { error: `Error ${res.status} on caching` };
      const total = Number(res.headers.get('content-length')) || 0;
      if (total > MAX_ZIP_BYTES) return { error: `Archive larger than ${formatBytes(MAX_ZIP_BYTES)}: not opened` };
      if (total > MAX_BYTES && !force) {
          res.body?.cancel(); // asks first
          return {
              deferred: 'IFCZIP',
              size: total,
              dates: responseDates(res, res.headers.get('content-disposition') || ''),
          };
      }
      const parts = [];
      let loaded = 0;
      const reader = (res.body).getReader(); // ok response: has a body
      for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          loaded += value.length;
          onProgress(loaded, total);
      }
      const bytes = concatBytes(parts.length ? parts : [new Uint8Array(0)]);
      const read = async (from, to) => bytes.subarray(from, to);
      let entries;
      try {
          entries = await zipEntries(read, bytes.length);
      } catch (err) {
          return { error: `Not a valid .ifczip (${(err).message})` };
      }
      const entry = entries.find((e) => /\.ifc$/i.test(e.name));
      if (!entry) return { error: 'No .ifc file inside this archive' };
      const raw = await zipEntryBytes(read, entry);
      const encoding = sniffText(raw);
      if (!encoding) return { binary: true };
      const text = new TextDecoder(encoding).decode(raw);
      return {
          total: loaded,
          loaded,
          done: true,
          isZip: true,
          zipBytes: bytes, // kept for 3D view
          ifcBytes: raw,
          encoding: encoding.toUpperCase(),
          dates: responseDates(res, res.headers.get('content-disposition') || ''),
          info: [['archive', `ZIP, ${entry.name} (${formatBytes(raw.length)} unpacked)`]],
          text,
          more: async () => {},
          loadAll: async () => {},
      };
  }

  // Module: readers/formats.ts

  // Formats: recognised from the file name or chosen by the user; reader and language of each

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Formats with a reader of their own (binary files); all others are text, coloured by language
  const FILE_FORMATS = {
      parquet: 'Parquet',
      sheet: 'Spreadsheet',
      ifczip: 'IFCZIP',
  };

  // Lists of the format picker: text formats (plain text first, then by name), file formats
  const FORMAT_LISTS = [
      ['Text', ['text', ...Object.keys(LANG_NAMES).sort((a, b) => LANG_NAMES[a].localeCompare(LANG_NAMES[b]))]],
      ['Files', Object.keys(FILE_FORMATS)],
  ];

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Format recognised from a file name ('text': plain text)
  function formatOf(name) {
      if (PARQUET_RE.test(name)) return 'parquet';
      if (SHEET_RE.test(name)) return 'sheet';
      if (ZIP_RE.test(name)) return 'ifczip';
      return langOf(name) || 'text';
  }

  const readerOf = (format) => (format in FILE_FORMATS ? format : 'text');

  // Language of a format, as in Viewer.lang (null: plain text)
  function langOfFormat(format) {
      if (format === 'ifczip') return 'ifc';
      return format === 'text' ? null : format;
  }

  const formatName = (format) => FILE_FORMATS[format] || LANG_NAMES[format] || 'Text';

  // Module: readers/links.ts

  // Links: .url shortcut files ("[InternetShortcut] URL=...") point to another file

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function linkTarget(name, text) {
      if (!/\.url$/i.test(name) && !/^\s*\[InternetShortcut\]/i.test(text)) return null;
      const m = text.match(/^\s*URL\s*=\s*(\S+)\s*$/im);
      if (!m) return null;

      let target;
      try {
          target = new URL(m[1], location.href);
      } catch {
          return null;
      }
      const display = decodeURIComponent(target.href);

      if (target.hostname === location.hostname) {
          const params = target.searchParams;
          // Viewer pages (.../AllItems.aspx?id=/sites/X/file.txt, Doc.aspx?id=...)
          const id = params.get('id');
          if (/\.aspx$/i.test(target.pathname) && id) {
              return {
                  display,
                  name: id.split('/').pop() ?? '',
                  fetchUrl: encodePath(id),
              };
          }
          // Direct links: /:t:/r/sites/X/file.txt?web=1 -> /sites/X/file.txt
          const direct = target.pathname.match(/^\/:[a-z]:\/r(\/.*)$/i);
          if (direct) {
              return { display, name: decodeURIComponent(direct[1]).split('/').pop() ?? '', fetchUrl: direct[1] };
          }
          // Share links: /:t:/s/... or /:t:/g/... -> raw file
          if (/^\/:[a-z]:\/[sg]\//i.test(target.pathname)) {
              params.delete('web');
              params.set('download', '1');
              return { display, name: '', fetchUrl: target.href };
          }
      }
      // Other sites not followed (openSource() refuses other origins)
      const last = decodeURIComponent(target.pathname).split('/').pop();
      return { display, name: last ?? '', fetchUrl: target.href };
  }

  // Module: readers/ranges.ts

  // Files by byte range (Parquet, spreadsheets): only the parts needed are fetched

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Parts of file by range; whole file at once if SharePoint ignores ranges. Same origin only.
  async function openRanges(
      url,
      getSignal,
      reload,
      onProgress,
  ) {
      if (!sameOrigin(url)) return { error: OUTSIDE };
      let whole = null; // whole file, if SharePoint ignores partial requests
      let size = 0;
      let fetched = 0;
      const request = (range) =>
          fetch(url, {
              credentials: 'same-origin',
              cache: reload ? 'reload' : 'default', // 'reload': fresh copy, which also updates cache
              headers: { Range: `bytes=${range}` },
              signal: getSignal(),
          });

      // Size and signature (first 8 bytes) from small request, or whole file
      const res = await request('0-7');
      if (!res.ok) return { error: `Error ${res.status} on caching` };
      const dates = responseDates(res, res.headers.get('content-disposition') || '');
      let head = new Uint8Array(await res.arrayBuffer());
      fetched = head.length;
      if (res.status === 206) size = Number((res.headers.get('content-range') || '').split('/')[1]) || 0;
      else {
          whole = head;
          size = whole.length;
          head = whole.subarray(0, 8);
      }
      onProgress(fetched, size);

      // Bytes [from, to) of file
      const read = async (from, to) => {
          from = Math.max(0, from);
          to = Math.min(size, to);
          if (from >= to) return new Uint8Array(0);
          if (whole) return whole.subarray(from, to);
          const r = await request(`${from}-${to - 1}`);
          if (!r.ok) throw new Error(`Error ${r.status} on caching`);
          const buf = new Uint8Array(await r.arrayBuffer());
          fetched += buf.length;
          onProgress(fetched, size);
          if (r.status !== 206 || (from === 0 && buf.length >= size)) {
              whole = buf; // all of it is here: no more requests
              return whole.subarray(from, to);
          }
          return buf;
      };
      return { size, head, dates, read, fetched: () => fetched, whole: () => !!whole };
  }

  // Module: readers/codecs/lz4.ts

  // LZ4 decompression (raw blocks and frames, as in Parquet)

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function unlz4(src, outLen) {
      const out = new Uint8Array(outLen);
      let ip = 0;
      let op = 0;
      while (ip < src.length) {
          const token = src[ip++];
          let lit = token >> 4;
          if (lit === 15) {
              let b;
              do {
                  b = src[ip++];
                  lit += b;
              } while (b === 255);
          }
          out.set(src.subarray(ip, ip + lit), op);
          ip += lit;
          op += lit;
          if (ip >= src.length) break;
          const off = src[ip] | (src[ip + 1] << 8);
          ip += 2;
          let m = token & 15;
          if (m === 15) {
              let b;
              do {
                  b = src[ip++];
                  m += b;
              } while (b === 255);
          }
          m += 4;
          for (let i = 0; i < m; i++, op++) out[op] = out[op - off];
      }
      return out;
  }

  // Module: readers/codecs/snappy.ts

  // Decompression (Snappy, LZ4 raw and ZSTD are built in; GZIP uses browser)

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function unsnappy(src) {
      let pos = 0;
      let len = 0;
      let shift = 0;
      let b;
      do {
          b = src[pos++];
          len += (b & 0x7f) * 2 ** shift;
          shift += 7;
      } while (b & 0x80);
      const out = new Uint8Array(len);
      let op = 0;
      while (pos < src.length) {
          const tag = src[pos++];
          const kind = tag & 3;
          if (kind === 0) {
              let n = tag >> 2;
              if (n >= 60) {
                  const bytes = n - 59;
                  n = 0;
                  for (let i = 0; i < bytes; i++) n += src[pos++] * 2 ** (8 * i);
              }
              n += 1;
              out.set(src.subarray(pos, pos + n), op);
              pos += n;
              op += n;
              continue;
          }
          let n;
          let off;
          if (kind === 1) {
              n = ((tag >> 2) & 7) + 4;
              off = ((tag >> 5) << 8) | src[pos++];
          } else if (kind === 2) {
              n = (tag >> 2) + 1;
              off = src[pos] | (src[pos + 1] << 8);
              pos += 2;
          } else {
              n = (tag >> 2) + 1;
              off = u32(src, pos);
              pos += 4;
          }
          for (let i = 0; i < n; i++, op++) out[op] = out[op - off];
      }
      return out;
  }

  // Module: readers/codecs/zstd.ts

  // Zstandard decompression (RFC 8878): frames with FSE and Huffman tables, no dictionaries (unused by Parquet)

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Literal and match length codes: [baseline, extra bits]
  const LL_CODES = [];
  for (let c = 0; c < 16; c++) LL_CODES.push([c, 0]);
  LL_CODES.push(
      [16, 1],
      [18, 1],
      [20, 1],
      [22, 1],
      [24, 2],
      [28, 2],
      [32, 3],
      [40, 3],
      [48, 4],
      [64, 6],
      [128, 7],
      [256, 8],
      [512, 9],
      [1024, 10],
      [2048, 11],
      [4096, 12],
      [8192, 13],
      [16384, 14],
      [32768, 15],
      [65536, 16],
  );
  const ML_CODES = [];
  for (let c = 0; c < 32; c++) ML_CODES.push([c + 3, 0]);
  ML_CODES.push(
      [35, 1],
      [37, 1],
      [39, 1],
      [41, 1],
      [43, 2],
      [47, 2],
      [51, 3],
      [59, 3],
      [67, 4],
      [83, 4],
      [99, 5],
      [131, 7],
      [259, 8],
      [515, 9],
      [1027, 10],
      [2051, 11],
      [4099, 12],
      [8195, 13],
      [16387, 14],
      [32771, 15],
      [65539, 16],
  );

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Backward bitstream (ZSTD Huffman / FSE): from last set bit; past start = 0
  function backReader(
      bytes,
      start,
      end,
  )

  {
      const last = bytes[end - 1];
      if (!last) throw new Error('ZSTD: damaged bitstream');
      let pos = (end - start - 1) * 8 + (31 - Math.clz32(last)); // just below end marker
      const bit = (p) => (p < 0 ? 0 : (bytes[start + (p >> 3)] >> (p & 7)) & 1);

      const take = (p, n) => {
          let v = 0;
          for (let i = 0; i < n; ) {
              const q = p + i;
              if (q < 0) {
                  i++;
                  continue;
              }
              const off = q & 7;
              const width = Math.min(8 - off, n - i);
              v += ((bytes[start + (q >> 3)] >> off) & ((1 << width) - 1)) * 2 ** i;
              i += width;
          }
          return v;
      };
      return {
          read(n) {
              pos -= n;
              return n ? take(pos, n) : 0;
          },
          peek(n) {
              return take(pos - n, n);
          },
          skip(n) {
              pos -= n;
          },
          overflow: () => pos < 0,
          done: () => pos === 0,
          bit,
      };
  }

  // FSE table description (forward bits) -> normalised counts; returns them and position after
  function readFseCounts(
      bytes,
      pos,
      maxSymbol,
  ) {
      let bitPos = pos * 8;

      const read = (n) => {
          let v = 0;
          for (let i = 0; i < n; i++, bitPos++) v |= ((bytes[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
          return v;
      };

      const peek = (n) => {
          const keep = bitPos;
          const v = read(n);
          bitPos = keep;
          return v;
      };
      const log = read(4) + 5;
      let remaining = (1 << log) + 1;
      let threshold = 1 << log;
      let nbBits = log + 1;
      const counts = [];
      let previousZero = false;
      while (remaining > 1 && counts.length <= maxSymbol) {
          if (previousZero) {
              let repeat;
              do {
                  repeat = read(2);
                  for (let i = 0; i < repeat; i++) counts.push(0);
              } while (repeat === 3);
          }
          if (counts.length > maxSymbol) break;
          const max = 2 * threshold - 1 - remaining;
          let count;
          if (peek(nbBits - 1) < max) {
              count = read(nbBits - 1);
          } else {
              count = read(nbBits);
              if (count >= threshold) count -= max;
          }
          count--;
          remaining -= count < 0 ? -count : count;
          counts.push(count);
          previousZero = count === 0;
          while (remaining < threshold) {
              nbBits--;
              threshold >>= 1;
          }
      }
      if (remaining !== 1) throw new Error('ZSTD: damaged FSE table');
      return { counts, log, pos: (bitPos + 7) >> 3 };
  }

  // Decode table from normalised counts: { symbol, nbBits, baseline }
  function buildFseTable(counts, log) {
      const size = 1 << log;
      const symbols = new Array(size);
      const next = [];
      let high = size - 1;
      counts.forEach((c, s) => {
          if (c === -1) {
              symbols[high--] = s;
              next[s] = 1;
          } else {
              next[s] = c;
          }
      });
      const step = (size >> 1) + (size >> 3) + 3;
      let pos = 0;
      counts.forEach((c, s) => {
          for (let i = 0; i < c; i++) {
              symbols[pos] = s;
              do pos = (pos + step) & (size - 1);
              while (pos > high);
          }
      });
      const table = Object.assign(new Array(size), { log });
      for (let u = 0; u < size; u++) {
          const s = symbols[u];
          const state = next[s]++;
          const nbBits = log - (31 - Math.clz32(state));
          table[u] = { symbol: s, nbBits, baseline: (state << nbBits) - size };
      }
      return table;
  }

  // Predefined distributions (RFC 8878, 3.1.1.3.2.2)
  const LL_DEFAULT = buildFseTable(
      [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1],
      6,
  );
  const ML_DEFAULT = buildFseTable(
      [
          1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
      ],
      6,
  );
  const OF_DEFAULT = buildFseTable(
      [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1],
      5,
  );

  // Huffman description -> decode table (index = next maxBits bits)
  function readHuffmanTable(bytes, pos) {
      const header = bytes[pos++];
      let weights;
      if (header < 128) {
          // Weights are FSE-compressed, decoded with two interleaved states
          const end = pos + header;
          const { counts, log, pos: at } = readFseCounts(bytes, pos, 255);
          const table = buildFseTable(counts, log);
          const r = backReader(bytes, at, end);
          let s1 = r.read(log);
          let s2 = r.read(log);
          weights = [];

          const step = (s) => {
              const e = table[s];
              weights.push(e.symbol);
              return e.baseline + r.read(e.nbBits);
          };
          for (;;) {
              s1 = step(s1);
              if (r.overflow()) {
                  weights.push(table[s2].symbol);
                  break;
              }
              s2 = step(s2);
              if (r.overflow()) {
                  weights.push(table[s1].symbol);
                  break;
              }
          }
          pos = end;
      } else {
          // Direct 4-bit weights
          const count = header - 127;
          weights = [];
          for (let i = 0; i < count; i++) {
              const b = bytes[pos + (i >> 1)];
              weights.push(i % 2 ? b & 15 : b >> 4);
          }
          pos += (count + 1) >> 1;
      }

      // Last weight is implied: it makes total power of two
      let total = 0;
      for (const w of weights) if (w) total += 1 << (w - 1);
      const maxBits = 32 - Math.clz32(total);
      const rest = (1 << maxBits) - total;
      weights.push(32 - Math.clz32(rest));

      const size = 1 << maxBits;
      const symbol = new Uint8Array(size);
      const bits = new Uint8Array(size);
      let at = 0;
      for (let w = 1; w <= maxBits; w++) {
          weights.forEach((wt, s) => {
              if (wt !== w) return;
              const len = 1 << (w - 1);
              symbol.fill(s, at, at + len);
              bits.fill(maxBits + 1 - w, at, at + len);
              at += len;
          });
      }
      return { table: { symbol, bits, maxBits }, pos };
  }

  function huffmanStream(
      bytes,
      start,
      end,
      huf,
      out,
      outPos,
      count,
  ) {
      const r = backReader(bytes, start, end);
      const { symbol, bits, maxBits } = huf;
      for (let i = 0; i < count; i++) {
          const idx = r.peek(maxBits);
          out[outPos + i] = symbol[idx];
          r.skip(bits[idx]);
      }
      if (!r.done()) throw new Error('ZSTD: damaged literals');
  }

  // One compressed block: literals, then sequences that copy literals and earlier output
  /** @param st frame state @returns new output position */
  function zstdBlock(src, pos, end, out, op, st) {
      // --- Literals section ---
      const b0 = src[pos];
      const type = b0 & 3;
      const format = (b0 >> 2) & 3;
      let regen;
      let compressed = 0;
      let streams = 1;
      if (type < 2) {
          if (format === 0 || format === 2) {
              regen = b0 >> 3;
              pos += 1;
          } else if (format === 1) {
              regen = (b0 >> 4) + (src[pos + 1] << 4);
              pos += 2;
          } else {
              regen = (b0 >> 4) + (src[pos + 1] << 4) + (src[pos + 2] << 12);
              pos += 3;
          }
      } else {
          const b1 = src[pos + 1];
          const b2 = src[pos + 2];
          if (format < 2) {
              streams = format === 0 ? 1 : 4;
              regen = (b0 >> 4) | ((b1 & 0x3f) << 4);
              compressed = (b1 >> 6) | (b2 << 2);
              pos += 3;
          } else if (format === 2) {
              streams = 4;
              regen = (b0 >> 4) | (b1 << 4) | ((b2 & 3) << 12);
              compressed = (b2 >> 2) | (src[pos + 3] << 6);
              pos += 4;
          } else {
              streams = 4;
              regen = (b0 >> 4) | (b1 << 4) | ((b2 & 0x3f) << 12);
              compressed = (b2 >> 6) | (src[pos + 3] << 2) | (src[pos + 4] << 10);
              pos += 5;
          }
      }

      let literals;
      if (type === 0) {
          literals = src.subarray(pos, pos + regen);
          pos += regen;
      } else if (type === 1) {
          literals = new Uint8Array(regen).fill(src[pos]);
          pos += 1;
      } else {
          const litEnd = pos + compressed;
          if (type === 2) {
              const t = readHuffmanTable(src, pos);
              st.huf = t.table;
              pos = t.pos;
          } else if (!st.huf) {
              throw new Error('ZSTD: missing Huffman table');
          }
          literals = new Uint8Array(regen);
          if (streams === 1) {
              huffmanStream(src, pos, litEnd, st.huf, literals, 0, regen);
          } else {
              const sizes = [
                  src[pos] | (src[pos + 1] << 8),
                  src[pos + 2] | (src[pos + 3] << 8),
                  src[pos + 4] | (src[pos + 5] << 8),
              ];
              const seg = Math.ceil(regen / 4);
              let at = pos + 6;
              for (let i = 0; i < 4; i++) {
                  const size = i < 3 ? sizes[i] : litEnd - at;
                  huffmanStream(src, at, at + size, st.huf, literals, i * seg, i < 3 ? seg : regen - 3 * seg);
                  at += size;
              }
          }
          pos = litEnd;
      }

      // --- Sequences section ---
      let nbSeq = src[pos++];
      if (nbSeq >= 128) {
          if (nbSeq === 255) {
              nbSeq = src[pos] + (src[pos + 1] << 8) + 0x7f00;
              pos += 2;
          } else {
              nbSeq = ((nbSeq - 128) << 8) + src[pos++];
          }
      }
      let lit = 0;
      if (nbSeq) {
          const modes = src[pos++];

          const table = (mode, def, maxSymbol, key) => {
              if (mode === 0) st[key] = def;
              else if (mode === 1) {
                  // RLE: every sequence uses same code
                  st[key] = Object.assign([{ symbol: src[pos++], nbBits: 0, baseline: 0 }], { log: 0 });
              } else if (mode === 2) {
                  const { counts, log, pos: at } = readFseCounts(src, pos, maxSymbol);
                  st[key] = buildFseTable(counts, log);
                  pos = at;
              }
              const t = st[key];
              if (!t) throw new Error('ZSTD: missing sequence table');
              return t;
          };
          const llT = table(modes >> 6, LL_DEFAULT, 35, 'll');
          const ofT = table((modes >> 4) & 3, OF_DEFAULT, 31, 'of');
          const mlT = table((modes >> 2) & 3, ML_DEFAULT, 52, 'ml');

          const r = backReader(src, pos, end);
          let ll = r.read(llT.log);
          let of = r.read(ofT.log);
          let ml = r.read(mlT.log);
          const rep = st.rep;
          for (let i = 0; i < nbSeq; i++) {
              const ofCode = ofT[of].symbol;
              const [mlBase, mlBits] = ML_CODES[mlT[ml].symbol];
              const [llBase, llBits] = LL_CODES[llT[ll].symbol];
              const ofValue = 2 ** ofCode + r.read(ofCode);
              const matchLen = mlBase + r.read(mlBits);
              const litLen = llBase + r.read(llBits);

              let offset;
              if (ofValue > 3) {
                  offset = ofValue - 3;
                  rep[2] = rep[1];
                  rep[1] = rep[0];
                  rep[0] = offset;
              } else {
                  const idx = ofValue - 1 + (litLen === 0 ? 1 : 0);
                  if (idx === 0) {
                      offset = rep[0];
                  } else {
                      offset = idx === 3 ? rep[0] - 1 : rep[idx];
                      if (idx !== 1) rep[2] = rep[1];
                      rep[1] = rep[0];
                      rep[0] = offset;
                  }
              }

              out.set(literals.subarray(lit, lit + litLen), op);
              op += litLen;
              lit += litLen;
              if (offset > op) throw new Error('ZSTD: damaged match offset');
              for (let k = 0; k < matchLen; k++, op++) out[op] = out[op - offset];

              if (i < nbSeq - 1) {
                  ll = llT[ll].baseline + r.read(llT[ll].nbBits);
                  ml = mlT[ml].baseline + r.read(mlT[ml].nbBits);
                  of = ofT[of].baseline + r.read(ofT[of].nbBits);
              }
          }
      }
      out.set(literals.subarray(lit), op);
      return op + literals.length - lit;
  }

  function unzstd(src, outLen) {
      const out = new Uint8Array(outLen);
      let pos = 0;
      let op = 0;
      while (pos < src.length) {
          const magic = u32(src, pos);
          pos += 4;
          if ((magic & 0xfffffff0) === 0x184d2a50) {
              pos += 4 + u32(src, pos); // skippable frame
              continue;
          }
          if (magic !== 0xfd2fb528) throw new Error('ZSTD: not a ZSTD frame');
          const fhd = src[pos++];
          const single = (fhd >> 5) & 1;
          const fcsFlag = fhd >> 6;
          const dictFlag = fhd & 3;
          if (!single) pos++; // window descriptor
          pos += [0, 1, 2, 4][dictFlag];
          pos += [single ? 1 : 0, 2, 4, 8][fcsFlag];
          const st = { rep: [1, 4, 8] };
          for (let last = 0; !last; ) {
              const h = src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16);
              pos += 3;
              last = h & 1;
              const type = (h >> 1) & 3;
              const size = h >> 3;
              if (type === 0) {
                  out.set(src.subarray(pos, pos + size), op);
                  op += size;
                  pos += size;
              } else if (type === 1) {
                  out.fill(src[pos], op, op + size);
                  op += size;
                  pos += 1;
              } else if (type === 2) {
                  op = zstdBlock(src, pos, pos + size, out, op, st);
                  pos += size;
              } else {
                  throw new Error('ZSTD: damaged block');
              }
          }
          if ((fhd >> 2) & 1) pos += 4; // checksum (not verified)
      }
      return op === out.length ? out : out.subarray(0, op);
  }

  // Module: readers/parquet/pages.ts

  // Parquet pages: decompression, hybrid RLE / bit-packed levels, plain values

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const TYPE_WIDTH = { 1: 4, 2: 8, 4: 4, 5: 8 };

  // ===========================================================================
  // METHODS
  // ===========================================================================

  async function decompress(codec, data, outLen) {
      if (codec === 0) return data;
      if (codec === 1) return unsnappy(data);
      if (codec === 2) {
          const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
          return new Uint8Array(await new Response(stream).arrayBuffer());
      }
      if (codec === 7) return unlz4(data, outLen);
      if (codec === 6) return unzstd(data, outLen);
      throw new Error(`compression ${CODEC_NAMES[codec] || codec} is not supported by this viewer`);
  }

  // ---------------------------------------------------------------------------
  // Values
  // ---------------------------------------------------------------------------

  // RLE / bit-packed hybrid (levels, dictionary indices, booleans)
  function readHybrid(
      bytes,
      pos,
      end,
      width,
      count,
      out,
  ) {
      const byteWidth = (width + 7) >> 3;
      let n = 0;
      while (n < count && pos < end) {
          let header = 0;
          let shift = 0;
          let b;
          do {
              b = bytes[pos++];
              header += (b & 0x7f) * 2 ** shift;
              shift += 7;
          } while (b & 0x80);
          if (header % 2) {
              const groups = Math.floor(header / 2);
              const start = pos;
              let bit = 0;
              for (let i = 0; i < groups * 8; i++, bit += width) {
                  let v = 0;
                  for (let k = 0; k < width; k++) {
                      const at = bit + k;
                      v |= ((bytes[start + (at >> 3)] >> (at & 7)) & 1) << k;
                  }
                  if (n < count) out[n++] = v;
              }
              pos = start + groups * width;
          } else {
              const run = Math.floor(header / 2);
              let v = 0;
              for (let k = 0; k < byteWidth; k++) v |= bytes[pos++] << (8 * k);
              for (let i = 0; i < run && n < count; i++) out[n++] = v;
          }
      }
      return out;
  }

  // DELTA_BINARY_PACKED; returns values and position after them
  function readDelta(bytes, pos, big) {
      const uvar = () => {
          let r = 0n;
          let s = 0n;
          let b;
          do {
              b = bytes[pos++];
              r |= BigInt(b & 0x7f) << s;
              s += 7n;
          } while (b & 0x80);
          return r;
      };
      const zigzag = (n) => (n >> 1n) ^ -(n & 1n);
      const blockSize = Number(uvar());
      const minis = Number(uvar());
      const total = Number(uvar());
      let value = zigzag(uvar());
      const perMini = blockSize / minis;
      if (!(perMini > 0 && perMini % 8 === 0) || total < 0) throw new Error('damaged delta-encoded values');
      const values = total ? [value] : [];
      while (values.length < total) {
          const minDelta = zigzag(uvar());
          const widths = bytes.subarray(pos, pos + minis);
          pos += minis;
          for (let m = 0; m < minis && values.length < total; m++) {
              const w = widths[m];
              const start = pos;
              for (let i = 0, bit = 0; i < perMini; i++, bit += w) {
                  let d = 0n;
                  for (let k = 0; k < w; k++) {
                      const at = bit + k;
                      if ((bytes[start + (at >> 3)] >> (at & 7)) & 1) d |= 1n << BigInt(k);
                  }
                  if (values.length < total) {
                      value += minDelta + d;
                      values.push(value);
                  }
              }
              pos = start + (perMini * w) / 8;
          }
      }
      return {
          values: values.map((v) => (big ? BigInt.asIntN(64, v) : Number(BigInt.asIntN(32, v)))),
          pos,
      };
  }

  // INT96 (old timestamp format): nanoseconds of day + Julian day
  function int96Date(dv, pos) {
      const nanos = dv.getBigInt64(pos, true);
      const day = dv.getInt32(pos + 8, true);
      return new Date((day - 2440588) * 86400000 + Number(nanos / 1000000n));
  }

  /** @param type physical type (missing: fixed length) @param typeLength length of fixed-length values */
  function readPlain(
      type,
      bytes,
      pos,
      n,
      typeLength,
  ) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
          switch (type) {
              case 0:
                  out[i] = ((bytes[pos + (i >> 3)] >> (i & 7)) & 1) === 1;
                  break;
              case 1:
                  out[i] = dv.getInt32(pos, true);
                  pos += 4;
                  break;
              case 2:
                  out[i] = dv.getBigInt64(pos, true);
                  pos += 8;
                  break;
              case 3:
                  out[i] = int96Date(dv, pos);
                  pos += 12;
                  break;
              case 4:
                  out[i] = dv.getFloat32(pos, true);
                  pos += 4;
                  break;
              case 5:
                  out[i] = dv.getFloat64(pos, true);
                  pos += 8;
                  break;
              case 6: {
                  const len = dv.getInt32(pos, true);
                  out[i] = bytes.subarray(pos + 4, pos + 4 + len);
                  pos += 4 + len;
                  break;
              }
              default: {
                  const len = Number(typeLength); // NaN if missing (damaged file)
                  out[i] = bytes.subarray(pos, pos + len);
                  pos += len;
              }
          }
      }
      if (type === 0) pos += Math.ceil(n / 8);
      return { values: out, pos };
  }

  /** @param st column state: column, dictionary (if read) */
  function decodeValues(
      st,
      encoding,
      data,
      pos,
      n,
  ) {
      const { type, typeLength } = st.col;
      switch (encoding) {
          case 0:
              return readPlain(type, data, pos, n, typeLength).values;
          case 2:
          case 8: {
              const dict = st.dict;
              if (!dict) throw new Error('dictionary page missing');
              const idx = readHybrid(data, pos + 1, data.length, data[pos], n, new Array(n));
              return idx.map((i) => dict[i]);
          }
          case 3: {
              const len = u32(data, pos);
              return readHybrid(data, pos + 4, pos + 4 + len, 1, n, new Array(n)).map((v) => v === 1);
          }
          case 5:
              return readDelta(data, pos, type === 2).values;
          case 6: {
              const lens = readDelta(data, pos, false);
              let at = lens.pos;
              return lens.values.slice(0, n).map((n) => {
                  const len = Number(n);
                  const part = data.subarray(at, at + len);
                  at += len;
                  return part;
              });
          }
          case 7: {
              const prefixes = readDelta(data, pos, false);
              const suffixes = readDelta(data, prefixes.pos, false);
              let at = suffixes.pos;
              let prev = new Uint8Array(0);
              return suffixes.values.slice(0, n).map((n, i) => {
                  const len = Number(n);
                  const prefix = Number(prefixes.values[i]);
                  const value = new Uint8Array(prefix + len);
                  value.set(prev.subarray(0, prefix));
                  value.set(data.subarray(at, at + len), prefix);
                  at += len;
                  prev = value;
                  return value;
              });
          }
          case 9: {
              const w = Number(TYPE_WIDTH[type ?? -1] || typeLength); // NaN if unknown (damaged file)
              const joined = new Uint8Array(n * w);
              for (let i = 0; i < n; i++) for (let k = 0; k < w; k++) joined[i * w + k] = data[pos + k * n + i];
              return readPlain(type, joined, 0, n, typeLength).values;
          }
          default:
              throw new Error(`Parquet encoding ${encoding} is not supported by this viewer`);
      }
  }

  // Module: readers/parquet/values.ts

  // Parquet values: display text (dates, decimals, strings, ...)

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const bytesToBigInt = (b) => {
      let v = 0n;
      for (const x of b) v = (v << 8n) | BigInt(x);
      return b.length && b[0] & 0x80 ? v - (1n << BigInt(b.length * 8)) : v;
  };

  const decimalText = (v, scale) => {
      if (!scale) return v.toString();
      const neg = v < 0n;
      const digits = (neg ? -v : v).toString().padStart(scale + 1, '0');
      return `${neg ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  };

  const hexText = (b) =>
      [...b.subarray(0, 32)].map((x) => x.toString(16).padStart(2, '0')).join('') + (b.length > 32 ? '…' : '');

  /** @param unit 1 ms, 2 µs, 3 ns */
  function timeText(v, unit, withDate) {
      const per = { 1: 1n, 2: 1000n, 3: 1000000n }[unit] || 1n;
      const big = BigInt(v);
      const ms = Number(big / per);
      const rest = big % per;
      try {
          let iso = new Date(ms).toISOString();
          if (rest) iso = iso.replace('Z', `${String(rest < 0n ? -rest : rest).padStart(per === 1000n ? 3 : 6, '0')}Z`);
          return withDate ? iso : iso.slice(11, -1);
      } catch {
          return big.toString();
      }
  }

  const unitOf = (u) => (u ? Number(Object.keys(u)[0]) : 1);

  function valueText(col, v) {
      if (v === null || v === undefined) return null;
      if (Array.isArray(v)) return JSON.stringify(v.map((x) => valueText(col, x)));
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
      const lt = col.logical || {};
      const ct = col.converted;
      const scale = lt[5]?.[1] ?? col.scale ?? 0;

      if (v instanceof Uint8Array) {
          if (lt[5] || ct === 5) return decimalText(bytesToBigInt(v), scale);
          if (lt[14] && v.length === 16) {
              const h = hexText(v);
              return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
          }
          if (lt[1] || ct === 0 || lt[4] || ct === 4 || lt[12] || ct === 19) return utf8.decode(v);
          const s = utf8.decode(v);
          // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters mark binary values
          return s.includes('�') || /[\x00-\x08]/.test(s) ? `0x${hexText(v)}` : s;
      }
      if (typeof v === 'number' || typeof v === 'bigint') {
          if (lt[5] || ct === 5) return decimalText(BigInt(v), scale);
          if (lt[6] || ct === 6) return new Date(Number(v) * 86400000).toISOString().slice(0, 10);
          if (lt[8]) return timeText(v, unitOf(lt[8][2]), true);
          if (ct === 9 || ct === 10) return timeText(v, ct === 9 ? 1 : 2, true);
          if (lt[7]) return timeText(v, unitOf(lt[7][2]), false);
          if (ct === 7 || ct === 8) return timeText(v, ct === 7 ? 1 : 2, false);
          if ((lt[10] && lt[10][2] === false) || (ct !== undefined && ct >= 11 && ct <= 14)) {
              return typeof v === 'bigint' ? BigInt.asUintN(64, v).toString() : String(v >>> 0);
          }
      }
      return String(v);
  }

  // Module: readers/parquet/source.ts

  // Parquet source: rows as CSV, more rows on demand

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Parquet source like openSource(): text = rows as CSV, more() = PARQUET_ROWS more
  async function openParquetSource(
      url,
      getSignal,
      reload,
      onProgress,
      force = false,
  ) {
      const file = await openRanges(url, getSignal, reload, onProgress);
      if ('error' in file) return file;
      const { size, dates, read } = file;
      if (size < 12) return { error: 'Not a Parquet file' };
      if (!file.whole() && size > MAX_BYTES && !force) return { deferred: 'Parquet', size, dates }; // asks first

      // Footer: last 64 KB usually hold all of it (asked for by exact position)
      let tail = await read(Math.max(0, size - 65536), size); // small file: all of it, no more requests
      if (utf8.decode(tail.subarray(tail.length - 4)) !== 'PAR1') return { error: 'Not a Parquet file' };
      const footerLen = u32(tail, tail.length - 8);
      let footer;
      if (footerLen + 8 <= tail.length) {
          footer = tail.subarray(tail.length - 8 - footerLen, tail.length - 8);
      } else {
          footer = await read(size - 8 - footerLen, size - 8);
      }
      tail = null;

      const meta = parseFooter(footer);
      const leaves = leafColumns(meta.schema);
      const names = leaves.map((c) => c.path.join('.').replace(/\.(list\.(element|item)|array|bag)$/, ''));

      // Column chunk, cached piece by piece as its pages are read

      const chunk = (start, stated) => {
          const length = Math.max(0, Math.min(stated, size - start)); // never past end of file
          const c = { length, buf: new Uint8Array(0), ensure: async () => {} };
          c.ensure = async (n) => {
              n = Math.min(n, length);
              if (c.buf.length >= n) return;
              const want = Math.min(length, Math.max(n, c.buf.length * 2, 64 * 1024));
              const more = await read(start + c.buf.length, start + want);
              if (!more.length) throw new Error('column data ends early (damaged file?)');
              c.buf = concatBytes([c.buf, more]);
          };
          return c;
      };

      // Per column: rows decoded so far (cur: list of the row being read), and where reading stopped
      // (row group, chunk and position in it, values read of the chunk, dictionary)

      const states = leaves.map((col, idx) => ({
          col,
          idx,
          rg: 0,
          rows: [],
          cur: null,
          curNull: false,
          chunk: null,
          ended: false,
          codec: 0,
          total: 0,
          read: 0,
          pos: 0,
          dict: null,
      }));

      const endRow = (st) => {
          if (st.cur) st.rows.push(st.cur.length || !st.curNull ? st.cur : null);
          st.cur = null;
      };

      const addValues = (
          st,
          reps,
          defs,
          values,
          n,
      ) => {
          const { maxDef, maxRep, repetition } = st.col;
          let vi = 0;
          for (let i = 0; i < n; i++) {
              const def = defs ? defs[i] : maxDef;
              const v = def === maxDef ? values[vi++] : null;
              if (!maxRep) {
                  st.rows.push(v);
                  continue;
              }
              if ((reps ? reps[i] : 0) === 0) {
                  endRow(st);
                  st.cur = [];
                  st.curNull = def === 0;
              }
              if (!st.cur) throw new Error(`column "${st.col.name}": list goes on before it began (damaged file?)`);
              if (def === maxDef) st.cur.push(v);
              else if (def === maxDef - 1 && repetition === 1) st.cur.push(null);
          }
      };

      const readPage = async (st, c) => {
          let header;
          let at;
          for (let want = 2048; ; want *= 4) {
              await c.ensure(st.pos + want);
              try {
                  const t = thriftReader(c.buf, st.pos);
                  header = t.struct(); // shape per the format
                  at = t.pos();
                  break;
              } catch (err) {
                  if (!(err instanceof RangeError)) throw err;
                  if (c.buf.length >= c.length) {
                      st.pos = c.length; // nothing readable left in this column part
                      return;
                  }
              }
          }
          const size = header[3] || 0;
          await c.ensure(at + size);
          const raw = c.buf.subarray(at, at + size);
          st.pos = at + size;
          const { col } = st;

          if (header[1] === 2) {
              const data = await decompress(st.codec, raw, header[2]);
              const dictHeader = header[7];
              if (!dictHeader) throw new Error(`column "${col.name}": dictionary page without header (damaged file?)`);
              st.dict = readPlain(col.type, data, 0, dictHeader[1], col.typeLength).values;
              return;
          }
          if (header[1] !== 0 && header[1] !== 3) return; // index pages: nothing to show

          const v2 = header[1] === 3;
          const h = v2 ? header[8] : header[5];
          if (!h) throw new Error(`column "${col.name}": data page without header (damaged file?)`);
          const n = h[1];
          let reps = null;
          let defs = null;
          let data;
          let pos = 0;
          if (v2) {
              const repLen = h[6] || 0;
              const defLen = h[5] || 0;
              if (col.maxRep) reps = readHybrid(raw, 0, repLen, bitWidth(col.maxRep), n, new Array(n));
              if (col.maxDef) defs = readHybrid(raw, repLen, repLen + defLen, bitWidth(col.maxDef), n, new Array(n));
              const rest = raw.subarray(repLen + defLen);
              data = h[7] === false ? rest : await decompress(st.codec, rest, header[2] - repLen - defLen);
          } else {
              data = await decompress(st.codec, raw, header[2]);
              if (col.maxRep) {
                  const len = u32(data, pos);
                  reps = readHybrid(data, pos + 4, pos + 4 + len, bitWidth(col.maxRep), n, new Array(n));
                  pos += 4 + len;
              }
              if (col.maxDef) {
                  const len = u32(data, pos);
                  defs = readHybrid(data, pos + 4, pos + 4 + len, bitWidth(col.maxDef), n, new Array(n));
                  pos += 4 + len;
              }
          }
          const present = defs ? defs.filter((d) => d === col.maxDef).length : n;
          const values = decodeValues(st, v2 ? h[4] : h[2], data, pos, present);
          addValues(st, reps, defs, values, n);
          st.read += n;
      };

      // Read pages of one column until it has `target` rows (or file ends)
      const fillColumn = async (st, target) => {
          while (st.rows.length < target && !st.ended) {
              if (!st.chunk) {
                  const rg = meta.rowGroups[st.rg];
                  if (!rg) {
                      endRow(st);
                      st.ended = true;
                      break;
                  }
                  const cc = rg.columns[st.idx];
                  const dict = cc.dictOffset;
                  const start = dict !== null && dict > 0 && dict < cc.dataOffset ? dict : cc.dataOffset;
                  st.chunk = chunk(start, cc.size);
                  st.codec = cc.codec;
                  st.total = cc.numValues;
                  st.read = 0;
                  st.pos = 0;
                  st.dict = null;
              }
              if (st.read >= st.total || st.pos >= st.chunk.length) {
                  endRow(st);
                  st.chunk = null;
                  st.rg++;
                  continue;
              }
              const before = st.pos;
              await readPage(st, st.chunk);
              if (st.pos <= before) throw new Error(`column "${st.col.name}" could not be read (damaged file?)`);
          }
      };

      const codecs = [...new Set(meta.rowGroups.flatMap((rg) => rg.columns.map((c) => CODEC_NAMES[c.codec] || c.codec)))];
      const src = {
          total: size,
          loaded: file.fetched(),
          done: false,
          isParquet: true,
          format: 'Parquet',
          wholeLines: true,
          dates,
          info: [
              ['shape', `${meta.numRows.toLocaleString()} rows × ${leaves.length} columns`],
              ['row groups', meta.rowGroups.length],
              ['compression', codecs.join(', ')],
              ['written by', meta.createdBy],
          ],
          text: '',
          rows: 0,
          label: () =>
              `${(src.rows ?? 0).toLocaleString()} of ${meta.numRows.toLocaleString()} rows · ${leaves.length} columns`,
          nextLabel: `Show next ${PARQUET_ROWS} rows`,
          more: () => fill(target + PARQUET_ROWS),
          loadAll: () => fill(meta.numRows),
      };
      const lines = [names.map(csvCell).join(',')];
      let target = 0;

      const fill = async (n) => {
          target = Math.min(n, meta.numRows);
          await Promise.all(states.map((st) => fillColumn(st, target)));
          const count = Math.min(target, ...states.map((st) => st.rows.length));
          for (let r = lines.length - 1; r < count; r++) {
              lines.push(states.map((st) => csvCell(valueText(st.col, st.rows[r]))).join(','));
          }
          src.rows = count;
          src.text = lines.join('\n');
          src.loaded = file.fetched();
          src.done = count >= meta.numRows || states.every((st) => st.ended);
      };

      if (!leaves.length) return { error: 'Parquet file without columns' };
      await fill(PARQUET_ROWS);
      return src;
  }

  // Module: readers/sheets/xml.ts

  // XML without DOM (also for huge sheets; DOMParser builds the whole tree)

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

  const SHEET_ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Line ends as XML reads them (\r\n -> \n), entities decoded
  const xmlText = (s) => xmlEntities(s.includes('\r') ? s.replace(/\r\n?/g, '\n') : s);

  const xmlEntities = (s) =>
      s.includes('&')
          ? s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
                if (e[0] !== '#') return XML_ENTITIES[e] ?? m;
                const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1));
                return code <= 0x10ffff ? String.fromCodePoint(code) : m;
            })
          : s;

  // OOXML escapes characters XML cannot hold: _x000D_ = carriage return
  const ooxmlText = (s) =>
      s.includes('_x') ? s.replace(/_x([\da-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : s;

  // Attributes, names without namespace prefix
  function xmlAttrs(s) {
      const out = {};
      for (const m of s.matchAll(SHEET_ATTR_RE)) out[m[1].slice(m[1].indexOf(':') + 1)] = xmlText(m[2] ?? m[3]);
      return out;
  }

  // Tags (names without prefix) and raw text between them; empty tags open and close at once
  /**
   * @param text raw (entities not decoded)
   */
  function scanXml(
      xml,
      open,
      close,
      text,
  ) {
      const re = /<(\/?)([^\s/>!?]+)([^>]*?)(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[!?][^>]*>/g;
      let last = 0;
      for (let m = re.exec(xml); m; m = re.exec(xml)) {
          if (text && m.index > last) text(xml.slice(last, m.index));
          last = re.lastIndex;
          if (m[5] !== undefined) {
              if (text) text(m[5].replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'))); // raw like other text
              continue;
          }
          if (!m[2]) continue; // comment, declaration
          const name = m[2].slice(m[2].indexOf(':') + 1);
          if (m[1]) close(name);
          else {
              open(name, m[3]);
              if (m[4]) close(name);
          }
      }
  }

  function xmlString(b) {
      const bom = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : 'utf-8';
      return new TextDecoder(bom).decode(b);
  }

  // Module: readers/sheets/ods.ts

  // OpenDocument spreadsheet: all sheets in content.xml, cells with their display text;
  // named database ranges as tables

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Range address "Sheet1.A1:Sheet1.D9", "'My sheet'.$A$1:.$D$9": sheet, first cell, last cell
  const ODS_RANGE_RE =
      /^\$?('(?:[^']|'')*'|[^.']*)\.([$A-Za-z]+[$\d]+)(?::\$?(?:'(?:[^']|'')*'|[^.']*)\.([$A-Za-z]+[$\d]+))?$/;

  // Ranges LibreOffice makes itself (e.g. for a filter): not named by the user
  const ODS_ANONYMOUS_RE = /^__Anonymous_Sheet_DB__/;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function odsSheets(xml) {
      const sheets = [];
      const ranges = []; // attributes of database ranges
      let grid = null;
      let name = '';
      let depth = 0; // tables inside cells (rare) are part of their cell
      let r = 0;
      let c = 0;
      let row = null; // texts of current row
      let rowRepeat = 1;
      let cell = null; // { repeat, text, value } (value: typed, else text shown)
      let para = 0;
      let note = 0; // annotations (comments): not part of cell text
      const add = (s) => {
          if (cell && para && !note) cell.text += s;
      };
      scanXml(
          xml,
          (n, a) => {
              if (n === 'database-range' && !depth) return void ranges.push(xmlAttrs(a));
              if (n === 'table') {
                  if (depth++) return;
                  grid = sheetGrid();
                  name = xmlAttrs(a).name || `Sheet${sheets.length + 1}`;
                  r = 0;
              }
              if (depth !== 1) return;
              if (n === 'table-row') {
                  rowRepeat = Math.max(1, Number(xmlAttrs(a)['number-rows-repeated']) || 1);
                  row = [];
                  c = 0;
              } else if (n === 'table-cell' || n === 'covered-table-cell') {
                  const at = xmlAttrs(a);
                  cell = {
                      repeat: Math.max(1, Number(at['number-columns-repeated']) || 1),
                      text: null,
                      value: odsValue(at),
                  };
              } else if (n === 'annotation') note++;
              else if (n === 'p' && cell && !note) {
                  cell.text = cell.text === null ? '' : `${cell.text}\n`;
                  para++;
              } else if (n === 's') add(' '.repeat(Math.min(1000, Number(xmlAttrs(a).c) || 1)));
              else if (n === 'tab') add('\t');
              else if (n === 'line-break') add('\n');
          },
          (n) => {
              if (n === 'table') {
                  if (--depth) return;
                  sheets.push({ name, data: (grid).done() }); // opened with the table
                  grid = null;
              }
              if (depth !== 1) return;
              if (n === 'p' && para) para--;
              else if (n === 'annotation') note--;
              else if ((n === 'table-cell' || n === 'covered-table-cell') && cell && row) {
                  const text = cell.value ?? cell.text ?? '';
                  if (text !== '') for (let k = 0; k < cell.repeat && c + k < MAX_SHEET_COLS; k++) row[c + k] = text;
                  c += cell.repeat;
                  cell = null;
              } else if (n === 'table-row' && row) {
                  // repeated rows: often a million empty ones at the end, kept only while they hold text
                  if (row.length) {
                      for (let k = 0; k < rowRepeat && r + k < MAX_SHEET_ROWS; k++) {
                          if (!row.every((t, col) => (grid).set(r + k, col, t))) break;
                      }
                  }
                  r += rowRepeat;
                  row = null;
              }
          },
          (raw) => add(xmlText(raw)),
      );
      return { sheets, ranges };
  }

  // Named database ranges -> tables (header row unless contains-header="false", totals row if
  // contains-footer="true" (LibreOffice extension); no column names)
  /** @param names sheet names */
  function odsTables(ranges, names) {
      const tables = [];
      for (const at of ranges) {
          const m = ODS_RANGE_RE.exec(at['target-range-address'] || '');
          if (!m || !at.name || ODS_ANONYMOUS_RE.test(at.name)) continue;
          const sheet = names.indexOf(m[1].replace(/^'|'$/g, '').replace(/''/g, "'"));
          const range = cellRange(m[3] ? `${m[2]}:${m[3]}` : m[2]);
          if (sheet < 0 || !range) continue;
          const header = at['contains-header'] === 'false' ? 0 : 1;
          const totals = at['contains-footer'] === 'true' ? 1 : 0;
          tables.push({ name: at.name, range, header, totals, columns: [], sheet });
      }
      return tables;
  }

  // Typed value as the Excel formats show it (ISO dates, plain numbers); null = use cell text
  function odsValue(at) {
      const type = at['value-type'];
      const n = Number(at.value);
      if ((type === 'float' || type === 'currency') && at.value) return generalText(n);
      if (type === 'percentage' && at.value) return `${generalText(n * 100)}%`;
      if (type === 'boolean') return /^true$/i.test(at['boolean-value'] || '') ? 'TRUE' : 'FALSE';
      if (type === 'date' && at['date-value']) return at['date-value'].replace('T', ' ').replace(/(\.\d+)?Z?$/, '');
      const t = type === 'time' && /^-?PT(\d+)H(\d+)M(\d+)/.exec(at['time-value'] || '');
      if (t) return [t[1], t[2], t[3]].map((x) => x.padStart(2, '0')).join(':');
      return null;
  }

  async function readOds(pkg) {
      if ((await pkg.text('META-INF/manifest.xml'))?.includes('encryption-data')) {
          throw new Error('the file is password-protected');
      }
      const found = odsSheets(xmlString((await pkg.bytes('content.xml')))); // entry checked by the caller
      // all sheets come with content.xml: cached at once
      const sheets = found.sheets.map((s) => ({ name: s.name, hidden: false, kind: 'sheet', size: 0, data: s.data }));
      return {
          format: 'OpenDocument spreadsheet',
          sheets,
          tables: odsTables(
              found.ranges,
              sheets.map((s) => s.name),
          ),
          active: 0,
          date1904: false,
          load: async (i) => sheets[i].data,
      };
  }

  // Module: readers/sheets/package.ts

  // Packages (ZIP): parts by path, relationships between them

  // ===========================================================================
  // METHODS
  // ===========================================================================

  async function zipPackage(read, size) {
      const entries = await zipEntries(read, size);
      const byName = new Map(entries.map((e) => [e.name.replace(/\\/g, '/').toLowerCase(), e])); // some writers use \
      const entry = (path) => (path ? byName.get(path.replace(/^\//, '').toLowerCase()) : undefined);
      const bytes = async (path) => {
          const e = entry(path);
          return e ? zipEntryBytes(read, e) : null;
      };
      const text = async (path) => {
          const b = await bytes(path);
          return b ? xmlString(b) : null;
      };
      const paths = () => [...byName.keys()];
      return { paths, entry, bytes, text };
  }

  // Path of target, relative to folder of `base` (or from root with leading "/")
  function partPath(base, target) {
      if (target.startsWith('/')) return target.slice(1);
      const parts = base.split('/').slice(0, -1);
      for (const p of target.split('/')) {
          if (p === '..') parts.pop();
          else if (p && p !== '.') parts.push(p);
      }
      return parts.join('/');
  }

  /** @returns "xl/workbook.xml" -> "xl/_rels/workbook.xml.rels" */
  const relsPath = (part) => part.replace(/[^/]*$/, (n) => `_rels/${n}.rels`);

  // Relationships of a part: id -> { path, type }
  async function partRels(pkg, part) {
      const out = new Map();
      const xml = await pkg.text(relsPath(part));
      if (!xml) return out;
      scanXml(
          xml,
          (n, a) => {
              if (n !== 'Relationship') return;
              const at = xmlAttrs(a);
              if (at.TargetMode !== 'External' && at.Target) {
                  out.set(at.Id, { path: partPath(part, at.Target), type: at.Type || '' });
              }
          },
          () => {},
      );
      return out;
  }

  // Module: readers/sheets/xlsb.ts

  // Excel binary workbook (.xlsb): same parts as OOXML, as BIFF12 records

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // RK: 30-bit integer or high bits of a double, optionally divided by 100
  const rkView = new DataView(new ArrayBuffer(8));

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Records: type and size as 7-bit varints, then data
  function biff12Records(b, on) {
      let p = 0;
      while (p < b.length) {
          let type = b[p++];
          if (type & 0x80) type = (type & 0x7f) | ((b[p++] & 0x7f) << 7);
          let size = 0;
          for (let i = 0; i < 4; i++) {
              const x = b[p++];
              size |= (x & 0x7f) << (7 * i);
              if (!(x & 0x80)) break;
          }
          on(type, b.subarray(p, p + size));
          p += size;
      }
  }

  // XLWideString: character count (4 bytes), then UTF-16; count 0xFFFFFFFF = none
  function wideString(d, at) {
      if (at + 4 > d.length) return { text: '', end: d.length };
      const n = dataView(d).getUint32(at, true);
      if (n === 0xffffffff) return { text: '', end: at + 4 };
      const end = Math.min(d.length, at + 4 + 2 * n);
      return { text: utf16le.decode(d.subarray(at + 4, end)), end };
  }

  function rkNumber(rk) {
      let n;
      if (rk & 2) n = rk >> 2;
      else {
          rkView.setUint32(0, 0, true);
          rkView.setUint32(4, rk & 0xfffffffc, true);
          n = rkView.getFloat64(0, true);
      }
      return rk & 1 ? n / 100 : n;
  }

  const XLSB_PARTS = {
      workbook(bytes) {
          const sheets = [];
          let active = 0;
          let date1904 = false;
          let views = 0;
          biff12Records(bytes, (type, d) => {
              const dv = dataView(d);
              if (type === 156 && d.length >= 12) {
                  // BrtBundleSh: state, tab id, relationship id, name
                  const id = wideString(d, 8);
                  sheets.push({ name: wideString(d, id.end).text, id: id.text, hidden: dv.getUint32(0, true) !== 0 });
              } else if (type === 153 && d.length >= 4)
                  date1904 = (dv.getUint32(0, true) & 1) === 1; // BrtWbProp
              else if (type === 158 && d.length >= 28 && !views++) active = dv.getUint32(24, true); // BrtBookView
          });
          return { sheets, active, date1904 };
      },

      strings(bytes) {
          const out = [];
          biff12Records(bytes, (type, d) => {
              if (type === 19) out.push(wideString(d, 1).text); // BrtSSTItem: flags, text
          });
          return out;
      },

      styles(bytes) {
          const codes = new Map();
          const xfs = [];
          let inXfs = false;
          biff12Records(bytes, (type, d) => {
              if (type === 44 && d.length >= 2)
                  codes.set(d[0] | (d[1] << 8), wideString(d, 2).text); // BrtFmt
              else if (type === 617)
                  inXfs = true; // BrtBeginCellXFs
              else if (type === 618) inXfs = false;
              else if (type === 47 && inXfs && d.length >= 4) xfs.push(d[2] | (d[3] << 8)); // BrtXF
          });
          return xfs.map((id) => codes.get(id) ?? BUILTIN_FORMATS[id] ?? '');
      },

      sheet(bytes, strings, kinds, date1904) {
          const grid = sheetGrid();
          let r = 0;
          biff12Records(bytes, (type, d) => {
              if (type === 0) {
                  if (d.length >= 4) r = dataView(d).getUint32(0, true); // BrtRowHdr
                  return;
              }
              if (!((type >= 2 && type <= 11) || type === 62) || d.length < 9) return; // cells only
              const dv = dataView(d);
              const c = dv.getUint32(0, true);
              const num = (n) => numberText(n, kinds[dv.getUint32(4, true) & 0xffffff] || '', date1904);
              let text = '';
              if (type === 2) text = num(rkNumber(dv.getUint32(8, true)));
              else if (type === 5 || type === 9) text = d.length >= 16 ? num(dv.getFloat64(8, true)) : '';
              else if (type === 4 || type === 10) text = d[8] ? 'TRUE' : 'FALSE';
              else if (type === 3 || type === 11) text = SHEET_ERRORS[d[8]] ?? '#ERROR';
              else if (type === 7) text = strings[dv.getUint32(8, true)] ?? '';
              else if (type === 6 || type === 8) text = wideString(d, 8).text;
              else if (type === 62) text = wideString(d, 9).text; // rich text: flags first
              grid.set(r, c, text);
          });
          return grid.done();
      },

      // Table: BrtBeginList (range, header and totals rows, names), BrtBeginListCol (column names)
      table(bytes) {
          let out = null;
          const columns = [];
          biff12Records(bytes, (type, d) => {
              const dv = dataView(d);
              if (type === 343 && d.length >= 68 && !out) {
                  // range: first and last row, first and last column; names after 13 fixed fields
                  const name = wideString(d, 64);
                  const shown = wideString(d, name.end).text;
                  out = {
                      name: shown || name.text,
                      range: {
                          r0: dv.getUint32(0, true),
                          r1: dv.getUint32(4, true),
                          c0: dv.getUint32(8, true),
                          c1: dv.getUint32(12, true),
                      },
                      header: dv.getUint32(24, true),
                      totals: dv.getUint32(28, true),
                      columns,
                  };
              } else if (type === 347 && d.length >= 28) {
                  // name (often none), then caption shown in the header row
                  const name = wideString(d, 24);
                  columns.push(wideString(d, name.end).text || name.text);
              }
          });
          return out;
      },
  };

  // Module: readers/sheets/xlsx.ts

  // Excel 2007+ (OOXML): workbook, shared strings, styles and sheets as XML

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const XLSX_PARTS = {
      workbook(bytes) {
          const sheets = [];
          let active = 0;
          let date1904 = false;
          let views = 0;
          scanXml(
              xmlString(bytes),
              (n, a) => {
                  if (n === 'sheet') {
                      const at = xmlAttrs(a);
                      sheets.push({
                          name: at.name || `Sheet${sheets.length + 1}`,
                          id: at.id,
                          hidden: !!at.state && at.state !== 'visible',
                      });
                  } else if (n === 'workbookPr') {
                      if (/^(1|true)$/.test(xmlAttrs(a).date1904 || '')) date1904 = true; // extensions may repeat it without
                  } else if (n === 'workbookView' && !views++) {
                      active = Number(xmlAttrs(a).activeTab) || 0;
                  }
              },
              () => {},
          );
          return { sheets, active, date1904 };
      },

      strings(bytes) {
          const out = [];
          let cur = null;
          let inText = false;
          let phonetic = 0; // <rPh>: reading aid, not part of the text
          scanXml(
              xmlString(bytes),
              (n) => {
                  if (n === 'si') cur = '';
                  else if (n === 'rPh') phonetic++;
                  else if (n === 't') inText = true;
              },
              (n) => {
                  if (n === 'si') {
                      out.push(ooxmlText(cur ?? ''));
                      cur = null;
                  } else if (n === 'rPh') phonetic--;
                  else if (n === 't') inText = false;
              },
              (raw) => {
                  if (inText && !phonetic && cur !== null) cur += xmlText(raw);
              },
          );
          return out;
      },

      // Number format code per cell style (index = style "s" of cells)
      styles(bytes) {
          const codes = new Map();
          const xfs = [];
          let where = ''; // 'numFmts' | 'cellXfs'
          scanXml(
              xmlString(bytes),
              (n, a) => {
                  if (n === 'numFmts' || n === 'cellXfs') where = n;
                  else if (n === 'numFmt' && where === 'numFmts') {
                      const at = xmlAttrs(a);
                      codes.set(Number(at.numFmtId), at.formatCode || '');
                  } else if (n === 'xf' && where === 'cellXfs') xfs.push(Number(xmlAttrs(a).numFmtId) || 0);
              },
              (n) => {
                  if (n === where) where = '';
              },
          );
          return xfs.map((id) => codes.get(id) ?? BUILTIN_FORMATS[id] ?? '');
      },

      sheet(bytes, strings, kinds, date1904) {
          const grid = sheetGrid();
          let r = -1;
          let c = -1;
          let cell = null; // { t, s, v, is }
          let field = ''; // 'v' value, 't' inline text
          let phonetic = 0;
          scanXml(
              xmlString(bytes),
              (n, a) => {
                  if (n === 'c') {
                      const at = xmlAttrs(a);
                      if (at.r) {
                          c = refCol(at.r);
                          r = Number(at.r.replace(/^[A-Za-z]+/, '')) - 1;
                      } else c++;
                      cell = { t: at.t || 'n', s: Number(at.s) || 0, v: '', is: '' };
                  } else if (n === 'row') {
                      const at = xmlAttrs(a);
                      r = at.r ? Number(at.r) - 1 : r + 1;
                      c = -1;
                  } else if (cell && (n === 'v' || n === 't')) field = n;
                  else if (n === 'rPh') phonetic++;
              },
              (n) => {
                  if (n === 'c' && cell) {
                      grid.set(r, c, cellText(cell));
                      cell = null;
                  } else if (n === 'v' || n === 't') field = '';
                  else if (n === 'rPh') phonetic--;
              },
              (raw) => {
                  if (!cell || !field || phonetic) return;
                  if (field === 'v') cell.v += xmlText(raw);
                  else cell.is += xmlText(raw);
              },
          );
          return grid.done();

          function cellText({ t, s, v, is }) {
              if (t === 's') return strings[Number(v)] ?? '';
              if (t === 'inlineStr') return ooxmlText(is);
              if (t === 'str') return ooxmlText(v);
              if (t === 'b') return v.trim() === '1' ? 'TRUE' : 'FALSE';
              if (t === 'e') return v;
              if (t === 'd') return v.replace('T', ' ').replace(/Z$/, '');
              return v.trim() === '' ? '' : numberText(Number(v), kinds[s] || '', date1904);
          }
      },

      // Table (ECMA-376 part 1, 18.5): name shown in Excel, range, header and totals rows, column names
      table(bytes) {
          let out = null;
          const columns = [];
          scanXml(
              xmlString(bytes),
              (n, a) => {
                  const at = xmlAttrs(a);
                  if (n === 'table' && !out) {
                      const range = cellRange(at.ref || '');
                      if (!range) return;
                      out = {
                          name: at.displayName || at.name || '',
                          range,
                          header: at.headerRowCount === undefined ? 1 : Number(at.headerRowCount) || 0,
                          totals: Number(at.totalsRowCount) || 0,
                          columns,
                      };
                  } else if (n === 'tableColumn') columns.push(ooxmlText(at.name || ''));
              },
              () => {},
          );
          return out;
      },
  };

  // Module: readers/sheets/ooxml.ts

  // OOXML workbooks (.xlsx, .xlsm, .xlsb): parts read from the ZIP by range; tables of the sheets

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Table parts (Excel keeps them in xl/tables)
  const TABLE_PART_RE = /(^|\/)tables\/[^/]+\.(xml|bin)$/i;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Excel 2007+ package: workbook part from package relationships (.xlsx: XML, .xlsb: binary)
  async function readOoxml(pkg) {
      const main = [...(await partRels(pkg, '')).values()].find((r) => r.type.endsWith('/officeDocument'))?.path;
      const wbPath = [main, 'xl/workbook.xml', 'xl/workbook.bin'].find((p) => pkg.entry(p));
      if (!wbPath) throw new Error('no workbook inside (not a spreadsheet?)');
      const binary = /\.bin$/i.test(wbPath);
      const parts = binary ? XLSB_PARTS : XLSX_PARTS;
      const rels = await partRels(pkg, wbPath);
      const relOf = (type) => [...rels.values()].find((r) => r.type.endsWith(`/${type}`))?.path;
      const wb = parts.workbook((await pkg.bytes(wbPath))); // found above

      const stringsPath = relOf('sharedStrings');
      const stylesPath = relOf('styles');
      const strings = pkg.entry(stringsPath) ? parts.strings((await pkg.bytes(stringsPath))) : [];
      const kinds = pkg.entry(stylesPath)
          ? parts.styles((await pkg.bytes(stylesPath))).map(formatKind)
          : [];

      const sheets = wb.sheets.map((s, i) => {
          const rel = rels.get(s.id);
          const path = rel?.path || `xl/worksheets/sheet${i + 1}.${binary ? 'bin' : 'xml'}`;
          return {
              name: s.name,
              hidden: s.hidden,
              kind: /chartsheet$/i.test(rel?.type || '') ? 'chart' : 'sheet',
              size: pkg.entry(path)?.packed || 0,
              path,
          };
      });
      return {
          format: `Excel (${binary ? 'XLSB' : 'XLSX'})`,
          sheets,
          tables: await readTables(pkg, sheets, parts),
          active: wb.active,
          date1904: wb.date1904,
          load: async (i) => {
              const s = sheets[i];
              if (s.kind !== 'sheet' || !pkg.entry(s.path)) return null;
              return parts.sheet((await pkg.bytes(s.path)), strings, kinds, wb.date1904); // entry checked above
          },
      };
  }

  // Tables of all sheets, from the sheets' relationships (only looked for if the package has table parts)
  async function readTables(pkg, sheets, parts) {
      const tables = [];
      if (!pkg.paths().some((p) => TABLE_PART_RE.test(p))) return tables;
      for (const [i, s] of sheets.entries()) {
          if (s.kind !== 'sheet') continue;
          for (const rel of (await partRels(pkg, s.path)).values()) {
              if (!rel.type.endsWith('/table') || !pkg.entry(rel.path)) continue;
              const t = parts.table((await pkg.bytes(rel.path))); // entry checked above
              if (t && t.range.r0 <= t.range.r1 && t.range.c0 <= t.range.c1) tables.push({ ...t, sheet: i });
          }
      }
      return tables;
  }

  // Module: readers/sheets/cfb.ts

  // Compound File Binary (CFB, [MS-CFB]): directory and streams, read sector by sector

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Compound file: directory at once; streams read sector by sector, only where needed
  async function compoundFile(read, size) {
      const h = await read(0, 512);
      const dv = dataView(h);
      if (h.length < 512 || dv.getUint32(0, true) !== 0xe011cfd0 || dv.getUint32(4, true) !== 0xe11ab1a1) {
          throw new Error('not an Office file');
      }
      const ss = 2 ** dv.getUint16(30, true); // sector size: 512 or 4096
      const mss = 2 ** dv.getUint16(32, true); // mini sector size: 64
      const cutoff = dv.getUint32(56, true); // smaller streams live in the mini stream
      const SPECIAL = 0xfffffffa; // ids from here on: end of chain, free, …
      const off = (s) => (s + 1) * ss; // header takes the first sector's place

      // Sectors -> bytes (consecutive ones in one request)
      const readSectors = async (ids) => {
          const parts = [];
          for (let i = 0; i < ids.length; ) {
              let j = i + 1;
              while (j < ids.length && ids[j] === ids[j - 1] + 1) j++;
              parts.push(await read(off(ids[i]), off(ids[j - 1]) + ss));
              i = j;
          }
          return concatBytes(parts.length ? parts : [new Uint8Array(0)]);
      };
      const u32s = (b) => {
          const d = dataView(b);
          return Uint32Array.from({ length: b.length >> 2 }, (_, i) => d.getUint32(4 * i, true));
      };

      // Allocation table: sector ids of its parts in header (first 109), more in DIFAT chain
      const nFat = dv.getUint32(44, true);
      const fatIds = [];
      for (let i = 0; i < 109 && fatIds.length < nFat; i++) fatIds.push(dv.getUint32(76 + 4 * i, true));
      for (let s = dv.getUint32(68, true), k = 0; s < SPECIAL && fatIds.length < nFat && k < size / ss; k++) {
          const d = dataView(await read(off(s), off(s) + ss));
          for (let i = 0; i < ss / 4 - 1 && fatIds.length < nFat; i++) fatIds.push(d.getUint32(4 * i, true));
          s = d.getUint32(ss - 4, true);
      }
      const fat = u32s(await readSectors(fatIds));
      const chain = (start, table = fat) => {
          const ids = [];
          for (let s = start; s < SPECIAL && s < table.length && ids.length < table.length; s = table[s]) ids.push(s);
          return ids;
      };

      // Directory: 128 bytes per entry (name, type, first sector, size)
      const dir = await readSectors(chain(dv.getUint32(48, true)));
      const dd = dataView(dir);
      const entries = [];
      for (let at = 0; at + 128 <= dir.length; at += 128) {
          const type = dir[at + 66];
          if (!type) continue;
          const len = Math.min(64, dd.getUint16(at + 64, true));
          entries.push({
              name: utf16le.decode(dir.subarray(at, at + Math.max(0, len - 2))),
              type, // 1 storage, 2 stream, 5 root
              start: dd.getUint32(at + 116, true),
              size: dd.getUint32(at + 120, true),
          });
      }
      const root = entries.find((e) => e.type === 5);

      // Big stream: sectors fetched when a range of it is asked for, kept for later
      const bigStream = (start, length) => {
          const ids = chain(start);
          const buf = new Uint8Array(Math.min(length, ids.length * ss));
          const have = new Uint8Array(ids.length);
          return {
              size: buf.length,
              bytes: async (from, to) => {
                  to = Math.min(to, buf.length);
                  for (let i = Math.floor(from / ss), last = Math.ceil(to / ss); i < last; ) {
                      if (have[i]) {
                          i++;
                          continue;
                      }
                      let j = i + 1;
                      while (j < last && !have[j] && ids[j] === ids[j - 1] + 1) j++;
                      const part = await read(off(ids[i]), off(ids[i]) + (j - i) * ss);
                      buf.set(part.subarray(0, buf.length - i * ss), i * ss);
                      have.fill(1, i, j);
                      i = j;
                  }
                  return buf.subarray(from, to);
              },
          };
      };

      // Small stream: in the mini stream (root's stream), read whole
      let mini = null;
      const smallStream = async (start, length) => {
          if (!mini) {
              const table = u32s(await readSectors(chain(dv.getUint32(60, true))));
              const data = root ? await bigStream(root.start, root.size).bytes(0, root.size) : new Uint8Array(0);
              mini = { table, data };
          }
          const out = new Uint8Array(length);
          let at = 0;
          for (const s of chain(start, mini.table)) {
              if (at >= length) break;
              out.set(mini.data.subarray(s * mss, s * mss + Math.min(mss, length - at)), at);
              at += mss;
          }
          return { size: length, bytes: async (from, to) => out.subarray(from, Math.min(to, length)) };
      };

      return {
          find: (name) => entries.find((e) => e.type === 2 && e.name.toLowerCase() === name.toLowerCase()),
          stream: async (e) => (e.size < cutoff ? smallStream(e.start, e.size) : bigStream(e.start, e.size)),
      };
  }

  // Module: readers/sheets/xls.ts

  // Excel 97-2003 (.xls): BIFF8 / BIFF5 records in a compound file

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Code pages of BIFF5 texts (BIFF8 texts are Unicode)
  const CODEPAGES = {
      367: 'windows-1252',
      932: 'shift_jis',
      936: 'gbk',
      949: 'euc-kr',
      950: 'big5',
      10000: 'macintosh',
      32768: 'macintosh',
      32769: 'windows-1252',
  };

  const BIFF_BOF = new Set([0x0009, 0x0209, 0x0409, 0x0809]);
  const XLS_KINDS = { 0: 'sheet', 1: 'sheet', 2: 'chart', 6: 'module' }; // macro sheets have cells too

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function codepageDecoder(cp) {
      try {
          return new TextDecoder(CODEPAGES[cp] || `windows-${cp}`);
      } catch {
          return new TextDecoder('windows-1252');
      }
  }

  // BIFF8 XLUnicodeString: count (2 bytes, or 1 for short ones), flags, [runs, extension sizes], characters
  function biffString(d, at, short = false) {
      const n = short ? d[at] : d[at] | (d[at + 1] << 8);
      let p = at + (short ? 1 : 2);
      const flags = d[p++];
      if (flags & 8) p += 2;
      if (flags & 4) p += 4;
      return flags & 1 ? utf16le.decode(d.subarray(p, p + 2 * n)) : latin1(d.subarray(p, p + n));
  }

  // Shared strings: SST record and its CONTINUE records; text crossing them gets a new flag byte
  function biffStrings(parts) {
      const out = [];
      let k = 0;
      let d = parts[0];
      let p = 8; // after total and unique counts
      const next = () => {
          while (p >= d.length && k < parts.length - 1) {
              d = parts[++k];
              p = 0;
          }
          return p < d.length;
      };
      const u8 = () => (next() ? d[p++] : 0);
      const u16 = () => u8() | (u8() << 8);
      const skip = (n) => {
          while (n > 0 && next()) {
              const step = Math.min(n, d.length - p);
              p += step;
              n -= step;
          }
      };
      while (next()) {
          let n = u16();
          let flags = u8();
          const runs = flags & 8 ? u16() : 0;
          const ext = flags & 4 ? u16() + u16() * 65536 : 0;
          let s = '';
          while (n > 0) {
              if (p >= d.length) {
                  if (k >= parts.length - 1) break;
                  d = parts[++k];
                  p = 0;
                  flags = d[p++]; // text goes on in next record: 1 or 2 bytes per character from here
              }
              const wide = flags & 1 ? 2 : 1;
              const take = Math.min(n, Math.floor((d.length - p) / wide));
              if (take <= 0) {
                  p = d.length;
                  continue;
              }
              const bytes = d.subarray(p, p + take * wide);
              s += wide === 2 ? utf16le.decode(bytes) : latin1(bytes);
              p += bytes.length;
              n -= take;
          }
          skip(runs * 4 + ext);
          out.push(s);
      }
      return out;
  }

  async function readXls(read, size) {
      const cfb = await compoundFile(read, size);
      if (cfb.find('EncryptedPackage')) throw new Error('the file is password-protected');
      const entry = cfb.find('Workbook') || cfb.find('Book');
      if (!entry) throw new Error('no workbook inside (not an Excel file?)');
      const stream = await cfb.stream(entry);

      // Records from `from` to the end of their substream (BOF … EOF); nested ones (charts) skipped
      const records = async (from, to, on) => {
          let buf = await stream.bytes(from, Math.min(to, from + 65536));
          const grow = async (need) => {
              if (need > buf.length && from + buf.length < to) {
                  buf = await stream.bytes(from, Math.min(to, from + Math.max(need, 2 * buf.length)));
              }
          };
          let depth = 0;
          for (let p = 0; ; ) {
              await grow(p + 4);
              if (p + 4 > buf.length) return;
              const type = buf[p] | (buf[p + 1] << 8);
              const len = buf[p + 2] | (buf[p + 3] << 8);
              if (p + 4 + len > buf.length) await grow(p + 4 + len);
              const data = buf.subarray(p + 4, p + 4 + len);
              p += 4 + len;
              if (BIFF_BOF.has(type)) depth++;
              if (depth <= 1) on(type, data);
              if (type === 0x000a && --depth <= 0) return; // EOF
          }
      };

      // Workbook globals: sheets, formats, cell styles, shared strings, date system
      let biff8 = true;
      let text8 = new TextDecoder('windows-1252');
      const sheets = [];
      const codes = new Map();
      const xfs = [];
      let sst = null;
      let last = 0;
      let date1904 = false;
      let active = -1;
      await records(0, stream.size, (type, d) => {
          if (type === 0x003c && sst && last === 0x00fc) return void sst.push(d); // CONTINUE of SST
          last = type;
          if (d.length < 2) return;
          const dv = dataView(d);
          if (type === 0x0809) biff8 = dv.getUint16(0, true) >= 0x0600;
          else if (type === 0x002f)
              throw new Error('the file is password-protected'); // FILEPASS
          else if (type === 0x0042) text8 = codepageDecoder(dv.getUint16(0, true));
          else if (type === 0x0022) date1904 = dv.getUint16(0, true) === 1;
          else if (type === 0x003d && active < 0 && d.length >= 12)
              active = dv.getUint16(10, true); // WINDOW1
          else if (type === 0x0085 && d.length >= 7) {
              // BOUNDSHEET: position of its BOF in stream, visibility, type, name
              sheets.push({
                  pos: dv.getUint32(0, true),
                  size: 0, // set below, from the next sheet's position
                  hidden: (d[4] & 3) !== 0,
                  kind: XLS_KINDS[d[5]] || 'module',
                  name: biff8 ? biffString(d, 6, true) : text8.decode(d.subarray(7, 7 + d[6])),
              });
          } else if (type === 0x041e && d.length >= 3) {
              codes.set(dv.getUint16(0, true), biff8 ? biffString(d, 2) : text8.decode(d.subarray(3, 3 + d[2])));
          } else if (type === 0x00e0 && d.length >= 4) xfs.push(dv.getUint16(2, true));
          else if (type === 0x00fc) sst = [d];
      });
      const strings = sst ? biffStrings(sst) : [];
      const kinds = xfs.map((id) => formatKind(codes.get(id) ?? BUILTIN_FORMATS[id] ?? ''));

      // Each sheet: from its BOF up to the next sheet's (or end of stream)
      const starts = [...sheets.map((s) => s.pos), stream.size].sort((a, b) => a - b);
      for (const s of sheets) s.size = Math.max(0, (starts.find((x) => x > s.pos) ?? s.pos) - s.pos);

      const load = async (i) => {
          const s = sheets[i];
          if (s.kind !== 'sheet' || s.pos >= stream.size) return null;
          const grid = sheetGrid();
          const num = (xf, n) => numberText(n, kinds[xf] || '', date1904);
          const label = (d, at) =>
              biff8 ? biffString(d, at) : text8.decode(d.subarray(at + 2, at + 2 + (d[at] | (d[at + 1] << 8))));
          let pending = null; // formula with text result: text follows in STRING record
          await records(s.pos, s.pos + s.size, (type, d) => {
              if (type === 0x0207 && pending) {
                  grid.set(pending[0], pending[1], label(d, 0));
                  pending = null;
                  return;
              }
              if (d.length < 6) return;
              const dv = dataView(d);
              const r = dv.getUint16(0, true);
              const c = dv.getUint16(2, true);
              const xf = dv.getUint16(4, true);
              if (type === 0x0203 && d.length >= 14)
                  grid.set(r, c, num(xf, dv.getFloat64(6, true))); // NUMBER
              else if (type === 0x027e && d.length >= 10)
                  grid.set(r, c, num(xf, rkNumber(dv.getUint32(6, true)))); // RK
              else if (type === 0x00bd) {
                  // MULRK: (style, RK) per column from c on
                  for (let k = 0, at = 4; at + 6 <= d.length - 2; k++, at += 6) {
                      grid.set(r, c + k, num(dv.getUint16(at, true), rkNumber(dv.getUint32(at + 2, true))));
                  }
              } else if (type === 0x00fd && d.length >= 10)
                  grid.set(r, c, strings[dv.getUint32(6, true)] ?? ''); // LABELSST
              else if (type === 0x0204 || type === 0x00d6)
                  grid.set(r, c, label(d, 6)); // LABEL, RSTRING
              else if (type === 0x0205 && d.length >= 8) {
                  grid.set(r, c, d[7] ? (SHEET_ERRORS[d[6]] ?? '#ERROR') : d[6] ? 'TRUE' : 'FALSE'); // BOOLERR
              } else if (type === 0x0006 && d.length >= 14) {
                  // FORMULA: last result; 0xFFFF at end marks text, boolean, error or empty text
                  if (dv.getUint16(12, true) !== 0xffff) grid.set(r, c, num(xf, dv.getFloat64(6, true)));
                  else if (d[6] === 0) pending = [r, c];
                  else if (d[6] === 1) grid.set(r, c, d[8] ? 'TRUE' : 'FALSE');
                  else if (d[6] === 2) grid.set(r, c, SHEET_ERRORS[d[8]] ?? '#ERROR');
              }
          });
          return grid.done();
      };

      return {
          format: biff8 ? 'Excel 97–2003 (XLS)' : 'Excel 5.0/95 (XLS)',
          sheets: sheets.map(({ pos, ...s }) => s),
          active: Math.max(0, active),
          date1904,
          load,
      };
  }

  // Module: readers/sheets/index.ts

  // Workbook of any of these formats, by its signature

  // ===========================================================================
  // METHODS
  // ===========================================================================

  async function readBook(read, size, head) {
      if (head[0] === 0xd0 && head[1] === 0xcf) return readXls(read, size);
      if (head[0] !== 0x50 || head[1] !== 0x4b) {
          throw new Error(head[0] === 0x09 ? 'Excel 2.x–4.x files are not supported' : 'not a spreadsheet file');
      }
      const pkg = await zipPackage(read, size);
      return pkg.entry('content.xml') && !pkg.entry('[Content_Types].xml') ? readOds(pkg) : readOoxml(pkg);
  }

  // Spreadsheet source like openSource(): text = sheet or table shown, as CSV; more() = next sheet not cached.
  // Sheets are the unit cached; a table is shown once its sheet is.
  // Large files (over SHEET_AUTOLOAD_BYTES) cache no sheet until one (or a table) is chosen.
  /**
   * @param mode start view (sheets if there are no tables)
   * @param autoload largest file whose first sheet or table is shown at once
   */
  async function openSheetSource(
      url,
      getSignal,
      reload,
      onProgress,
      mode = 'sheets',
      autoload = SHEET_AUTOLOAD_BYTES,
  ) {
      const file = await openRanges(url, getSignal, reload, onProgress);
      if ('error' in file) return file;
      let book;
      try {
          book = await readBook(file.read, file.size, file.head);
      } catch (err) {
          if ((err).name === 'AbortError') throw err;
          return { error: `Not shown: ${(err).message}` };
      }
      const { sheets } = book;
      // tables in reading order: by sheet, then top to bottom, left to right
      const tables = [...(book.tables || [])].sort(
          (a, b) => a.sheet - b.sheet || a.range.r0 - b.range.r0 || a.range.c0 - b.range.c0,
      );
      if (!sheets.length) return { error: 'Not shown: no sheets in this workbook' };
      const cached = () => sheets.filter((s) => s.data !== undefined).length;

      // Sheet read once: data = { rows, cols } or null (no cells: chart, module, unreadable)
      const loadSheet = async (i) => {
          const s = sheets[i];
          if (s.data === undefined) {
              try {
                  s.data = await book.load(i);
                  if (!s.data) s.note = s.kind === 'chart' ? 'Chart sheet: no cells to show.' : 'No cells to show.';
              } catch (err) {
                  if ((err).name === 'AbortError') throw err;
                  s.data = null;
                  s.note = `This sheet could not be read: ${(err).message}`;
              }
          }
          // all content shown is here once every sheet is: then the whole file counts as cached
          src.done = cached() === sheets.length;
          src.loaded = src.done ? file.size : Math.min(file.fetched(), file.size - 1);
      };

      // First sheet: active when saved (else first visible worksheet)
      const usable = (i) => sheets[i] && sheets[i].kind === 'sheet' && !sheets[i].hidden;
      const firstSheet = usable(book.active)
          ? book.active
          : Math.max(
                0,
                sheets.findIndex((_, i) => usable(i)),
            );
      // Entry a view starts with: the sheet shown, or the first table on it (else the first table)
      const startOf = (m) => {
          const at = src.sheetOf(src.current);
          return m === 'sheets'
              ? at
              : Math.max(
                    0,
                    tables.findIndex((t) => t.sheet === at),
                );
      };

      const src = {
          total: file.size,
          loaded: 0,
          done: false,
          isSheet: true,
          wholeLines: true,
          dates: file.dates,
          format: book.format,
          sheets,
          tables,
          tablesRead: !!book.tables, // false: format without tables read (.xls)
          mode: 'sheets',
          current: firstSheet,
          waiting: false, // nothing shown yet: a sheet or table is to be chosen first
          shown: { rows: [], header: [], note: '', text: '' },
          text: '',
          label: () => `${cached().toLocaleString()} of ${sheets.length.toLocaleString()} sheets cached`,
          nextLabel: 'Cache next sheet',
          get info() {
              const { rows, header } = src.shown;
              const hidden = sheets.filter((x) => x.hidden).length;
              const shape = rows.length ? `: ${rows.length.toLocaleString()} rows × ${header.length} columns` : '';
              const hiddenNote = hidden ? ` (${hidden} hidden)` : '';
              const info = [['sheets', `${sheets.length}${hiddenNote}`]];
              if (book.tables) info.push(['tables', tables.length.toLocaleString()]);
              if (src.waiting) info.push(['shown', 'none yet (select a sheet or table)']);
              else if (src.mode === 'tables') {
                  const t = tables[src.current];
                  info.push(['table', `${t.name} (${sheets[t.sheet].name}!${rangeText(t.range)})${shape}`]);
              } else {
                  const s = sheets[src.current];
                  const cutNote = s.data?.cut ? ` (first ${MAX_SHEET_CELLS.toLocaleString()} cells)` : '';
                  info.push(['sheet', `${s.name}${shape}${cutNote}`]);
              }
              if (book.date1904) info.push(['dates', '1904 system']);
              return info;
          },
          loadSheet,
          startOf,
          // Sheet behind entry i of a view (its table's sheet for tables)
          sheetOf: (i, m = src.mode) => (m === 'tables' ? tables[i].sheet : i),
          // Shows entry i of a view (its sheet cached before)
          select: (i, m = src.mode) => {
              src.waiting = false;
              src.mode = m === 'tables' && tables[i] ? 'tables' : 'sheets';
              src.current = i;
              src.shown = src.mode === 'tables' ? tableShown(tables[i], sheets[tables[i].sheet]) : sheetShown(sheets[i]);
              src.text = src.shown.text;
          },
          more: async () => {
              const at = src.sheetOf(src.current);
              if (src.waiting) {
                  await loadSheet(at); // the entry proposed first
                  return src.select(src.current);
              }
              for (let k = 1; k <= sheets.length; k++) {
                  const i = (at + k) % sheets.length;
                  if (sheets[i].data === undefined) return loadSheet(i);
              }
          },
          loadAll: async () => {
              for (let i = 0; i < sheets.length; i++) await loadSheet(i);
              if (src.waiting) src.select(src.current);
          },
      };

      const start = mode === 'tables' && tables.length ? 'tables' : 'sheets';
      const first = startOf(start);
      if (file.size > autoload) {
          src.mode = start;
          src.current = first;
          src.waiting = true;
          src.loaded = Math.min(file.fetched(), file.size - 1);
          const size = formatBytes(file.size);
          const note = `Large spreadsheet (${size}): select a sheet or table first (picker bottom right).`;
          src.shown = { rows: [], header: [], note, text: '' };
          return src;
      }
      await loadSheet(src.sheetOf(first, start));
      src.select(first, start);
      return src;
  }

  // Sheet shown: rows as they are, columns A, B, …; its text with column letters and row numbers (as in Excel)
  function sheetShown(s) {
      const d = s.data;
      if (!d?.rows.length) return { rows: [], header: [], note: s.note || 'Empty sheet: no cells.', text: '' };
      const header = Array.from({ length: d.cols }, (_, c) => colName(c));
      return { rows: d.rows, header, note: '', text: csvRows([header].concat(d.rows), d.cols, true) };
  }

  // Table shown: its rows below the header row, without totals rows; column names as header
  function tableShown(t, s) {
      const d = s.data;
      if (!d) return { rows: [], header: [], note: s.note || 'No cells to show.', text: '' };
      const { r0, c0 } = t.range;
      // not beyond the sheet's cells (against damaged or hostile ranges)
      const c1 = Math.min(t.range.c1, Math.max(d.cols, c0 + t.columns.length) - 1);
      const r1 = Math.min(t.range.r1 - t.totals, d.rows.length - 1);
      const width = Math.max(0, c1 - c0 + 1);
      const cells = (r) => Array.from({ length: width }, (_, k) => d.rows[r]?.[c0 + k] ?? '');
      const names = t.header ? cells(r0) : [];
      const header = Array.from({ length: width }, (_, k) => t.columns[k] || names[k] || colName(c0 + k));
      const rows = [];
      for (let r = r0 + t.header; r <= r1; r++) rows.push(cells(r));
      const note = rows.length ? '' : 'Empty table: no rows below its header.';
      return { rows, header, note, text: rows.length ? csvRows([header].concat(rows), width) : '' };
  }

  // Rows as CSV, padded to all columns; numbered: row numbers first (none for the header row)
  function csvRows(rows, cols, numbered = false) {
      const out = new Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          let line = numbered && i ? String(i) : '';
          for (let c = 0; c < cols; c++) line += (c || numbered ? ',' : '') + csvCell(r[c] ?? '');
          out[i] = line;
      }
      return out.join('\n');
  }

  // Module: text/highlight/tokenise.ts

  // Highlighters: text -> [[cssClass, text], ...]

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function tokenise(
      text,
      re,
      onMatch,
      onGap = (s, out) => out.push(['', s]),
  ) {
      const out = [];
      let last = 0;
      for (const m of text.matchAll(re)) {
          if (!m[0]) continue;
          if (m.index > last) onGap(text.slice(last, m.index), out);
          onMatch(m, out);
          last = m.index + m[0].length;
      }
      if (last < text.length) onGap(text.slice(last), out);
      return out;
  }

  // Module: text/highlight/ifc.ts

  // IFC (STEP) highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const IFC_RE = new RegExp(
      [
          /(\/\*[\s\S]*?\*\/)/.source, // 1 comment
          /('(?:[^']|'')*')/.source, // 2 string
          /(#\d+)/.source, // 3 instance reference
          /(\.[A-Z_][A-Z0-9_]*\.)/.source, // 4 enum / boolean
          /(END-ISO-10303-21|ISO-10303-21|\bHEADER\b|\bDATA\b|\bENDSEC\b)/.source, // 5 keyword
          /\b([A-Z][A-Z0-9_]*)(?=\s*\()/.source, // 6 entity type
          /(-?\b\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?)/.source, // 7 number
          /([$*])/.source, // 8 unset / derived
          /([()=,;])/.source, // 9 punctuation
      ].join('|'),
      'gi',
  );

  const IFC_CLASSES = ['', 'com', 'str', 'ref', 'enum', 'kw', 'type', 'num', 'lit', 'punct'];

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const highlightIfc = (text) =>
      tokenise(text, IFC_RE, (m, out) => {
          const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
          out.push([IFC_CLASSES[i], m[0]]);
      });

  // Module: text/highlight/js.ts

  // JavaScript highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // JavaScript
  const JS_KEYWORDS =
      'async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|' +
      'extends|finally|for|from|function|get|if|import|in|instanceof|let|new|of|return|set|static|' +
      'super|switch|this|throw|try|typeof|var|void|while|with|yield';
  const JS_RE = new RegExp(
      [
          /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.source, // 1 comment
          /(`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/.source, // 2 string / template
          // 3 regex literal (only where value may start, so "a / b" stays division)
          /((?<=(?:^|[=(,:;!&|?{}[+\-*%<>~^])\s*|\b(?:return|typeof|case|do|else|in|of|void|yield|await)\s+)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*)/
              .source,
          `\\b(${JS_KEYWORDS})\\b`, // 4 keyword
          /\b(true|false|null|undefined|NaN|Infinity)\b/.source, // 5 literal
          /\b(0[xX][\da-fA-F_]+n?|0[oO][0-7_]+n?|0[bB][01_]+n?|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?)\b/.source, // 6 number
          /\b([A-Z][\w$]*)\b/.source, // 7 class / constructor name
          /([A-Za-z_$][\w$]*)(?=\s*\()/.source, // 8 function call
          /(=>|[{}()[\];,.?:]|[-+*/%=&|^!<>~]+)/.source, // 9 operator / punctuation
      ].join('|'),
      'gm',
  );

  const JS_CLASSES = ['', 'com', 'str', 'meta', 'kw', 'lit', 'num', 'type', 'enum', 'punct'];

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const highlightJs = (text) =>
      tokenise(text, JS_RE, (m, out) => {
          const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
          out.push([JS_CLASSES[i], m[0]]);
      });

  // Module: text/highlight/json.ts

  // JSON highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const JSON_RE =
      /("(?:\\.|[^"\\\n])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b|([{}[\],:])/g;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const highlightJson = (text) =>
      tokenise(text, JSON_RE, (m, out) => {
          if (m[1] && m[2]) out.push(['key', m[1]], ['punct', m[2]]);
          else if (m[1]) out.push(['str', m[1]]);
          else if (m[3]) out.push(['num', m[3]]);
          else if (m[4]) out.push(['lit', m[4]]);
          else out.push(['punct', m[5]]);
      });

  // Module: text/highlight/log.ts

  // Log files: levels (error red, warning yellow, info blue, debug grey), dates, exceptions, stack frames

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const LOG_LEVELS = {
      'lv-err': [
          'FATAL',
          'CRITICAL',
          'CRIT',
          'ERROR',
          'ERR',
          'SEVERE',
          'EMERGENCY',
          'EMERG',
          'ALERT',
          'FAILED',
          'FAILURE',
          'FAIL',
      ],
      'lv-warn': ['WARNING', 'WARN', 'DEPRECATED'],
      'lv-info': ['INFORMATION', 'INFO', 'NOTICE'],
      'lv-debug': ['DEBUG', 'TRACE', 'VERBOSE'],
  };
  const LOG_LEVEL_CLASSES = Object.keys(LOG_LEVELS);

  const LOG_RE = new RegExp(
      [
          /(^[ \t]+(?:at [^\n]*|File "[^\n]*))/.source, // 1 stack frame (Java, .NET, JS, Python)
          /("(?:\\.|[^"\\\n])*"|(?<!\w)'(?:\\.|[^'\\\n])*'(?!\w))/.source, // 2 string
          [
              /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/.source, // ISO 8601
              /\d{1,2}[./]\d{1,2}[./]\d{2,4}(?: \d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)?/.source, // 24.10.2026, 10/24/2026
              /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2}(?: \d{2}:\d{2}:\d{2})?/.source, // syslog
              /\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/.source, // time
          ]
              .map((x) => `\\b${x}\\b`)
              .join('|')
              .replace(/^/, '(')
              .concat(')'), // 3 date / time
          /\b([A-Za-z_$][\w.$]*(?:Exception|Error))\b/.source, // 4 exception
          ...LOG_LEVEL_CLASSES.map((cls) => {
              const words = LOG_LEVELS[cls];
              const forms = words.flatMap((w) => [w, w[0] + w.slice(1).toLowerCase(), w.toLowerCase()]);
              return `\\b(${forms.join('|')})\\b`;
          }), // 5-8 levels
          /\b([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\b/.source, // 9 GUID
          /\b((?:https?|ftp|file):\/\/[^\s"'<>]+)/.source, // 10 URL
          /\b([A-Za-z_][\w.-]*)(?==)/.source, // 11 key of key=value
          /\b(true|false|null|None|undefined|NaN)\b/.source, // 12 literal
          /\b(0x[0-9A-Fa-f]+|\d+(?:\.\d+)?)\b/.source, // 13 number
      ].join('|'),
      'gm',
  );

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const highlightLog = (text) =>
      tokenise(text, LOG_RE, (m, out) => {
          if (m[1]) out.push(['log-frame', m[1]]);
          else if (m[2]) out.push(['str', m[2]]);
          else if (m[3]) out.push(['log-date', m[3]]);
          else if (m[4]) out.push(['lv-err', m[4]]);
          else if (m[5]) out.push(['lv-err', m[5]]);
          else if (m[6]) out.push(['lv-warn', m[6]]);
          else if (m[7]) out.push(['lv-info', m[7]]);
          else if (m[8]) out.push(['lv-debug', m[8]]);
          else if (m[9] || m[13]) out.push(['num', m[0]]);
          else if (m[10]) out.push(['log-url', m[10]]);
          else if (m[11]) out.push(['key', m[11]]);
          else out.push(['lit', m[12]]);
      });

  // Module: text/highlight/m.ts

  // Power Query M highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Power Query M
  const M_KEYWORDS = 'let|in|each|if|then|else|try|otherwise|catch|error|and|or|not|as|is|meta|section|shared|type';
  const M_TYPES =
      'any|anynonnull|binary|date|datetime|datetimezone|duration|function|list|logical|none|null|' +
      'number|record|table|text|time|nullable|optional';
  const M_RE = new RegExp(
      [
          /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.source, // 1 comment
          /(#"(?:[^"]|"")*")/.source, // 2 quoted identifier
          /("(?:[^"]|"")*")/.source, // 3 string
          /(#(?:date|datetime|datetimezone|duration|time|table|binary|infinity|nan|sections|shared)\b)/.source, // 4 intrinsic
          `\\b(${M_KEYWORDS})\\b`, // 5 keyword
          /\b(true|false|null)\b/.source, // 6 literal
          `\\b(${M_TYPES})\\b(?!\\s*\\.)`, // 7 type
          /\b([A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\b/.source, // 8 library name (Table.AddColumn, Int64.Type)
          /\b(0x[0-9A-Fa-f]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/.source, // 9 number
          /(=>|<>|<=|>=|\.\.\.|\.\.|[=<>+\-*/&?@!]|[()[\]{},;])/.source, // 10 operator / punctuation
      ].join('|'),
      'g',
  );

  const M_CLASSES = ['', 'com', 'key', 'str', 'meta', 'kw', 'lit', 'type', 'enum', 'num', 'punct'];

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const highlightM = (text) =>
      tokenise(text, M_RE, (m, out) => {
          const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
          out.push([M_CLASSES[i], m[0]]);
      });

  // Module: text/highlight/md.ts

  // Markdown highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Markdown (line by line; fenced code blocks are kept as plain string content)
  const MD_INLINE_RE = new RegExp(
      [
          /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.source, // 1-2 `code`
          String.raw`(\*\*|__)(?=\S)([\s\S]*?\S)\3`, // 3-4 **bold** (\3: group of the joined pattern)
          String.raw`(\*|_)(?=\S)([\s\S]*?\S)\5(?![\w*])`, // 5-6 *emphasis*
          /(!?\[)([^\]\n]*)(\]\()([^)\s]*)((?:\s+"[^"]*")?\))/.source, // 7-11 [text](url) / ![alt](url)
          /(<(?:https?:\/\/|mailto:)[^>\s]+>|\bhttps?:\/\/[^\s<>()]+)/.source, // 12 link
          /(<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>)/.source, // 13 HTML tag
      ].join('|'),
      'g',
  );

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function mdInline(text, out) {
      out.push(
          ...tokenise(text, MD_INLINE_RE, (m, o) => {
              if (m[1]) o.push(['str', m[0]]);
              else if (m[3]) o.push(['type', m[0]]);
              else if (m[5]) o.push(['enum', m[0]]);
              else if (m[7]) o.push(['punct', m[7]], ['key', m[8]], ['punct', m[9]], ['aval', m[10]], ['punct', m[11]]);
              else if (m[12]) o.push(['aval', m[12]]);
              else o.push(['tag', m[13]]);
          }),
      );
  }

  function highlightMd(text) {
      const out = [];
      let fence = null; // end marker of open ``` / ~~~ block
      text.split('\n').forEach((line, i) => {
          if (i) out.push(['', '\n']);
          if (fence) {
              if (line.trim().startsWith(fence)) {
                  out.push(['meta', line]);
                  fence = null;
              } else {
                  out.push(['str', line]);
              }
              return;
          }
          const open = line.match(/^\s*(`{3,}|~{3,})/);
          if (open) {
              fence = open[1];
              out.push(['meta', line]);
              return;
          }
          if (/^\s{0,3}#{1,6}(\s|$)/.test(line) || (/^\s{0,3}(=+|-+)\s*$/.test(line) && i > 0)) {
              out.push(['kw', line]); // heading or setext underline
              return;
          }
          if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
              out.push(['punct', line]); // horizontal rule
              return;
          }
          const lead = line.match(/^(\s*(?:>\s?)*)((?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/); // all parts optional: always matches
          if (lead[1]) out.push(['punct', lead[1]]);
          if (lead[2]) out.push(['punct', lead[2]]);
          const rest = line.slice(lead[0].length);
          if (/^\s*\|/.test(rest) || /\|\s*$/.test(rest)) {
              // table row: pipes as punctuation
              for (const part of rest.split(/(\|)/)) {
                  if (part === '|') out.push(['punct', part]);
                  else mdInline(part, out);
              }
          } else {
              mdInline(rest, out);
          }
      });
      return out;
  }

  // Module: text/highlight/py.ts

  // Python highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Python
  const PY_KEYWORDS =
      'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|' +
      'global|if|import|in|is|lambda|match|case|nonlocal|not|or|pass|raise|return|try|while|with|yield';
  const PY_RE = new RegExp(
      [
          /(#[^\n]*)/.source, // 1 comment
          // 2 string: prefixes (r, b, f, ...), triple quoted (multi-line) or single line
          /((?:\b[rRbBuUfF]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))/.source,
          /(@[\w.]+)/.source, // 3 decorator
          `\\b(${PY_KEYWORDS})\\b`, // 4 keyword
          /\b(True|False|None|self|cls)\b/.source, // 5 literal
          /\b(0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?j?)\b/.source, // 6 number
          /\b([A-Z]\w*)\b/.source, // 7 class name
          /([A-Za-z_]\w*)(?=\s*\()/.source, // 8 function call
          /([{}()[\];,.:]|[-+*/%=&|^!<>~@]+)/.source, // 9 operator / punctuation
      ].join('|'),
      'gm',
  );
  const PY_CLASSES = ['', 'com', 'str', 'meta', 'kw', 'lit', 'num', 'type', 'enum', 'punct'];

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const highlightPy = (text) =>
      tokenise(text, PY_RE, (m, out) => {
          const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
          out.push([PY_CLASSES[i], m[0]]);
      });

  // Module: text/highlight/rst.ts

  // reStructuredText highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // reStructuredText (line by line; literal blocks after "::" are kept as plain string content)
  const RST_INLINE_RE = new RegExp(
      [
          /(``[\s\S]+?``)/.source, // 1 ``literal``
          /(:[\w.+-]+:)(`[^`]+`)/.source, // 2-3 :role:`text`
          /(`[^`]+`__?)/.source, // 4 `link <url>`_ / `reference`_
          /(\*\*(?=\S)[\s\S]*?\S\*\*)/.source, // 5 **strong**
          /(\*(?=\S)[^*]*?\S\*)/.source, // 6 *emphasis*
          /(\|[^|\s][^|]*\|_{0,2})/.source, // 7 |substitution|
          /(\[[#*\w.-]+\]_)/.source, // 8 [footnote]_
          /(\bhttps?:\/\/[^\s<>`]+)/.source, // 9 link
      ].join('|'),
      'g',
  );

  const RST_ADORNMENT_RE = /^([=\-`:'"~^_*+#<>.])\1{2,}\s*$/;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function rstInline(text, out) {
      out.push(
          ...tokenise(text, RST_INLINE_RE, (m, o) => {
              if (m[1]) o.push(['str', m[1]]);
              else if (m[2]) o.push(['meta', m[2]], ['str', m[3]]);
              else if (m[4]) o.push(['aval', m[4]]);
              else if (m[5]) o.push(['type', m[5]]);
              else if (m[6]) o.push(['enum', m[6]]);
              else if (m[7]) o.push(['anchor', m[7]]);
              else if (m[8]) o.push(['anchor', m[8]]);
              else o.push(['aval', m[9]]);
          }),
      );
  }

  function highlightRst(text) {
      const out = [];
      const lines = text.split('\n');
      let literal = null; // indent of paragraph that ended in "::"
      let literalStarted = false;
      lines.forEach((line, i) => {
          if (i) out.push(['', '\n']);
          const indent = line.match(/^\s*/)?.[0].length ?? 0;

          if (literal !== null) {
              if (!line.trim()) {
                  out.push(['', line]);
                  return;
              }
              if (indent > literal) {
                  literalStarted = true;
                  out.push(['str', line]);
                  return;
              }
              if (literalStarted || indent <= literal) literal = null;
          }

          const next = lines[i + 1] || '';
          if (RST_ADORNMENT_RE.test(line)) {
              out.push(['kw', line]); // section over-/underline
              return;
          }
          if (line.trim() && RST_ADORNMENT_RE.test(next) && next.trim().length >= line.trim().length) {
              out.push(['kw', line]); // section title
              return;
          }

          const directive = line.match(/^(\s*\.\.\s+)((?:\|[^|]+\|\s+)?[\w:.-]+::)(.*)$/);
          if (directive) {
              out.push(['meta', directive[1] + directive[2]]);
              rstInline(directive[3], out);
              // Indented body of code directive is code: show it as plain string content
              literal = /^(code|code-block|sourcecode|highlight)::/.test(directive[2]) ? indent : null;
              literalStarted = false;
              return;
          }
          const target = line.match(/^(\s*\.\.\s+)(_[^:]+:|\[[^\]]+\])(.*)$/);
          if (target) {
              out.push(['meta', target[1]], ['anchor', target[2]], ['aval', target[3]]);
              return;
          }
          if (/^\s*\.\.(\s|$)/.test(line)) {
              out.push(['com', line]); // comment
              return;
          }

          const lead = line.match(
              /^(\s*)((?:[-*+•]|\d+[.)]|#\.|\(?[a-zA-Z0-9]\))\s+)?(:[^:\s][^:]*:(?=\s|$))?/,
          ); // all parts optional: always matches
          if (lead[1]) out.push(['', lead[1]]);
          if (lead[2]) out.push(['punct', lead[2]]);
          if (lead[3]) out.push(['key', lead[3]]);
          rstInline(line.slice(lead[0].length), out);

          if (/::\s*$/.test(line)) {
              literal = indent;
              literalStarted = false;
          }
      });
      return out;
  }

  // Module: text/highlight/sql.ts

  // SQL highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // SQL (any dialect)
  const SQL_KEYWORDS = [
      'ADD',
      'ALL',
      'ALTER',
      'AND',
      'ANY',
      'AS',
      'ASC',
      'BEGIN',
      'BETWEEN',
      'BY',
      'CASCADE',
      'CASE',
      'CAST',
      'CHECK',
      'COLUMN',
      'COMMIT',
      'CONSTRAINT',
      'CREATE',
      'CROSS',
      'CURRENT',
      'DATABASE',
      'DECLARE',
      'DEFAULT',
      'DELETE',
      'DESC',
      'DISTINCT',
      'DROP',
      'ELSE',
      'END',
      'ESCAPE',
      'EXCEPT',
      'EXEC',
      'EXECUTE',
      'EXISTS',
      'FALSE',
      'FETCH',
      'FILTER',
      'FIRST',
      'FOR',
      'FOREIGN',
      'FROM',
      'FULL',
      'FUNCTION',
      'GRANT',
      'GROUP',
      'HAVING',
      'IF',
      'ILIKE',
      'IN',
      'INDEX',
      'INNER',
      'INSERT',
      'INTERSECT',
      'INTO',
      'IS',
      'JOIN',
      'KEY',
      'LAST',
      'LATERAL',
      'LEFT',
      'LIKE',
      'LIMIT',
      'MERGE',
      'NATURAL',
      'NOT',
      'NULL',
      'NULLS',
      'OFFSET',
      'ON',
      'OR',
      'ORDER',
      'OUTER',
      'OVER',
      'PARTITION',
      'PRIMARY',
      'PROCEDURE',
      'QUALIFY',
      'RECURSIVE',
      'REFERENCES',
      'REPLACE',
      'RETURN',
      'RETURNS',
      'REVOKE',
      'RIGHT',
      'ROLLBACK',
      'ROW',
      'ROWS',
      'SCHEMA',
      'SELECT',
      'SET',
      'TABLE',
      'TEMP',
      'TEMPORARY',
      'THEN',
      'TOP',
      'TRANSACTION',
      'TRIGGER',
      'TRUE',
      'TRUNCATE',
      'UNION',
      'UNIQUE',
      'UPDATE',
      'USE',
      'USING',
      'VALUES',
      'VIEW',
      'WHEN',
      'WHERE',
      'WINDOW',
      'WITH',
  ].join('|');
  const SQL_TYPES =
      'BIGINT|BINARY|BIT|BLOB|BOOLEAN|BOOL|CHAR|CLOB|DATE|DATETIME|DATETIME2|DECIMAL|DOUBLE|FLOAT|' +
      'INT|INTEGER|INTERVAL|JSON|JSONB|MONEY|NCHAR|NUMBER|NUMERIC|NVARCHAR|REAL|SERIAL|SMALLINT|' +
      'STRING|TEXT|TIME|TIMESTAMP|TIMESTAMPTZ|TINYINT|UUID|VARBINARY|VARCHAR|VARCHAR2|XML';
  const SQL_RE = new RegExp(
      [
          /(--[^\n]*|\/\*[\s\S]*?\*\/)/.source, // 1 comment
          /([NEeBbXx]?'(?:[^']|'')*'|\$\$[\s\S]*?\$\$)/.source, // 2 string (also N'..', $$..$$)
          /("(?:[^"]|"")*"|`[^`]*`|\[[^\]\n]*\])/.source, // 3 quoted name
          `\\b(${SQL_KEYWORDS})\\b`, // 4 keyword
          `\\b(${SQL_TYPES})\\b`, // 5 data type
          /([A-Za-z_][\w$]*)(?=\s*\()/.source, // 6 function
          /((?<![\w.])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.source, // 7 number
          /([@:$][A-Za-z_\d][\w$]*|\?)/.source, // 8 parameter / variable
          /(<>|<=|>=|!=|::|\|\||[-+*/%=<>~^&|!]|[(),;.])/.source, // 9 operator / punctuation
      ].join('|'),
      'gi',
  );

  const SQL_CLASSES = ['', 'com', 'str', 'key', 'kw', 'type', 'enum', 'num', 'anchor', 'punct'];

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const highlightSql = (text) =>
      tokenise(text, SQL_RE, (m, out) => {
          const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
          out.push([SQL_CLASSES[i], m[0]]);
      });

  // Module: text/highlight/toml.ts

  // TOML highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const TOML_BARE_OR_QUOTED = /(?:[A-Za-z0-9_-]+|"(?:\\.|[^"\\\n])*"|'[^'\n]*')/.source;
  const TOML_KEY = `${TOML_BARE_OR_QUOTED}(?:[ \\t]*\\.[ \\t]*${TOML_BARE_OR_QUOTED})*`;
  const TOML_RE = new RegExp(
      [
          /^([ \t]*)(\[\[?[^\]\n]*\]\]?)(?=[ \t]*(?:#|$))/.source, // 1 indent, 2 [table] / [[array of tables]]
          `(?:^|(?<=[{,]))([ \\t]*)(${TOML_KEY})([ \\t]*=)`, // 3 indent, 4 key, 5 "="
          /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'[^'\n]*')/.source, // 6 string
          /(#[^\n]*)/.source, // 7 comment
          /(\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)/
              .source, // 8 date/time
          /((?<![\w.-])[+-]?(?:0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|inf|nan|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?)(?![\w.-]))/
              .source, // 9 number
          /\b(true|false)\b/.source, // 10 boolean
          /([[\]{},])/.source, // 11 punctuation
      ].join('|'),
      'gm',
  );

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const highlightToml = (text) =>
      tokenise(text, TOML_RE, (m, out) => {
          if (m[2]) {
              if (m[1]) out.push(['', m[1]]);
              out.push(['type', m[2]]);
          } else if (m[4]) {
              if (m[3]) out.push(['', m[3]]);
              out.push(['key', m[4]], ['punct', m[5]]);
          } else if (m[6]) out.push(['str', m[6]]);
          else if (m[7]) out.push(['com', m[7]]);
          else if (m[8] || m[9]) out.push(['num', m[0]]);
          else if (m[10]) out.push(['lit', m[10]]);
          else out.push(['punct', m[11]]);
      });

  // Module: text/highlight/xlf.ts

  // Excel formulas (.xlf) highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const XLF_ERRORS = '#[\\p{L}\\p{N}_/]+[!?]?';
  const XLF_REF =
      "((?:'(?:[^']|'')+'|[\\p{L}_][\\p{L}\\p{N}_.]*)!)?" + // optional sheet: Tabelle1! or 'My sheet'!
      '(\\$?[A-Za-z]{1,3}\\$?\\d+(?::\\$?[A-Za-z]{1,3}\\$?\\d+)?' + // A1, $A$1, A1:B2
      '|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d+:\\$?\\d+' + // A:C, 1:3
      '|R(?:\\[-?\\d+\\]|\\d+)?C(?:\\[-?\\d+\\]|\\d+)?)'; // R1C1, R[-1]C[2]

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Excel formulas (.xlf), any UI language: functions by their "(", errors by "#".
  // Argument separator , or ; from text (with ; decimal separator is ,).
  function xlfSeparator(text) {
      let commas = 0;
      let semis = 0;
      let depth = 0;
      for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (c === '"') {
              i = text.indexOf('"', i + 1);
              while (i !== -1 && text[i + 1] === '"') i = text.indexOf('"', i + 2);
              if (i === -1) break;
          } else if (c === '/' && text[i + 1] === '/') {
              i = text.indexOf('\n', i);
              if (i === -1) break;
          } else if (c === '/' && text[i + 1] === '*') {
              i = text.indexOf('*/', i + 2);
              if (i === -1) break;
          } else if (c === '(' || c === '{') depth++;
          else if (c === ')' || c === '}') depth = Math.max(0, depth - 1);
          else if (depth && c === ',') commas++;
          else if (depth && c === ';') semis++;
      }
      return semis > commas ? ';' : ',';
  }

  function highlightXlf(text) {
      const decimal = xlfSeparator(text) === ';' ? ',' : '\\.';
      const re = new RegExp(
          [
              '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1 comment
              '("(?:[^"]|"")*")', // 2 text
              `(${XLF_ERRORS})`, // 3 error value
              '(^[ \\t]*[\\p{L}_][\\p{L}\\p{N}_.]*(?=[ \\t]*=(?!=)))', // 4 name definition (Name = ...)
              `(?<![\\p{L}\\p{N}_.$])${XLF_REF}(?![\\p{L}\\p{N}_(.!])`, // 5-6 cell reference
              '([\\p{L}_][\\p{L}\\p{N}_.]*)(?=\\s*\\()', // 7 function
              `((?<![\\p{L}\\p{N}_.])\\d+(?:${decimal}\\d+)?(?:[eE][+-]?\\d+)?%?)`, // 8 number
              '(<>|<=|>=|[-+*/^&=<>:@#%]|[,;(){}\\\\])', // 9 operator / separator
          ].join('|'),
          'gimu',
      );
      return tokenise(text, re, (m, out) => {
          if (m[1]) out.push(['com', m[1]]);
          else if (m[2]) out.push(['str', m[2]]);
          else if (m[3]) out.push(['attr', m[3]]);
          else if (m[4]) out.push(['key', m[4]]);
          else if (m[6]) {
              if (m[5]) out.push(['meta', m[5]]);
              out.push(['ref', m[6]]);
          } else if (m[7]) out.push(['type', m[7]]);
          else if (m[8]) out.push(['num', m[8]]);
          else out.push(['punct', m[9]]);
      });
  }

  // Module: text/highlight/xml.ts

  // XML highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const XML_RE = new RegExp(
      [
          /(<!--[\s\S]*?-->)/.source, // 1 comment
          /(<!\[CDATA\[[\s\S]*?\]\]>)/.source, // 2 CDATA
          /(<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>)/.source, // 3 declaration
          /(<\/?[A-Za-z_][\w:.-]*)/.source + // 4 tag start
              /((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)/.source + // 5 attributes
              /(\s*\/?>)/.source, // 6 tag end
          /(&[#\w]+;)/.source, // 7 entity
      ].join('|'),
      'g',
  );

  const XML_ATTR_RE = /([^\s=]+)(\s*=\s*)?("[^"]*"|'[^']*')?/g;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const highlightXml = (text) =>
      tokenise(text, XML_RE, (m, out) => {
          if (m[1]) out.push(['com', m[1]]);
          else if (m[2]) out.push(['meta', m[2]]);
          else if (m[3]) out.push(['meta', m[3]]);
          else if (m[4]) {
              out.push(['tag', m[4]]);
              if (m[5]) {
                  out.push(
                      ...tokenise(m[5], XML_ATTR_RE, (a, o) => {
                          o.push(['attr', a[1]]);
                          if (a[2]) o.push(['punct', a[2]]);
                          if (a[3]) o.push(['aval', a[3]]);
                      }),
                  );
              }
              out.push(['tag', m[6]]);
          } else out.push(['ent', m[7]]);
      });

  // Module: text/lint/core.ts

  // Linters: text -> { problems: [{ line, msg, severity }], info? }

  // ===========================================================================
  // METHODS
  // ===========================================================================

  /** @returns 1-based line */
  const lineAt = (text, index) => {
      let n = 1;
      for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) n++;
      return n;
  };

  // Collect problems (at most MAX_PROBLEMS)
  function collector()

  {
      const problems = [];
      const add = (line, msg, severity = 'error') => {
          if (problems.length < MAX_PROBLEMS) problems.push({ line, msg, severity });
      };
      return { problems, add };
  }

  // Module: text/lint/yaml.ts

  // YAML checks

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Remove "# comment" at end of line, if it is outside quotes
  function stripYamlComment(line) {
      let quote = null;
      for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (quote) {
              if (c === '\\' && quote === '"') i++;
              else if (c === quote) quote = null;
          } else if (c === '"' || c === "'") {
              quote = c;
          } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
              return line.slice(0, i);
          }
      }
      return line;
  }

  // Lightweight structural checks (no full YAML parser available without libraries)
  function lintYaml(text) {
      const { problems, add } = collector();
      const stack = [{ indent: -1, keys: new Set(), lastValue: false }];
      const top = () => stack[stack.length - 1];
      let blockIndent = null; // inside a | or > block scalar

      text.split(/\r?\n/).forEach((raw, idx) => {
          const n = idx + 1;
          const indent = raw.match(/^ */)?.[0].length ?? 0;

          if (blockIndent !== null) {
              if (!raw.trim() || indent > blockIndent) return;
              blockIndent = null;
          }
          if (/^ *\t/.test(raw)) add(n, 'Tab character used for indentation (YAML allows spaces only)');

          const line = stripYamlComment(raw).replace(/\s+$/, '');
          if (!line.trim()) return;
          if (/^(---|\.\.\.)(\s|$)/.test(line)) {
              stack.length = 1;
              stack[0].keys = new Set();
              stack[0].lastValue = false;
              return;
          }

          const lead = line.match(/^( *)((?:- +|-$)*)/); // all optional: always matches
          const rest = line.slice(lead[0].length);
          const col = lead[0].length;
          const key = rest.match(YAML_KEY_RE);

          if (!key) {
              if (lead[2] && /^[|>][-+0-9]*$/.test(rest.trim())) blockIndent = lead[1].length;
              return;
          }

          if (lead[2]) {
              // "- key: value": new mapping in list item
              while (stack.length > 1 && top().indent >= col) stack.pop();
              stack.push({ indent: col, keys: new Set(), lastValue: false });
          } else {
              while (stack.length > 1 && top().indent > col) stack.pop();
              if (top().indent < col) {
                  if (top().lastValue && top().indent >= 0) {
                      add(n, 'Unexpected indentation: the key above already has a value on its own line');
                  }
                  stack.push({ indent: col, keys: new Set(), lastValue: false });
              }
          }

          const name = key[1].replace(/^(["'])([\s\S]*)\1$/, '$2');
          const t = top();
          if (t.keys.has(name)) add(n, `Duplicate key "${name}"`);
          t.keys.add(name);

          const value = rest.slice(key[0].length).trim();
          const valueNoProps = value.replace(/^(?:[&!][^\s]*\s*)+/, '');
          if (/^[|>][-+0-9]*$/.test(valueNoProps)) {
              blockIndent = col;
              t.lastValue = true;
          } else {
              t.lastValue = valueNoProps !== '';
          }
          if (/^"/.test(valueNoProps) && !/^"(?:\\.|[^"\\])*"/.test(valueNoProps)) {
              add(n, 'Double-quoted string is not closed on this line', 'warning');
          }
          if (/^'/.test(valueNoProps) && !/^'(?:[^']|'')*'/.test(valueNoProps)) {
              add(n, 'Single-quoted string is not closed on this line', 'warning');
          }
      });
      return { problems, info: 'basic checks' };
  }

  // Module: text/highlight/yaml.ts

  // YAML highlighting

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const YAML_SCALAR_RE =
      /^(true|false|yes|no|on|off|null|~|[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+|\.inf|\.nan)|0x[0-9a-fA-F]+|0o[0-7]+)$/i;
  const YAML_KEY_RE = /^("(?:\\.|[^"\\])*"|'(?:[^']|'')*'|[^\s#'"[\]{},&*!|>%@`][^#]*?)(\s*:)(?=\s|$)/;
  const YAML_VALUE_RE = new RegExp(
      [
          /("(?:\\.|[^"\\])*"?|'(?:[^']|'')*'?)/.source, // 1 quoted string
          /((?:^|(?<=\s))#.*$)/.source, // 2 comment
          /([&*][^\s,[\]{}]+)/.source, // 3 anchor / alias
          /(![^\s]*)/.source, // 4 tag
          /((?<=^\s*)[|>][-+0-9]*(?=\s*(?:#.*)?$)|[[\]{},])/.source, // 5 block indicator / flow punctuation
      ].join('|'),
      'g',
  );

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function yamlValue(s, out) {
      out.push(
          ...tokenise(
              s,
              YAML_VALUE_RE,
              (m, o) => {
                  if (m[1]) o.push(['str', m[1]]);
                  else if (m[2]) o.push(['com', m[2]]);
                  else if (m[3]) o.push(['anchor', m[3]]);
                  else if (m[4]) o.push(['meta', m[4]]);
                  else o.push(['punct', m[5]]);
              },
              (plain, o) => {
                  const lead = plain.match(/^\s*/)?.[0] ?? '';
                  const trail = plain.slice(lead.length).match(/\s*$/)?.[0] ?? '';
                  const core = plain.slice(lead.length, plain.length - trail.length);
                  if (lead) o.push(['', lead]);
                  if (core) {
                      const cls = !YAML_SCALAR_RE.test(core) ? 'str' : /^[-+]?[\d.]/.test(core) ? 'num' : 'lit';
                      o.push([cls, core]);
                  }
                  if (trail) o.push(['', trail]);
              },
          ),
      );
  }

  function highlightYaml(text) {
      const out = [];
      let blockIndent = null; // inside a | or > block scalar: lines are plain string content
      text.split('\n').forEach((line, i) => {
          if (i) out.push(['', '\n']);
          const indent = line.match(/^ */)?.[0].length ?? 0;
          if (blockIndent !== null) {
              if (!line.trim() || indent > blockIndent) {
                  out.push(['str', line]);
                  return;
              }
              blockIndent = null;
          }
          if (/(?:^|:\s+|-\s+)(?:[&!][^\s]*\s+)*[|>][-+0-9]*$/.test(stripYamlComment(line).trim())) {
              blockIndent = indent;
          }
          const doc = line.match(/^(---|\.\.\.)(?=\s|$)/);
          if (doc) {
              out.push(['kw', doc[1]]);
              yamlValue(line.slice(3), out);
              return;
          }
          if (/^\s*#/.test(line)) {
              out.push(['com', line]);
              return;
          }
          const lead = line.match(/^(\s*)((?:-(?:\s+|$))*)/); // all parts optional: always matches
          if (lead[1]) out.push(['', lead[1]]);
          if (lead[2]) out.push(['punct', lead[2]]);
          let rest = line.slice(lead[0].length);
          const key = rest.match(YAML_KEY_RE);
          if (key) {
              out.push(['key', key[1]], ['punct', key[2]]);
              rest = rest.slice(key[0].length);
          }
          yamlValue(rest, out);
      });
      return out;
  }

  // Module: text/highlight/index.ts

  // Syntax highlighters by language

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const HIGHLIGHTERS = {
      sql: highlightSql,
      py: highlightPy,
      xlf: highlightXlf,
      csv: highlightCsv,
      md: highlightMd,
      rst: highlightRst,
      js: highlightJs,
      m: highlightM,
      json: highlightJson,
      xml: highlightXml,
      yaml: highlightYaml,
      ifc: highlightIfc,
      toml: highlightToml,
      log: highlightLog,
  };

  // Module: text/lint/ifc.ts

  // IFC (STEP) checks

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // IFC = ISO 10303-21 (STEP physical file)
  function lintIfc(text) {
      const { problems, add } = collector();

      // Split into statements (";"-terminated), ignoring comments and string contents
      const statements = [];
      let buf = '';
      let start = 1;
      let line = 1;
      for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (c === '\n') {
              line++;
              buf += ' ';
              continue;
          }
          if (c === '/' && text[i + 1] === '*') {
              const end = text.indexOf('*/', i + 2);
              const stop = end === -1 ? text.length : end + 2;
              if (end === -1) add(line, 'Comment is never closed');
              for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
              i = stop - 1;
              buf += ' ';
              continue;
          }
          if (!buf.trim() && !/\s/.test(c)) start = line;
          if (c === "'") {
              let j = i + 1;
              for (; j < text.length; j++) {
                  if (text[j] === "'") {
                      if (text[j + 1] === "'") j++;
                      else break;
                  } else if (text[j] === '\n') line++;
              }
              if (j >= text.length) add(start, 'String is never closed');
              buf += "''";
              i = j;
              continue;
          }
          if (c === ';') {
              statements.push({ text: buf.trim(), line: start });
              buf = '';
              continue;
          }
          buf += c;
      }
      if (buf.trim()) add(start, 'Statement is not terminated with ";"');

      // Structure: ISO-10303-21; HEADER; ... ENDSEC; DATA; ... ENDSEC; END-ISO-10303-21;
      const ids = new Map(); // id -> line
      const refs = []; // [id, line]
      const headerSeen = new Set();
      let section = 'start';
      let entities = 0;

      for (const s of statements) {
          const upper = s.text.toUpperCase();
          if (section === 'start') {
              if (upper !== 'ISO-10303-21') add(s.line, 'File must start with "ISO-10303-21;"');
              section = 'pre';
              if (upper === 'ISO-10303-21') continue;
          }
          if (upper === 'HEADER') {
              section = 'header';
              continue;
          }
          if (upper === 'DATA' || /^DATA\s*\(/.test(upper)) {
              section = 'data';
              continue;
          }
          if (upper === 'ENDSEC') {
              if (section !== 'header' && section !== 'data') add(s.line, '"ENDSEC;" without an open section');
              section = 'between';
              continue;
          }
          if (upper === 'END-ISO-10303-21') {
              section = 'end';
              continue;
          }

          if (section === 'end') {
              add(s.line, 'Content after "END-ISO-10303-21;"');
              continue;
          }

          const open = (s.text.match(/\(/g) || []).length;
          const close = (s.text.match(/\)/g) || []).length;
          if (open !== close) add(s.line, `Unbalanced parentheses (${open} "(" vs ${close} ")")`);

          if (section === 'header') {
              const type = (upper.match(/^([A-Z_][A-Z0-9_]*)\s*\(/) || [])[1];
              if (!type) add(s.line, 'Malformed header entry');
              else headerSeen.add(type);
              continue;
          }
          if (section !== 'data') {
              add(s.line, 'Statement outside of HEADER / DATA sections');
              continue;
          }

          const m = s.text.match(/^#(\d+)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)?\s*\(([\s\S]*)\)$/);
          if (!m) {
              add(s.line, 'Malformed entity instance (expected "#id=IFCTYPE(...);")');
              continue;
          }
          entities++;
          if (ids.has(m[1])) add(s.line, `Duplicate id #${m[1]} (first defined on line ${ids.get(m[1])})`);
          else ids.set(m[1], s.line);
          for (const r of m[3].matchAll(/#(\d+)/g)) refs.push([r[1], s.line]);
      }

      if (section !== 'end') add(line, 'No "END-ISO-10303-21;" at the end of the file');
      for (const h of ['FILE_DESCRIPTION', 'FILE_NAME', 'FILE_SCHEMA']) {
          if (!headerSeen.has(h)) add(1, `Header lacks ${h}`, 'warning');
      }
      for (const [id, refLine] of refs) {
          if (!ids.has(id)) add(refLine, `Reference to undefined instance #${id}`);
      }

      problems.sort((a, b) => a.line - b.line);
      return { problems, info: `${entities.toLocaleString()} entities` };
  }

  // Module: text/lint/json.ts

  // JSON checks

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function lintJson(text) {
      try {
          const value = JSON.parse(text.replace(/^\uFEFF/, ''));
          const kind = Array.isArray(value) ? `array, ${value.length.toLocaleString()} items` : typeof value;
          return { problems: [], info: kind };
      } catch (e) {
          const msg = (e).message.replace(/^JSON\.parse:\s*/, '');
          const byLine = msg.match(/line (\d+)/i);
          const byPos = msg.match(/position (\d+)/i);
          const line = byLine ? +byLine[1] : byPos ? lineAt(text, +byPos[1]) : 1;
          return { problems: [{ line, msg, severity: 'error' }] };
      }
  }

  // Module: text/lint/m.ts

  // Power Query M checks

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Power Query M: brackets, strings, comments and let / in pairs
  function lintM(text) {
      const { problems, add } = collector();
      const PAIRS = { ')': '(', ']': '[', '}': '{' };
      const stack = []; // [char, line]
      const lets = []; // lines of "let" that still need their "in"
      let line = 1;

      for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (c === '\n') {
              line++;
              continue;
          }
          if (c === '/' && text[i + 1] === '/') {
              const end = text.indexOf('\n', i);
              i = (end === -1 ? text.length : end) - 1;
              continue;
          }
          if (c === '/' && text[i + 1] === '*') {
              const start = line;
              const end = text.indexOf('*/', i + 2);
              const stop = end === -1 ? text.length : end + 2;
              if (end === -1) add(start, 'Comment is never closed');
              for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
              i = stop - 1;
              continue;
          }
          if (c === '"') {
              const start = line;
              let j = i + 1;
              for (; j < text.length; j++) {
                  if (text[j] === '"') {
                      if (text[j + 1] === '"') j++;
                      else break;
                  } else if (text[j] === '\n') line++;
              }
              if (j >= text.length) add(start, 'Text is never closed with "');
              i = j;
              continue;
          }
          if (c === '(' || c === '[' || c === '{') {
              stack.push([c, line]);
              continue;
          }
          if (c === ')' || c === ']' || c === '}') {
              const top = stack.pop();
              if (!top) add(line, `Unexpected "${c}"`);
              else if (top[0] !== PAIRS[c]) add(line, `"${c}" does not match "${top[0]}" opened on line ${top[1]}`);
              continue;
          }
          if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_.#]/.test(text[i - 1] || '')) {
              const word = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? '';
              if (word === 'let') lets.push(line);
              else if (word === 'in' && !lets.pop()) add(line, '"in" without its "let"');
              i += word.length - 1;
          }
      }

      for (const [c, l] of stack) add(l, `"${c}" is never closed`);
      for (const l of lets) add(l, '"let" without its "in"');
      problems.sort((a, b) => a.line - b.line);
      return { problems };
  }

  // Module: text/lint/xml.ts

  // XML checks

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function lintXml(text) {
      const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
      const err = doc.getElementsByTagName('parsererror')[0];
      if (!err) {
          return { problems: [], info: `root <${doc.documentElement.nodeName}>` };
      }
      const raw = err.textContent;
      const line = +((raw.match(/line(?: number)?\s*(\d+)/i) || [])[1] || 1);
      const msg =
          (raw.match(/error on line \d+ at column \d+:\s*([^\n]*)/i) || [])[1] ||
          raw.split('\n')[0].replace(/^XML Parsing Error:\s*/i, '');
      return { problems: [{ line, msg: msg.trim(), severity: 'error' }] };
  }

  // Module: text/lint/index.ts

  // Linters by language

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const LINTERS = {
      json: lintJson,
      xml: lintXml,
      yaml: lintYaml,
      ifc: lintIfc,
      m: lintM,
  };

  // Module: text/lint/worker.ts

  // Checks in Web Worker (XML on page: needs DOMParser); fallback: page

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  let lintWorkerUrl = null;
  let workersBlocked = false;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function startLintWorker(v, lang, text) {
      if (workersBlocked || !['json', 'yaml', 'ifc', 'm'].includes(lang)) return null;
      try {
          if (!lintWorkerUrl) {
              const src = `
          const MAX_PROBLEMS = ${MAX_PROBLEMS};
          const YAML_KEY_RE = ${YAML_KEY_RE};
          const lineAt = ${lineAt};
          ${stripYamlComment}
          ${collector}
          ${lintJson}
          ${lintYaml}
          ${lintIfc}
          ${lintM}
          const LINTERS = { json: lintJson, yaml: lintYaml, ifc: lintIfc, m: lintM };
          onmessage = (e) => {
            try {
              postMessage({ ok: true, result: LINTERS[e.data.lang](e.data.text) });
            } catch (err) {
              postMessage({ ok: false, error: /** @type {Error} */ (err).message });
            }
          };
        `;
              lintWorkerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
          }
          const worker = new Worker(lintWorkerUrl);
          v.lintWorker = worker;
          return new Promise((resolve, reject) => {
              worker.onmessage = (e) => {
                  worker.terminate();
                  if (e.data.ok) resolve(e.data.result);
                  else reject(new Error(e.data.error));
              };
              worker.onerror = (e) => {
                  e.preventDefault();
                  worker.terminate();
                  workersBlocked = true;
                  reject(Object.assign(new Error('worker unavailable'), { fallback: true }));
              };
              worker.postMessage({ lang, text });
          });
      } catch {
          workersBlocked = true;
          return null;
      }
  }

  async function lintFile(v, lang, text) {
      const linter = LINTERS[lang];

      const onPage = () => {
          try {
              return linter(text);
          } catch (err) {
              return {
                  problems: [{ line: 1, msg: `Check failed: ${(err).message}`, severity: 'warning' }],
              };
          }
      };
      const job = startLintWorker(v, lang, text);
      if (!job) {
          await nextFrame(); // let text appear before page is busy with check
          return onPage();
      }
      try {
          return await job;
      } catch (err) {
          if ((err).fallback) return onPage();
          return {
              problems: [{ line: 1, msg: `Check failed: ${(err).message}`, severity: 'warning' }],
          };
      }
  }

  // Module: text/segments.ts

  // Message segments: text, JSON and Python-like literals (dicts, lists, tuples) found in a message

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const MAX_CHARS = 200000; // longer messages: one text segment
  const OPEN = '{[(';
  const CLOSE = '}])';
  // Python literal tokens: strings, words, punctuation, spaces
  const PY_TOKEN_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}[\](),:]|[^\s"'{}[\](),:]+|\s+/gy;
  // JSON tokens for indenting: strings, punctuation, other
  const JSON_TOKEN_RE = /"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s"{}[\],:]+|\s+/gy;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Message -> segments in order; objects and lists start at { or [ (not after a letter, e.g. sshd[123])
  function segments(text) {
      const out = [];
      if (text.length > MAX_CHARS) return [{ kind: 'text', text }];
      let from = 0; // start of pending text
      for (let i = 0; i < text.length; i++) {
          if ((text[i] !== '{' && text[i] !== '[') || /\w/.test(text[i - 1] ?? '')) continue;
          const end = closing(text, i);
          if (end < 0) continue;
          const part = text.slice(i, end);
          const found = /^.\s*.$/.test(part) ? null : asJson(part); // {} and [] stay text
          if (!found) continue;
          if (text.slice(from, i).trim()) out.push({ kind: 'text', text: text.slice(from, i) });
          out.push(found);
          from = end;
          i = end - 1;
      }
      if (text.slice(from).trim() || !out.length) out.push({ kind: 'text', text: text.slice(from) });
      return out;
  }

  // JSON indented by 2 spaces; values (numbers, strings) kept as written
  function indentJson(json) {
      const tokens = [...json.matchAll(JSON_TOKEN_RE)].map((m) => m[0]).filter((t) => t.trim());
      let out = '';
      let depth = 0;
      const nl = () => `\n${'  '.repeat(depth)}`;
      tokens.forEach((t, k) => {
          if (t === '{' || t === '[') {
              const empty = tokens[k + 1] === (t === '{' ? '}' : ']');
              out += t;
              if (!empty) {
                  depth++;
                  out += nl();
              }
          } else if (t === '}' || t === ']') {
              const empty = tokens[k - 1] === (t === '}' ? '{' : '[');
              if (!empty) {
                  depth--;
                  out += nl();
              }
              out += t;
          } else if (t === ',') out += `,${nl()}`;
          else if (t === ':') out += ': ';
          else out += t;
      });
      return out;
  }

  // ===========================================================================
  // AUXILIARY METHODS
  // ===========================================================================

  // End (exclusive) of the bracket opened at i, quotes respected; -1 if not closed
  function closing(text, i) {
      const stack = [];
      for (let k = i; k < text.length; k++) {
          const c = text[k];
          if (c === '"' || c === "'") {
              const end = text.indexOf(c, k + 1);
              let e = end;
              while (e > 0 && text[e - 1] === '\\') e = text.indexOf(c, e + 1);
              if (e < 0) return -1;
              k = e;
          } else if (OPEN.includes(c)) stack.push(CLOSE[OPEN.indexOf(c)]);
          else if (CLOSE.includes(c)) {
              if (stack.pop() !== c) return -1;
              if (!stack.length) return k + 1;
          }
      }
      return -1;
  }

  // Object or list as JSON (as is) or as Python literal (converted); null: neither
  function asJson(part) {
      try {
          JSON.parse(part);
          return { kind: 'json', text: part };
      } catch {}
      const json = fromPython(part);
      return json ? { kind: 'python', text: json } : null;
  }

  // Python literal -> JSON: quotes, True / False / None, tuples as lists, trailing commas; null if not valid
  function fromPython(part) {
      const out = [];
      PY_TOKEN_RE.lastIndex = 0;
      let m = PY_TOKEN_RE.exec(part);
      while (m) {
          const t = m[0];
          if (t.startsWith("'")) out.push(JSON.stringify(t.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')));
          else if (t === 'True' || t === 'False' || t === 'None')
              out.push({ True: 'true', False: 'false', None: 'null' }[t]);
          else if (t === '(' || t === ')') out.push(t === '(' ? '[' : ']');
          else if (t.trim()) out.push(t);
          if (/^[}\]]$/.test(out[out.length - 1]) && out[out.length - 2] === ',') out.splice(out.length - 2, 1); // trailing comma
          m = PY_TOKEN_RE.exec(part);
      }
      const json = out.join('');
      try {
          JSON.parse(json);
          return json;
      } catch {
          return null;
      }
  }

  // Module: view/log.ts

  // Log table (experimental): entries and fields guessed from the log's lines; rows expand into text, JSON and lists

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const SAMPLE_LINES = 20000; // lines looked at to find the fields
  const MAX_FIELDS = 6;
  const MIN_STARTS = 0.2; // share of lines that must start an entry (unless it starts with a time or level)
  const MIN_SHARED = 0.8; // share of entries a field must be in

  // Level words, any case (as in the highlighter)
  const LEVEL_WORDS = Object.values(LOG_LEVELS).flat().join('|');

  // Fields at the start of an entry (sticky); groups: the value
  const FIELDS = [
      [
          'time',
          new RegExp(
              [
                  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/.source, // ISO 8601
                  /\d{1,2}[./]\d{1,2}[./]\d{2,4}(?:[ ,]+\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)?/.source, // 24.10.2026
                  /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2} \d{2}:\d{2}:\d{2}/.source, // syslog
                  /\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/.source, // time
              ]
                  .join('|')
                  .replace(/^(.*)$/, '\\[?($1)\\]?(?![\\w:])'),
              'y',
          ),
      ],
      ['level', new RegExp(`\\[?(${LEVEL_WORDS})\\]?(?![\\w-])`, 'iy')],
      ['context', /[[(]([^\])\n]*)[\])]/y], // [thread], (module)
      ['name', /([A-Za-z_$][\w.$/-]*(?:\[\d+\])?)(?=[ \t]*(?:[-|][ \t]|:|\t))/y], // logger, process[pid]: before a separator
  ];
  const SEP_RE = /[ \t]*(?:[-|][ \t]+|:[ \t]*)?[ \t]*/y; // between fields: spaces, " - ", " | ", ":"
  const WORD_RE = /[^\s[\]()]+(?=[ \t])/y; // source (e.g. host, worker): a word, counted only if a field follows
  const EXPAND_TITLE = 'Expand: message split into text, JSON and lists';
  const SEGMENT_LABELS = { json: 'JSON', python: 'Python' };

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Log text -> table: line of the entry, fields, message (continuation lines joined); null: no fields found
  function parseLog(text) {
      const lines = text.split(/\r?\n/);
      const kinds = template(lines.slice(0, SAMPLE_LINES));
      if (!kinds) return null;
      const header = ['line', ...names(kinds), 'message'];
      const rows = [];
      lines.forEach((line, i) => {
          const head = /^\s/.test(line) ? null : readHead(line);
          const last = rows[rows.length - 1];
          if (head && head.kinds[0] === kinds[0]) {
              // fields in the order of the columns (missing ones left empty); the rest of the line is the message
              const row = [String(i + 1), ...kinds.map(() => '')];
              let end = 0;
              for (let f = 0, k = 0; f < head.kinds.length; f++) {
                  const at = kinds.indexOf(head.kinds[f], k);
                  if (at < 0) break;
                  row[at + 1] = head.values[f];
                  end = head.ends[f];
                  k = at + 1;
              }
              row.push(line.slice(end));
              rows.push(row);
          } else if (last) last[last.length - 1] += `\n${line}`;
          else if (line.trim()) rows.push([String(i + 1), ...kinds.map(() => ''), line]); // lines before the first entry
      });
      for (const row of rows) row[row.length - 1] = row[row.length - 1].replace(/\s+$/, '');
      return { header, rows, kinds };
  }

  // Fields found in the first lines (whether the table view is offered)
  const hasFields = (lines) => !!template(lines.slice(0, SAMPLE_LINES));

  // Level class of a value ('lv-err', ...), as in the highlighter; '' if none
  function levelClass(value) {
      const word = value.toUpperCase();
      const entry = Object.entries(LOG_LEVELS).find(([, words]) => words.includes(word));
      return entry ? entry[0] : '';
  }

  // Expand of a log table's rows: messages with objects, lists or several lines; segments worked out once per row
  function logExpand(
      rows,
      colour,
  ) {
      const cache = new Map();
      const message = (i) => rows[i][rows[i].length - 1];
      const parts = (i) => {
          if (!cache.has(i))
              cache.set(i, /[{[]/.test(message(i)) ? segments(message(i)) : [{ kind: 'text', text: message(i) }]);
          return cache.get(i); // set just above
      };
      return {
          title: EXPAND_TITLE,
          can: (i) => message(i).includes('\n') || parts(i).some((s) => s.kind !== 'text'),
          html: (i) =>
              parts(i)
                  .map((s) => segmentHtml(s, colour))
                  .join(''),
      };
  }

  // ===========================================================================
  // AUXILIARY METHODS
  // ===========================================================================

  // One segment: text as is (blank lines at its ends dropped), objects and lists labelled and indented
  function segmentHtml(s, colour) {
      if (s.kind === 'text') return `<div class="tp-seg"><pre>${esc(s.text.replace(/^\s*\n|\s+$/g, ''))}</pre></div>`;
      const json = indentJson(s.text);
      const body = colour
          ? highlightJson(json)
                .map(([cls, x]) => (cls ? `<span class="tp-${cls}">${esc(x)}</span>` : esc(x)))
                .join('')
          : esc(json);
      const what = s.text.startsWith('{') ? (s.kind === 'json' ? 'object' : 'dict') : 'list';
      return `<div class="tp-seg"><div class="tp-seg-label">${SEGMENT_LABELS[s.kind]} ${what}</div><pre>${body}</pre></div>`;
  }

  // Fields at the start of a line: kinds, values, end of the head
  function readHead(line) {
      const kinds = [];
      const values = [];
      const ends = []; // after each field and its separator
      let at = 0;
      while (kinds.length < MAX_FIELDS) {
          let m = field(line, at, kinds);
          if (m) {
              kinds.push(m.kind);
              values.push(m.value);
          } else if (kinds.length && !kinds.includes('source')) {
              WORD_RE.lastIndex = at;
              const word = WORD_RE.exec(line)?.[0];
              const next = word ? line.slice(at + word.length).match(/^[ \t]+/)?.[0] : '';
              if (!word || !next || !field(line, at + word.length + next.length, [...kinds, 'time'])) break;
              m = { kind: 'source', value: word, end: at + word.length };
              kinds.push('source');
              values.push(word);
          } else break;
          SEP_RE.lastIndex = m.end;
          SEP_RE.test(line);
          at = SEP_RE.lastIndex;
          ends.push(at);
      }
      return kinds.length ? { kinds, values, ends } : null;
  }

  // Field at a position (kinds already found are not looked for again, brackets may repeat)
  function field(line, at, found) {
      for (const [kind, re] of FIELDS) {
          if (kind !== 'context' && found.includes(kind)) continue;
          re.lastIndex = at;
          const m = re.exec(line);
          if (m) return { kind, value: m[1], end: at + m[0].length };
      }
      return null;
  }

  // Fields shared by the entries: first field starts enough lines, then the longest run most entries share
  function template(lines) {
      const filled = lines.filter((l) => l.trim());
      const heads = filled.filter((l) => !/^\s/.test(l)).map(readHead);
      const firsts = new Map();
      for (const h of heads) if (h) firsts.set(h.kinds[0], (firsts.get(h.kinds[0]) || 0) + 1);
      const [first, count] = [...firsts].sort((a, b) => b[1] - a[1])[0] || ['', 0];
      const strong = first === 'time' || first === 'level'; // printed output in between may outweigh the entries
      if (count < 2 || (!strong && count < filled.length * MIN_STARTS)) return null;
      const entries = heads.filter((h) => h?.kinds[0] === first);
      const kinds = [first];
      while (kinds.length < MAX_FIELDS) {
          const next = new Map();
          for (const e of entries) {
              const same = kinds.every((k, i) => e.kinds[i] === k);
              const k = same ? e.kinds[kinds.length] : undefined;
              if (k) next.set(k, (next.get(k) || 0) + 1);
          }
          const [kind, n] = [...next].sort((a, b) => b[1] - a[1])[0] || ['', 0];
          if (n < entries.length * MIN_SHARED) break;
          kinds.push(kind);
      }
      return kinds.length > 1 || strong ? kinds : null;
  }

  // Column names of the fields: context, context 2, ...
  function names(kinds) {
      const seen = new Map();
      return kinds.map((k) => {
          const n = (seen.get(k) || 0) + 1;
          seen.set(k, n);
          return n > 1 ? `${k} ${n}` : k;
      });
  }

  // Module: view/markdown.ts

  // Render: Markdown -> HTML (CommonMark core + GFM tables, task lists, strikethrough); raw HTML shown as text

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Info strings of fenced code -> highlighter
  const CODE_LANGS = {
      python: 'py',
      javascript: 'js',
      yml: 'yaml',
      html: 'xml',
      svg: 'xml',
      markdown: 'md',
      powerquery: 'm',
      tsv: 'csv',
  };

  const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
  const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
  const RULE_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const SETEXT_RE = /^ {0,3}(=+|-+)\s*$/;
  const QUOTE_RE = /^ {0,3}> ?/;
  const ITEM_RE = /^( {0,3})([-*+]|\d{1,9}[.)])(\s+|$)/;
  const TABLE_RULE_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const UNSAFE_URL_RE = /^\s*(javascript|vbscript|data|file):/i;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // Inline: code, links, images, emphasis, line breaks
  // ---------------------------------------------------------------------------

  // Link target against the file's folder; null: not followed (scripts, data)
  function resolveUrl(url, base) {
      if (UNSAFE_URL_RE.test(url)) return null;
      if (url.startsWith('#')) return url;
      try {
          return new URL(url, base || location.href).href;
      } catch {
          return null;
      }
  }

  // Same site: images from the library are shown, others only linked (nothing fetched from elsewhere)
  const sameSite = (href) => href.startsWith(`${location.origin}/`);

  const slug = (text) =>
      text
          .toLowerCase()
          .replace(/<[^>]*>|&\w+;/g, '')
          .replace(/[^\p{L}\p{N}\s_-]/gu, '')
          .trim()
          .replace(/\s+/g, '-');

  /** @param kept finished HTML, out of reach of later rules */
  function inlineHtml(text, opts = {}, kept = []) {
      const keep = (html) => `\uE000${kept.push(html) - 1}\uE000`;
      const base = opts.base || '';

      let s = text
          .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _q, code) =>
              keep(`<code>${esc(code.replace(/^ (.+) $/, '$1'))}</code>`),
          )
          .replace(/\\([!-/:-@[-`{-~])/g, (_, c) => keep(esc(c)))
          .replace(/!\[([^\]]*)\]\(\s*<?((?:[^\s()<>]|\([^\s()]*\))*)>?(?:\s+"([^"]*)")?\s*\)/g, (_, alt, url, title) => {
              const href = resolveUrl(url, base);
              if (!href) return keep(esc(alt));
              const t = title ? ` title="${esc(title)}"` : '';
              if (sameSite(href)) return keep(`<img src="${esc(href)}" alt="${esc(alt)}"${t} loading="lazy">`);
              return keep(
                  `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"${t}>🖼 ${esc(alt || href)}</a>`,
              );
          })
          .replace(
              /\[([^\]]+)\]\(\s*<?((?:[^\s()<>]|\([^\s()]*\))*)>?(?:\s+"([^"]*)")?\s*\)/g,
              (_, label, url, title) => {
                  const href = resolveUrl(url, base);
                  const inner = inlineHtml(label, opts, kept);
                  if (!href) return keep(inner);
                  const t = title ? ` title="${esc(title)}"` : '';
                  const target = href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"';
                  return keep(`<a href="${esc(href)}"${target}${t}>${inner}</a>`);
              },
          )
          .replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, (_, url) =>
              keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`),
          );

      s = esc(s)
          .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
          .replace(/\*(?=\S)([\s\S]*?\S)\*|(^|[^\p{L}\p{N}_])_(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}_])/gu, (_, a, pre, b) =>
              a !== undefined ? `<em>${a}</em>` : `${pre}<em>${b}</em>`,
          )
          .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
          .replace(/(?: {2,}|\\)\n/g, '<br>\n');
      return s.replace(/\uE000(\d+)\uE000/g, (_, i) => kept[Number(i)]);
  }

  // ---------------------------------------------------------------------------
  // Blocks: headings, paragraphs, lists, quotes, code, tables, rules
  // ---------------------------------------------------------------------------

  const tableCells = (line) =>
      line
          .trim()
          .replace(/^\||\|$/g, '')
          .split(/(?<!\\)\|/)
          .map((c) => c.trim());

  function codeHtml(code, info, opts) {
      const lang = CODE_LANGS[info.toLowerCase()] || info.toLowerCase();
      const highlight = opts.colour ? HIGHLIGHTERS[lang] : null;
      if (!highlight) return esc(code);
      return highlight(code)
          .map(([cls, t]) => (cls ? `<span class="tp-${cls}">${esc(t)}</span>` : esc(t)))
          .join('');
  }

  // Starts a block other than a paragraph (ends a paragraph before it)
  const opensBlock = (line) =>
      FENCE_RE.test(line) || HEADING_RE.test(line) || RULE_RE.test(line) || QUOTE_RE.test(line) || ITEM_RE.test(line);

  function blocksHtml(lines, opts) {
      const out = [];
      let i = 0;
      while (i < lines.length) {
          const line = lines[i];
          const fence = FENCE_RE.exec(line);
          const heading = HEADING_RE.exec(line);
          if (!line.trim()) {
              i++;
          } else if (fence) {
              const end = lines.findIndex((l, j) => j > i && l.trimStart().startsWith(fence[1]));
              const stop = end < 0 ? lines.length : end;
              const code = lines.slice(i + 1, stop).join('\n');
              out.push(`<pre><code>${codeHtml(code, fence[2], opts)}</code></pre>`);
              i = stop + 1;
          } else if (heading) {
              const n = heading[1].length;
              const html = inlineHtml(heading[2] || '', opts);
              out.push(`<h${n} data-anchor="${esc(slug(html))}">${html}</h${n}>`);
              i++;
          } else if (RULE_RE.test(line)) {
              out.push('<hr>');
              i++;
          } else if (QUOTE_RE.test(line)) {
              const inner = [];
              while (i < lines.length && lines[i].trim() && (QUOTE_RE.test(lines[i]) || !opensBlock(lines[i])))
                  inner.push(lines[i++].replace(QUOTE_RE, ''));
              out.push(`<blockquote>${blocksHtml(inner, opts)}</blockquote>`);
          } else if (ITEM_RE.test(line)) {
              i = listHtml(lines, i, opts, out);
          } else if (line.includes('|') && TABLE_RULE_RE.test(lines[i + 1] || '') && lines[i + 1].includes('-')) {
              const head = tableCells(line);
              const align = tableCells(lines[i + 1]).map((c) =>
                  c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : c.startsWith(':') ? 'left' : '',
              );
              const row = (cells, tag) =>
                  cells
                      .map((c, j) => {
                          const a = align[j] ? ` style="text-align:${align[j]}"` : '';
                          return `<${tag}${a}>${inlineHtml(c, opts)}</${tag}>`;
                      })
                      .join('');
              const body = [];
              i += 2;
              while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(tableCells(lines[i++]));
              const rows = body.map((r) => `<tr>${row(r.slice(0, head.length), 'td')}</tr>`).join('');
              out.push(`<table><thead><tr>${row(head, 'th')}</tr></thead><tbody>${rows}</tbody></table>`);
          } else if (/^ {4}/.test(line)) {
              const code = [];
              while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) code.push(lines[i++].slice(4));
              while (code.length && !code[code.length - 1].trim()) code.pop();
              out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
          } else {
              const para = [line];
              i++;
              while (i < lines.length && lines[i].trim() && !opensBlock(lines[i]) && !SETEXT_RE.test(lines[i]))
                  para.push(lines[i++]);
              const setext = i < lines.length && SETEXT_RE.exec(lines[i]);
              const html = inlineHtml(para.map((l) => l.replace(/^\s+/, '')).join('\n'), opts);
              if (setext) {
                  const n = setext[1][0] === '=' ? 1 : 2;
                  out.push(`<h${n} data-anchor="${esc(slug(html))}">${html}</h${n}>`);
                  i++;
              } else out.push(`<p>${html}</p>`);
          }
      }
      return out.join('\n');
  }

  // List from line `start`: items of one kind, their lines dedented to the item's text; returns next line
  function listHtml(lines, start, opts, out) {
      const first = ITEM_RE.exec(lines[start]);
      const ordered = /\d/.test(first[2]);
      const marker = ordered ? first[2].slice(-1) : first[2];
      const items = [];
      let loose = false;
      let i = start;
      while (i < lines.length) {
          const m = ITEM_RE.exec(lines[i]);
          if (!m || (ordered ? m[2].slice(-1) !== marker : m[2] !== marker)) break;
          const pad = ' '.repeat(Math.max(m[0].length, m[1].length + m[2].length + 1)); // text column of the item
          const item = [lines[i].slice(m[0].length)];
          for (i++; i < lines.length; i++) {
              const l = lines[i];
              const next = lines[i + 1];
              if (l.startsWith(pad)) item.push(l.slice(pad.length));
              else if (l.trim() && !opensBlock(l) && item[item.length - 1].trim())
                  item.push(l); // lazy line
              else if (l.trim() || next === undefined || !(next.startsWith(pad) || ITEM_RE.test(next))) break;
              else {
                  loose = true; // blank line inside the list
                  item.push('');
              }
          }
          items.push(item);
      }
      const startAt = ordered && Number.parseInt(first[2], 10) !== 1 ? ` start="${Number.parseInt(first[2], 10)}"` : '';
      const html = items.map((item) => {
          const task = /^\[([ xX])\]\s+/.exec(item[0]);
          if (task) item[0] = item[0].slice(task[0].length);
          let body = blocksHtml(item, opts);
          if (!loose) body = body.replace(/<p>([\s\S]*?)<\/p>/g, '$1');
          const box = task ? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ` : '';
          const cls = task ? ' class="tp-md-task"' : '';
          return `<li${cls}>${box}${body}</li>`;
      });
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}${startAt}>${html.join('')}</${tag}>`);
      return i;
  }

  function markdownHtml(text, opts = {}) {
      return blocksHtml(text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'), opts);
  }

  // ---------------------------------------------------------------------------
  // View
  // ---------------------------------------------------------------------------

  // Whole document at once (Markdown files are small); links to headings scroll within the view
  function mountMarkdown(content, text, opts = {}) {
      const doc = document.createElement('div');
      doc.className = 'tp-md';
      doc.innerHTML = markdownHtml(text, opts);
      doc.addEventListener('click', (e) => {
          const a = (e.target).closest('a[href^="#"]');
          if (!a) return;
          e.preventDefault();
          const name = decodeURIComponent((a.getAttribute('href') || '').slice(1)).toLowerCase();
          doc.querySelector(`[data-anchor="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'start' });
      });
      content.replaceChildren(doc);
      return { stop: () => {}, show: () => {} };
  }

  // Module: viewer/messages.ts

  // Messages in the viewer: plain notices, lint results

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function showPlain(v, message) {
      v.lint.style.display = 'none';
      v.loadMoreBtn.style.display = 'none';
      v.lineView?.stop();
      v.lineView = null;
      // notices: italic, grey (dark) / red (light)
      v.content.innerHTML = `<div class="tp-lines tp-notice">${renderLines([['', message]], new Map()).join('')}</div>`;
  }

  function showLintWait(v, lang) {
      v.lint.style.display = 'block';
      v.lint.className = 'tp-lint tp-lint-wait';
      v.lint.innerHTML = `<div class="tp-lint-summary">… ${lang.toUpperCase()}: check in progress</div>`;
  }

  function renderLint(v, lang, result, goToLine) {
      const { problems, info } = result;
      const label = lang.toUpperCase();
      const lint = v.lint;
      lint.style.display = 'block';
      lint.className = `tp-lint ${problems.length ? 'tp-lint-bad' : 'tp-lint-ok'}`;

      if (!problems.length) {
          const extra = info ? ` · ${esc(info)}` : '';
          lint.innerHTML = `<div class="tp-lint-summary">✓ ${label}: no problems${extra}</div>`;
          return;
      }

      const errors = problems.filter((p) => p.severity === 'error').length;
      const warnings = problems.length - errors;
      const parts = [];
      if (errors) parts.push(`${errors.toLocaleString()} error${errors > 1 ? 's' : ''}`);
      if (warnings) parts.push(`${warnings.toLocaleString()} warning${warnings > 1 ? 's' : ''}`);
      const capped = problems.length >= MAX_PROBLEMS ? ` (first ${MAX_PROBLEMS} shown)` : '';

      const items = problems
          .map(
              (p) => `
          <div class="tp-lint-item tp-sev-${p.severity}" data-line="${p.line}">
            <b>Line ${p.line}</b>${esc(p.msg)}
          </div>
        `,
          )
          .join('');
      lint.innerHTML = `
      <button class="tp-lint-summary" type="button">✗ ${label}: ${parts.join(', ')}${capped} ▾</button>
      <div class="tp-lint-list" style="display:none">
        ${items}
      </div>
    `;
      const list = lint.querySelector('.tp-lint-list'); // written just above
      (lint.querySelector('.tp-lint-summary')).onclick = () => {
          list.style.display = list.style.display === 'none' ? 'block' : 'none';
      };
      list.onclick = (e) => {
          const item = (e.target).closest('.tp-lint-item');
          if (item) goToLine(Number(item.dataset.line));
      };
  }

  // Module: viewer/names.ts

  // File names: checks, where an edit goes, another name (edited text: saved so; read only: a copy)

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
  function nameProblem(name) {
      if (!name.trim()) return 'Please enter a file name.';
      if (name !== name.trim()) return 'A file name may not start or end with a space.';
      if (BAD_CHARS.test(name)) return 'A file name may not contain any of " * : < > ? / \\ |';
      if (name.endsWith('.')) return 'A file name may not end with a full stop.';
      if (RESERVED.test(name) || name.startsWith('~$') || /_vti_/i.test(name))
          return `SharePoint does not allow the name "${name}".`;
      return '';
  }

  /** @returns why the name does not suit a text (new file, edited text); '' if it does */
  function textNameProblem(name) {
      if (readerOf(formatOf(name)) === 'text' && !BINARY_RE.test(name)) return '';
      const ext = name.slice(name.lastIndexOf('.'));
      return `A ${ext} file is not plain text: please choose a text format (e.g. .txt, .csv, .json, .md).`;
  }

  /** @returns same name for SharePoint (it ignores case) */
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

  /** @param name another name (null: the file's own) @returns where the edit of the open file goes */
  function target(v, name = v.newName ?? null) {
      const url = v.file?.url ?? '';
      const own = v.file?.name ?? '';
      const to = name ?? own;
      const isNew = !!v.source?.fresh || !sameName(to, own);
      return { name: to, url: `${url.slice(0, url.lastIndexOf('/'))}/${to}`, isNew };
  }

  /** Asks for the name of a new file in `folder` (checked; a name there already: asked) @returns name, or null */
  async function askName(folder) {
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
  async function nameFree(t) {
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
  const renamable = (v) => !!(v.file && !v.linked && !v.busy && (v.writeMode || !canWrite(v)));

  /** Title shows the name the edit goes to (files reached through a link keep their path) */
  function showName(v) {
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
  function startRename(v) {
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
  async function copyAs(v, t) {
      const file = v.file;
      if (!file || !uploadable(v) || !confirm(uploadQuestion(v, t, (await fileStamp(t.url)) != null))) return;
      let blob;
      try {
          const r = await fetch(encodePath(file.url), { credentials: 'same-origin', cache: 'reload' });
          if (!r.ok) throw new Error(`error ${r.status}`);
          blob = await r.blob();
      } catch (err) {
          return void alert(`The file could not be read: ${(err).message}`);
      }
      const copy = new File([blob], t.name, { type: blob.type, lastModified: Date.now() });
      if ((await uploadFile(v, copy, t)) && v.file === file) showFile(t.name, t.url, true);
  }

  /** @returns text for the question before an upload under another name */
  function uploadQuestion(v, t, exists) {
      const what = exists
          ? `"${t.name}" already exists in this folder and will be replaced.`
          : `A new file "${t.name}" will be uploaded.`;
      const original = v.source?.fresh ? '' : `\nThe original "${v.file?.name}" stays unchanged.`;
      return `${what}${original}\n\nUpload now?`;
  }

  // Module: ui/picker.ts

  // Drop-down with several lists side by side (e.g. sheets and tables of a workbook):
  // ← → (or the tabs) switch the list shown, ↑ ↓ move, Enter picks, Esc closes

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Button (shows the entry chosen) and its menu; the menu opens above the button, inside `host`
  /** @param host positioned element the menu is placed in */
  function createPicker(host, onPick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tp-picker';
      button.hidden = true;
      button.setAttribute('aria-haspopup', 'listbox');
      const menu = document.createElement('div');
      menu.className = 'tp-picker-menu';
      menu.hidden = true;
      menu.tabIndex = -1;
      host.append(menu);

      let lists = [];
      let chosen = { list: 0, item: 0 };
      let shown = 0; // list shown in the menu
      let active = 0; // entry marked for the keyboard

      const show = (list) => {
          shown = (list + lists.length) % lists.length;
          active = shown === chosen.list && chosen.item >= 0 ? chosen.item : lists[shown].start;
          draw();
      };

      const draw = () => {
          const tabs = lists
              .map((l, i) => {
                  const count = l.items.length.toLocaleString();
                  return `<button type="button" class="tp-picker-tab" data-list="${i}" aria-pressed="${i === shown}">${esc(l.label)} <span>${count}</span></button>`;
              })
              .join('');
          const { items, empty } = lists[shown];
          const rows = items.map((x, i) => {
              const marks = [i === active && 'tp-active', shown === chosen.list && i === chosen.item && 'tp-chosen'];
              const cls = marks.filter(Boolean).join(' ');
              const title = x.title ? ` title="${esc(x.title)}"` : '';
              return `<button type="button" class="tp-picker-item ${cls}" role="option" data-item="${i}"${title}>${esc(x.text)}</button>`;
          });
          const body = rows.length ? rows.join('') : `<div class="tp-picker-empty">${esc(empty)}</div>`;
          const head = `<button type="button" class="tp-picker-step" data-step="-1" title="Previous list (←)">‹</button>${tabs}<button type="button" class="tp-picker-step" data-step="1" title="Next list (→)">›</button>`;
          menu.innerHTML = `<div class="tp-picker-head">${head}</div><div class="tp-picker-list" role="listbox">${body}</div>`;
          menu.querySelector('.tp-active')?.scrollIntoView({ block: 'nearest' });
      };

      const close = () => {
          menu.hidden = true;
          button.setAttribute('aria-expanded', 'false');
          document.removeEventListener('pointerdown', outside, true);
      };
      const outside = (e) => {
          const t = e.target;
          if (!menu.contains(t) && !button.contains(t)) close();
      };
      const open = () => {
          // above the button, right edges aligned; not higher than the viewer (else the page covers it): list scrolls
          const b = button.getBoundingClientRect();
          const h = host.getBoundingClientRect();
          const top = host.parentElement?.getBoundingClientRect().top ?? 0;
          menu.style.right = `${Math.round(h.right - b.right)}px`;
          menu.style.bottom = `${Math.round(h.bottom - b.top + 4)}px`;
          menu.style.maxHeight = `min(60vh, 340px, ${Math.max(120, Math.round(b.top - top - 8))}px)`;
          menu.hidden = false;
          button.setAttribute('aria-expanded', 'true');
          show(chosen.list);
          menu.focus();
          document.addEventListener('pointerdown', outside, true);
      };
      const pick = (list, item) => {
          close();
          button.focus();
          if (list !== chosen.list || item !== chosen.item) onPick(list, item);
      };

      button.onclick = () => (menu.hidden ? open() : close());
      menu.onclick = (e) => {
          const t = (e.target).closest('[data-list], [data-step], [data-item]');
          if (!(t instanceof HTMLElement)) return;
          if (t.dataset.list) show(Number(t.dataset.list));
          else if (t.dataset.step) show(shown + Number(t.dataset.step));
          else pick(shown, Number(t.dataset.item));
          if (!menu.hidden) menu.focus();
      };
      menu.onkeydown = (e) => {
          const n = lists[shown].items.length;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') show(shown + (e.key === 'ArrowLeft' ? -1 : 1));
          else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && n) {
              active = (active + (e.key === 'ArrowUp' ? -1 : 1) + n) % n;
              draw();
          } else if (e.key === 'Home' && n) {
              active = 0;
              draw();
          } else if (e.key === 'End' && n) {
              active = n - 1;
              draw();
          } else if (e.key === 'Enter' && n) pick(shown, active);
          else if (e.key === 'Escape' || e.key === 'Tab') {
              close();
              button.focus();
          } else return;
          e.preventDefault();
      };
      button.onkeydown = (e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          open();
      };

      return {
          button,
          menu,
          // New lists and the entry chosen (item -1: none yet); label: text of the button
          set(next, choice, label, title) {
              lists = next;
              chosen = choice;
              button.textContent = `${label} ▾`;
              button.title = title;
              if (!menu.hidden) show(shown);
          },
          close,
      };
  }

  // Module: viewer/status.ts

  // Status: busy state, progress, cache bar

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Busy (cache in progress): drives stop button
  function setBusy(v, on) {
      v.busy = on;
      v.stopBtn.disabled = !on && !v.writeMode;
      if (!on) showCached(v);
  }

  // Cache progress (bottom left): bar and "42% (1.2 MB of 2.9 MB)
  // Idle: how much of the open file is cached; greyed without file
  function showCached(v) {
      const src = v.source;
      if (!src) {
          showProgress(v, 0, 1);
          v.progressText.textContent = 'nothing cached';
          v.progress.classList.add('tp-off');
          return;
      }
      const total = src.total || (src.done ? src.loaded : 0);
      // all bytes here (Parquet: also when not all rows are shown yet)
      const full = src.done || (total > 0 && src.loaded >= total);
      showProgress(v, full ? total : src.loaded, total);
      v.progressText.textContent = full ? `fully cached (${formatBytes(total)})` : `${v.progressText.textContent} cached`;
      // calm colour when nothing runs: blue only while caching
      v.progress.classList.toggle('tp-full', full); // only when truly complete (% is floored)
      v.progress.classList.toggle('tp-idle', !full);
      if (!full && !v.loadAllBtn.disabled) {
          const icon = LOAD_ALL_SVG.replace(/\s+/g, ' ').trim();
          v.progressText.insertAdjacentHTML(
              'beforeend',
              ` · Click <span class="tp-inline-icon tp-click" title="Cache the whole file">${icon}</span> to fully cache file`,
          );
          (v.progressText.querySelector('.tp-click')).onclick = () => v.loadAllBtn.click(); // written above
      }
  }

  // Note in place of the cache state (e.g. upload under way); showCached() brings the cache state back
  function showStatus(v, text) {
      v.progress.classList.remove('tp-off', 'tp-full', 'tp-idle');
      v.progressBar.style.display = 'none';
      v.progressText.textContent = text;
  }

  function showProgress(v, loaded, total) {
      const share = total ? Math.min(1, loaded / total) : 0;
      v.progress.classList.remove('tp-off', 'tp-full', 'tp-idle');
      v.progressFill.style.width = `${(share * 100).toFixed(1)}%`;
      v.progressBar.style.display = total ? '' : 'none';
      v.progressText.textContent = total
          ? `${Math.floor(share * 100)}% (${formatBytes(loaded)} of ${formatBytes(total)})`
          : `Caching … ${formatBytes(loaded)}`;
  }

  // Module: viewer/views.ts

  // Views: text, table, sheet choice and colours

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Preview (view switch, right of Text): one per file type; its look follows the file shown
  const PREVIEWS = {
      table: { svg: TABLE_SVG, label: 'Table', title: 'Table view (CSV, Parquet, spreadsheets)' },
      '3d': { svg: CUBE_SVG, label: '3D', title: '3D view (IFC, IFCZIP)' },
      md: { svg: MARKDOWN_SVG, label: 'Markdown', title: 'Markdown view' },
  };
  const LOG_TABLE_TITLE = 'Table view (experimental: fields guessed from the lines of the log)';

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // Preview of a language (as in Viewer.lang); null: text only
  function previewOf(lang) {
      if (lang === 'csv' || lang === 'parquet' || lang === 'sheet' || lang === 'log') return 'table';
      if (lang === 'ifc') return '3d';
      if (lang === 'md') return 'md';
      return null;
  }

  // Logs: own choice, read only, only while fields were found (preview enabled)
  const tableView = (v) =>
      v.lang === 'log'
          ? view.logTable && !v.writeMode && !v.previewBtn.disabled
          : previewOf(v.lang) === 'table' && view.table;

  // View choice (prefs key in `view`) behind the Preview of a file type
  const viewKey = (v, key) =>
      key === 'table' && v.lang === 'log' ? 'logTable' : key;

  // Markdown shown rendered (not while edited: the editor shows its text)
  const markdownView = (v) => v.lang === 'md' && view.markdown && !v.writeMode;

  // Preview button for a file type: icon, label, tooltip; `reason` (or no preview): disabled
  function setPreview(v, kind, reason = '') {
      const p = kind ? PREVIEWS[kind] : null;
      const label = p ? p.label : 'Preview';
      v.previewBtn.innerHTML = `${p ? p.svg : EYE_FULL_SVG}<span>${label}</span>`;
      v.previewBtn.disabled = !p || !!reason;
      const title = kind === 'table' && v.lang === 'log' ? LOG_TABLE_TITLE : p?.title;
      v.previewBtn.title = reason || title || 'No preview for this file type';
  }

  // Colour choice of view shown: text, table (CSV / Parquet), sheet or log (spreadsheets, logs: own choice)
  function colourKey(v) {
      if (!tableView(v)) return 'text';
      return v.lang === 'sheet' || v.lang === 'log' ? v.lang : 'table';
  }

  // View switch state (pressed = current view: Text or Preview) and idle cache bar
  function updateViews(v) {
      const preview = !!v.view3d || tableView(v) || markdownView(v);
      const shown = !!v.source && !v.source.deferred; // content on screen
      v.textBtn.disabled = !shown;
      v.textBtn.setAttribute('aria-pressed', String(shown && !preview));
      v.previewBtn.setAttribute('aria-pressed', String(preview && !v.previewBtn.disabled));
      if (!v.busy) showCached(v);
  }

  // Colours on in view now shown
  function colourOn(v) {
      return colourPrefs[colourKey(v)];
  }

  // Format (status bar, left of the text size): recognised from the file name or chosen by the user;
  // its menu lists text formats and file formats side by side (null: no file, hidden)
  function showFormat(v, format, recognised = format ?? '') {
      v.formatPicker.button.hidden = !format;
      if (!format) {
          v.formatPicker.close();
          return;
      }
      const lists = FORMAT_LISTS.map(([label, keys]) => ({
          label,
          items: keys.map((k) => ({ text: k === recognised ? `${formatName(k)} (recognised)` : formatName(k) })),
          empty: '',
          start: Math.max(0, keys.indexOf(recognised)),
      }));
      const list = Math.max(
          0,
          FORMAT_LISTS.findIndex(([, keys]) => keys.includes(format)),
      );
      const item = FORMAT_LISTS[list][1].indexOf(format);
      const chosen = format !== recognised;
      const name = formatName(format);
      const how = chosen ? `chosen; recognised: ${formatName(recognised)}` : 'recognised from the file name';
      v.formatPicker.set(lists, { list, item }, name, `Format: ${name} (${how}). View the file as another format`);
      v.formatPicker.button.classList.toggle('tp-chosen', chosen);
  }

  // Sheet or table choice (spreadsheets only): picker next to table button, name in title.
  // Its menu lists sheets and tables side by side (● cached, ○ not cached yet).
  function showSheets(v, src) {
      const lists = src?.isSheet ? sheetLists(src) : null;
      v.sheetPicker.button.hidden = !lists;
      v.titleSheet.hidden = !lists;
      if (!lists || !src?.isSheet) {
          v.sheetPicker.close();
          return;
      }
      const tables = src.mode === 'tables';
      const list = lists[tables ? 1 : 0];
      const kind = tables ? 'Table' : 'Sheet';
      const counts = `${src.sheets.length} sheets, ${src.tables.length} tables`;
      const keys = '← → in the menu: sheets or tables';
      if (src.waiting) {
          // large file: nothing shown until chosen
          v.titleSheet.hidden = true;
          const choice = { list: tables ? 1 : 0, item: -1 };
          v.sheetPicker.set(lists, choice, 'Select sheet or table', `${counts}; ${keys}`);
          return;
      }
      const name = tables ? src.tables[src.current].name : src.sheets[src.current].name;
      const title = `${kind} ${src.current + 1} of ${list.items.length} (${counts}; ${keys})`;
      v.sheetPicker.set(lists, { list: tables ? 1 : 0, item: src.current }, name, title);
      v.titleSheet.innerHTML = ` · <strong>${kind}:</strong> ${esc(name)}`;
  }

  // Lists of the picker: sheets (hidden and chart sheets marked), tables (with their sheet)
  function sheetLists(src) {
      const { sheets, tables } = src;
      const mark = (s) => (s.data === undefined ? '○' : '●');
      return [
          {
              label: 'Sheets',
              items: sheets.map((s) => {
                  const notes = [s.hidden && 'hidden', s.kind !== 'sheet' && s.kind].filter(Boolean).join(', ');
                  const suffix = notes ? ` (${notes})` : '';
                  return { text: `${mark(s)} ${s.name}${suffix}` };
              }),
              empty: 'No sheets',
              start: src.startOf('sheets'),
          },
          {
              label: 'Tables',
              items: tables.map((t) => ({ text: `${mark(sheets[t.sheet])} ${t.name} (${sheets[t.sheet].name})` })),
              empty: src.tablesRead ? 'No tables in this file' : 'Tables are not read from this format',
              start: src.startOf('tables'),
          },
      ];
  }

  // Module: viewer/view3d.ts

  // 3D view (IFC / IFCZIP), ifc-lite from VIEWER_3D_FOLDER on first use, SHA-256 checked.
  // Model stays in browser.

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  let ifcLibrary = null; // once started
  let ifcLibraryReady = false; // loaded (then IFC files open in 3D again if it was chosen)
  const view3dPoses = new Map(); // file url -> camera of its last 3D view (while this page is open)

  // ===========================================================================
  // METHODS
  // ===========================================================================

  async function sha256(buf) {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
      return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Library (once per page)
  function loadIfcLibrary(onStatus) {
      if (ifcLibrary) return ifcLibrary;
      const loading = (async () => {
          if (!VIEWER_3D_FOLDER) throw new Error('the 3D viewer folder is not set (settings: "3D viewer folder")');
          const file = async (name, hash) => {
              if (!/^[0-9a-f]{64}$/.test(hash))
                  throw new Error('no 3D checksums in this build: use a release userscript');
              const site = (location.pathname.match(/^\/(?:sites|teams|personal)\/[^/]+/i) || [''])[0]; // current site
              const folder = VIEWER_3D_FOLDER.startsWith('/') ? VIEWER_3D_FOLDER : `${site}/${VIEWER_3D_FOLDER}`;
              const url = encodePath(`${folder.replace(/\/$/, '')}/${name}`);
              if (!sameOrigin(url)) throw new Error('the 3D viewer folder must be in this SharePoint');
              onStatus(`caching ${name} …`);
              const res = await fetch(url, { credentials: 'same-origin' });
              if (!res.ok) throw new Error(`${name}: error ${res.status}`);
              const buf = await res.arrayBuffer();
              if ((await sha256(buf)) !== hash) throw new Error(`${name} does not match its checksum: not used`);
              return buf;
          };
          const [js, wasm] = await Promise.all([
              file('ifc-lite-3d.js', VIEWER_3D_JS_SHA256),
              file('ifc-lite_bg.wasm', VIEWER_3D_WASM_SHA256),
          ]);
          // Read IfcLite back in same function (sandbox may have another global)
          const lib = new Function(`${new TextDecoder().decode(js)}\n;return globalThis.IfcLite;`)();
          if (!lib) throw new Error('3D library did not start');
          ifcLibraryReady = true;
          return { lib, wasm: new Uint8Array(wasm) };
      })();
      loading.catch(() => {
          ifcLibrary = null; // later click tries again
      });
      ifcLibrary = loading;
      return loading;
  }

  // IFC bytes in canvas; returns { pose(), dispose() }
  async function open3dModel(
      lib,
      wasm,
      canvas,
      ifcBytes,
      onStatus,
      pose,
  ) {
      onStatus('3D engine start …');
      lib.ready ||= lib.init({ module_or_path: wasm }); // once per page
      await lib.ready;
      // Canvas in CSS pixels, width multiple of 64 (WebGPU), set before renderer starts
      const size = () => {
          const r = canvas.getBoundingClientRect();
          return [
              Math.min(8192, Math.max(64, Math.floor(r.width / 64) * 64)),
              Math.min(8192, Math.max(1, Math.floor(r.height))),
          ];
      };
      [canvas.width, canvas.height] = size();
      const renderer = new lib.Renderer(canvas);
      const geometry = new lib.GeometryProcessor();
      // Retry: right after release browser may refuse new GPU device
      const startRenderer = async () => {
          for (let attempt = 1; ; attempt++) {
              try {
                  return await renderer.init();
              } catch (err) {
                  if (attempt >= 5) throw err;
                  await new Promise((r) => setTimeout(r, 200 * attempt));
              }
          }
      };
      await Promise.all([startRenderer(), geometry.init()]);
      onStatus('geometry build …');
      const result = await geometry.process(ifcBytes);
      renderer.loadGeometry(result);
      const camera = renderer.getCamera();
      // Whole model in view (bounds after ifc-lite's shift of far-off coordinates)
      const fit = () => {
          const b = result.coordinateInfo?.shiftedBounds;
          const extent = b && Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
          if (extent > 0 && Number.isFinite(extent)) {
              camera.fitBoundsAdaptive(
                  { min: b.min, max: b.max },
                  { viewportShortPx: Math.min(canvas.width, canvas.height) },
              );
          } else renderer.fitToView();
          renderer.requestRender();
      };
      fit();
      if (pose) {
          // view this file had when it was last shown
          camera.setPosition(pose.position.x, pose.position.y, pose.position.z);
          camera.setTarget(pose.target.x, pose.target.y, pose.target.z);
          camera.setUp(pose.up.x, pose.up.y, pose.up.z);
          renderer.requestRender();
      }
      onStatus(`${result.meshes.length.toLocaleString()} objects · ${result.totalTriangles.toLocaleString()} triangles`);

      let drag = null;
      const down = (e) => {
          drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
          canvas.setPointerCapture(e.pointerId);
      };
      const move = (e) => {
          if (!drag) return;
          const dx = e.clientX - drag.x;
          const dy = e.clientY - drag.y;
          drag.x = e.clientX;
          drag.y = e.clientY;
          if (drag.pan) camera.pan(dx, dy);
          else camera.orbit(dx, dy);
          renderer.requestRender();
      };
      const up = () => {
          drag = null;
      };
      const wheel = (e) => {
          e.preventDefault();
          const r = canvas.getBoundingClientRect();
          camera.zoom(e.deltaY, false, e.clientX - r.left, e.clientY - r.top, canvas.width, canvas.height);
          renderer.requestRender();
      };
      const noMenu = (e) => e.preventDefault();
      const resize = new ResizeObserver(() => {
          renderer.resize(...size());
          renderer.requestRender();
      });
      resize.observe(canvas);

      // Draw loop: renders when asked to, and while camera still moves (inertia)
      let last = performance.now();
      let frame = 0;
      const loop = (now) => {
          const moving = camera.update(now - last);
          last = now;
          if (renderer.consumeRenderRequest() || moving) renderer.render();
          frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);

      // Listeners on the canvas (removed again on dispose)
      const offs = [];
      const on = (
          type,
          fn,
          opts,
      ) => {
          canvas.addEventListener(type, fn, opts);
          offs.push(() => canvas.removeEventListener(type, fn));
      };
      on('pointerdown', down);
      on('pointermove', move);
      on('pointerup', up);
      on('pointercancel', up);
      on('wheel', wheel, { passive: false });
      on('dblclick', fit);
      on('contextmenu', noMenu);
      return {
          pose: () => ({
              position: { ...camera.getPosition() },
              target: { ...camera.getTarget() },
              up: { ...camera.getUp() },
          }),
          dispose() {
              cancelAnimationFrame(frame);
              resize.disconnect();
              for (const off of offs) off();
              renderer.destroy();
          },
      };
  }

  // Switch 3D view on / off for open IFC file
  async function toggle3d(v) {
      if (v.view3d) return close3d(v);
      const src = v.source;
      if (!src || v.previewBtn.disabled) return;
      if (!(navigator).gpu) {
          alert('3D view needs WebGPU (current Chrome or Edge).');
          return;
      }
      if (v.writeMode && v.dirty) {
          alert('Please save your changes first, then switch the view.');
          return void flash(v.saveBtn);
      }
      if (!src.done && !(await v.loadAll?.())) return; // 3D view needs whole file
      if (!src.done) return;
      if ((src.ifcBytes ? src.ifcBytes.length : src.text.length) > MAX_3D_BYTES) {
          alert(`3D view: only for IFC files up to ${formatBytes(MAX_3D_BYTES)}.`);
          return;
      }
      const file = v.file;
      if (!file) return;
      const state = {
          disposed: false,
          handle: null,
      };
      v.view3d = state;
      updateViews(v);
      v.content.style.display = 'none';
      v.editorWrap.style.display = 'none';
      v.loadMoreBtn.style.display = 'none';
      v.stage3d.style.display = 'block';
      const status = (s) => {
          v.status3d.textContent = s;
      };
      try {
          const { lib, wasm } = await loadIfcLibrary(status);
          if (state.disposed || v.file !== file) return;
          const bytes = src.ifcBytes || new TextEncoder().encode(v.writeMode ? (v.staged ?? src.text) : src.text);
          const handle = await open3dModel(lib, wasm, v.canvas3d, bytes, status, view3dPoses.get(file.url));
          if (state.disposed) handle.dispose();
          else state.handle = handle;
      } catch (err) {
          if (!state.disposed) status(`3D view failed: ${(err).message}`);
      }
  }

  function close3d(v) {
      const state = v.view3d;
      if (!state) return;
      state.disposed = true;
      if (state.handle && v.file) view3dPoses.set(v.file.url, state.handle.pose()); // for next time
      state.handle?.dispose();
      v.view3d = null;
      updateViews(v);
      v.stage3d.style.display = 'none';
      v.status3d.textContent = '';
      if (v.writeMode && !v.tableEditing) v.editorWrap.style.display = '';
      else v.content.style.display = '';
      v.rerender?.();
  }

  // Module: viewer/panel.ts

  // Viewer panel: elements, buttons, editor and gutter

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Preferences of the views switched by Text / Preview
  const VIEW_KEYS = {
      table: 'tp-preview-table',
      logTable: 'tp-preview-log-table',
      markdown: 'tp-preview-markdown',
  };

  const ZOOM_STEP = 0.1;
  const WHEEL_STEP = 40; // wheel distance per zoom step (mouse notch ~100, touchpad pinch: small steps)

  const SQUARE_BTN_CSS = `
    position: absolute;
    z-index: 1;
    width: 30px;
    height: 30px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  `;

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function createViewer() {
      // Dark backdrop (popup mode only)
      const backdrop = document.createElement('div');
      backdrop.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.5);
      z-index: 2147483000; /* above SharePoint's own panels (settings, details, ...) */
    `;

      // Panel
      const box = document.createElement('div');
      box.className = `tp-viewer tp-${view.theme}`;

      // Header bar
      const header = document.createElement('div');
      header.className = 'tp-header';
      header.style.cssText = `
      position: relative;
      flex: none;
      height: 94px;
    `;

      // Header buttons
      const ROW1 = 8;
      const button = (
          svg,
          title,
          left,
          top = ROW1,
          { disabled = false, pressed } = {},
      ) => {
          const btn = document.createElement('button');
          btn.className = 'tp-mode-btn';
          btn.innerHTML = svg;
          btn.title = title;
          btn.disabled = disabled;
          if (pressed !== undefined) btn.setAttribute('aria-pressed', String(pressed));
          btn.style.cssText = `${SQUARE_BTN_CSS} left: ${left}px; top: ${top}px;`;
          return btn;
      };
      // Main row: [layout ▾] [edit] [cache all] [stop] [save] [upload] (i) File: name [table] [3D] … [⋯] [copy] [✕]
      const layoutBtn = button(SPLIT_H_SVG, 'Layout: below the list / right of the list / popup', 10);
      const writeBtn = button(WRITE_SVG, 'Edit (text files only)', 46, ROW1, { disabled: true, pressed: false });
      const loadAllBtn = button(LOAD_ALL_SVG, 'Cache the whole file', 82, ROW1, { disabled: true });
      const stopBtn = button(STOP_SVG, 'Stop caching', 118, ROW1, { disabled: true }); // also: cancel changes
      const saveBtn = button(SAVE_SVG, 'Save: keep the changes, ready for upload (Ctrl+S)', 154, ROW1, {
          disabled: true,
      });
      const uploadBtn = button(UPLOAD_SVG, 'Upload the saved changes to SharePoint', 190, ROW1, { disabled: true });
      // View switch (status bar, bottom right): Text | Preview (Table, 3D or Markdown, by file type)
      const viewBtn = (svg, label, title) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tp-view-btn';
          b.innerHTML = `${svg}<span>${label}</span>`;
          b.title = title;
          b.disabled = true;
          b.setAttribute('aria-pressed', 'false');
          return b;
      };
      const textBtn = viewBtn(TEXT_SVG, 'Text', 'Text view');
      const previewBtn = viewBtn('', 'Preview', ''); // look set per file (setPreview)
      const moreBtn = button(MORE_SVG, 'More', 0);
      moreBtn.style.left = '';
      moreBtn.style.right = '86px';

      // Menu entries (icon + label); toggles show check mark when on
      const item = (svg, label, opts) => {
          const b = button(svg, label, 0, 0, opts);
          b.className = 'tp-menu-item';
          b.style.cssText = '';
          b.innerHTML = `${svg}<span>${label}</span>`;
          return b;
      };
      const hBtn = item(SPLIT_H_SVG, 'Below the list');
      const vBtn = item(SPLIT_V_SVG, 'Right of the list');
      const pBtn = item(POPUP_SVG, 'Popup');
      const themeBtn = item(THEME_SVG, 'Dark mode', { pressed: view.theme === 'dark' });
      const colourBtn = item(COLOUR_SVG, 'Syntax colours');
      const wrapBtn = item(WRAP_SVG, 'Wrap long lines');
      const refreshBtn = item(REFRESH_SVG, 'Reload this file');
      const clearBtn = item(CLEAR_SVG, 'Clear this file from the cache', { disabled: true });
      const clearAllBtn = item(CLEAR_SVG, 'Clear all files from the cache', { disabled: memoryCache.size === 0 });
      const settingsBtn = item(SETTINGS_SVG, 'Full settings …');
      const newItem = item(NEW_FILE_SVG, 'New file …');

      // Small drop-down under its button; closes on any click outside or on entry
      const menu = (anchor, entries, alignRight = false) => {
          const m = document.createElement('div');
          m.className = 'tp-menu';
          m.hidden = true;
          m.append(...entries);
          const close = () => {
              m.hidden = true;
              document.removeEventListener('pointerdown', outside, true);
          };
          const outside = (e) => {
              const t = e.target;
              if (!m.contains(t) && !anchor.contains(t)) close();
          };
          anchor.onclick = () => {
              if (!m.hidden) return close();
              m.style.top = `${anchor.offsetTop + anchor.offsetHeight + 4}px`;
              if (alignRight) m.style.right = anchor.style.right;
              else m.style.left = `${anchor.offsetLeft}px`;
              m.hidden = false;
              document.addEventListener('pointerdown', outside, true);
          };
          m.addEventListener('click', (e) => {
              if ((e.target).closest('.tp-menu-item')) close();
          });
          return m;
      };
      const layoutMenu = menu(layoutBtn, [hBtn, vBtn, pBtn]);
      const moreMenu = menu(
          moreBtn,
          [newItem, settingsBtn, themeBtn, colourBtn, wrapBtn, refreshBtn, clearBtn, clearAllBtn],
          true,
      );

      // Title: file name, with small note below it
      const title = document.createElement('div');
      title.className = 'tp-title tp-well';
      title.style.cssText = `
      position: absolute;
      top: 8px;
      height: 30px;
      left: 232px;
      right: 256px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 6px;
      text-align: left;
      font-family: sans-serif;
    `;
      title.innerHTML = `
      <div style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; line-height:18px; margin-right:4px">
        <strong>File:</strong> <span class="tp-title-name"></span><span class="tp-title-sheet" hidden></span>
      </div>
    `;
      // Properties on/off: small (i) button in the title well, left of "File:"
      const propsBtn = button(PROPS_SVG, 'Display file metadata and properties', 0, 0, { pressed: view.props });
      propsBtn.style.cssText = `
      flex: none;
      width: 24px;
      height: 24px;
      margin-left: -6px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;
      title.prepend(propsBtn);
      // New file: in the title well while no file is open (also in the ⋯ menu)
      const newBtn = document.createElement('button');
      newBtn.type = 'button';
      newBtn.className = 'tp-new-file';
      newBtn.innerHTML = `${NEW_FILE_SVG}<span>New file</span>`;
      newBtn.title = 'Create a new file in the folder open in SharePoint';
      newBtn.hidden = true;
      title.append(newBtn);
      // Note: tooltip on header
      header.title =
          'Note: this viewer is primarily for text files. Parquet files and spreadsheets may also be viewed (read only). ' +
          'Text files can be edited.';
      const titleName = title.querySelector('.tp-title-name'); // in the title's HTML
      titleName.onclick = () => startRename(v); // text: write mode only; read-only files: a copy
      const titleSheet = title.querySelector('.tp-title-sheet');

      // Metadata (second line, full width): dates, size, format, table shape, ...
      const metaLine = document.createElement('div');
      metaLine.className = 'tp-title';
      metaLine.style.cssText = `
      position: absolute;
      top: 44px;
      left: 12px;
      right: 12px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical; /* wraps, cut off with "…" after the lines shown */
      line-height: 15px;
      white-space: normal;
      font: 12px/15px sans-serif;
      opacity: .85;
    `;

      // Version and logo (top right, left of copy button)
      const brand = document.createElement('div');
      brand.className = 'tp-title';
      brand.style.cssText = `
      position: absolute;
      top: 8px;
      height: 30px;
      right: 124px;
      max-width: 124px;
      display: flex;
      align-items: center;
      gap: 8px;
      font: 11px sans-serif;
      opacity: .75;
      white-space: nowrap;
    `;
      // NOTE: not `!== 'undefined'`: minified to `GM_info<"u"`, which editors read as type arguments (brackets then mismatch)
      const version = typeof GM_info === 'object' ? GM_info.script.version : '';
      const logo = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(LOGO) ? LOGO.replace(/\s+/g, '') : '';
      const logoHtml = logo ? `<img src="${logo}" alt="" style="height:18px; width:auto; display:block">` : '';
      const versionHtml = version ? `<span>v${esc(version)}</span>` : '';
      brand.innerHTML = `
      ${logoHtml}
      ${versionHtml}
    `;
      brand.title = version ? `Sharepoint Previewer v${version}` : 'Sharepoint Previewer';

      // Copy button (left of X)
      const copyBtn = document.createElement('button');
      copyBtn.innerHTML = COPY_SVG;
      copyBtn.title = 'Copy';
      copyBtn.style.cssText = `${SQUARE_BTN_CSS} top: 8px; right: 48px; background: #0078d4; color: #fff;`;

      // Close button (red X, top right)
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.title = 'Close (Esc)';
      closeBtn.style.cssText = `
      ${SQUARE_BTN_CSS}
      top: 8px;
      right: 10px;
      background: #d13438;
      color: #fff;
      font: bold 15px sans-serif;
    `;

      // Metadata height: one line at first; drag grip below it to show more lines
      const metaGrip = document.createElement('div');
      metaGrip.className = 'tp-meta-grip';
      metaGrip.title = 'Drag to show more or fewer lines';
      const setMetaLines = (n) => {
          view.metaLines = Math.max(1, Math.min(6, n));
          savePref('tp-preview-meta-lines', String(view.metaLines));
          const h = view.props ? view.metaLines * 15 : -4; // hidden: header ends under buttons
          metaLine.style.display = view.props ? '' : 'none';
          metaGrip.style.display = view.props ? '' : 'none';
          propsBtn.setAttribute('aria-pressed', String(view.props));
          metaLine.style.height = `${h}px`;
          metaLine.style.webkitLineClamp = String(view.metaLines);
          header.style.setProperty('--tp-lint-top', `${44 + h + 4}px`); // not on lint: its style is observed
          const lintShown = lint.style.display !== 'none' && lint.style.display !== '';
          header.style.height = `${44 + h + 6 + (lintShown ? 18 : 0)}px`; // room for check line only when shown
      };
      metaGrip.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const startY = e.clientY;
          const start = view.metaLines;
          metaGrip.setPointerCapture(e.pointerId);
          metaGrip.classList.add('tp-drag');
          const move = (ev) => setMetaLines(start + Math.round((ev.clientY - startY) / 15));
          const up = () => {
              metaGrip.classList.remove('tp-drag');
              metaGrip.removeEventListener('pointermove', move);
              metaGrip.removeEventListener('pointerup', up);
              metaGrip.removeEventListener('pointercancel', up);
          };
          metaGrip.addEventListener('pointermove', move);
          metaGrip.addEventListener('pointerup', up);
          metaGrip.addEventListener('pointercancel', up);
      });
      metaGrip.ondblclick = () => setMetaLines(view.metaLines > 1 ? 1 : 6); // quick open / close

      header.append(
          layoutBtn,
          writeBtn,
          loadAllBtn,
          stopBtn,
          saveBtn,
          uploadBtn,
          title,
          metaLine,
          metaGrip,
          brand,
          moreBtn,
          copyBtn,
          closeBtn,
          layoutMenu,
          moreMenu,
      );

      // Lint bar (only for xml / json / yaml / ifc)
      const lint = document.createElement('div');
      lint.className = 'tp-lint';
      lint.style.display = 'none';

      // Code view
      const content = document.createElement('div');
      content.className = 'tp-content';
      content.tabIndex = 0;

      // "Cache next" bar (bottom, only shown while file is not fully cached)
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.className = 'tp-load-more';
      loadMoreBtn.style.cssText = `
      display: none;
      flex: none;
      width: 100%;
      padding: 8px;
      cursor: pointer;
      font: 600 12px sans-serif;
    `;

      // Drag handle on edge next to list (split modes only)
      const splitter = document.createElement('div');
      splitter.className = 'tp-splitter';
      splitter.title = 'Drag to resize';
      splitter.onpointerdown = startDrag;

      header.append(lint); // below metadata line
      setMetaLines(view.metaLines);
      new MutationObserver(() => setMetaLines(view.metaLines)).observe(lint, {
          attributes: true,
          attributeFilter: ['style'],
      });

      // Write mode: whole file in editable text box with line numbers, framed in red
      const editorWrap = document.createElement('div');
      editorWrap.className = 'tp-editor-wrap';
      editorWrap.style.display = 'none';
      const gutter = document.createElement('pre');
      gutter.className = 'tp-gutter';
      const editor = document.createElement('textarea');
      editor.className = 'tp-editor';
      editor.spellcheck = false;
      editor.wrap = 'off'; // no wrap: line numbers stay next to their lines
      editorWrap.append(gutter, editor);

      // Line numbers follow text and its scroll
      let gutterQueued = false;

      const updateGutter = () => {
          gutterQueued = false;
          const n = editor.value.split('\n').length;
          if (Number(gutter.dataset.lines) === n) return;
          gutter.dataset.lines = String(n);
          gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
      };
      editor.addEventListener('input', () => {
          if (!gutterQueued) {
              gutterQueued = true;
              requestAnimationFrame(updateGutter);
          }
      });
      editor.addEventListener('scroll', () => {
          gutter.scrollTop = editor.scrollTop;
      });

      // Write mode in table view: delimiter and quote style for saved file
      const csvBar = document.createElement('div');
      csvBar.className = 'tp-csv-bar';
      const quoteOptions = Object.entries(QUOTE_MODES)
          .map(([k, t]) => `<option value="${k}">${t}</option>`)
          .join('');
      csvBar.innerHTML = `
      <select class="tp-csv-sep" title="Delimiter of the saved file"></select>
      <select class="tp-csv-quote" title="Quote style of the saved file">
        <option value="">Quotes: as in the file</option>
        ${quoteOptions}
      </select>`;
      // 3D view: canvas with status line (shown instead of text)
      const stage3d = document.createElement('div');
      stage3d.style.cssText = 'display:none; position:relative; flex:1; min-height:0; background:var(--tp-bg);';
      const canvas3d = document.createElement('canvas');
      canvas3d.style.cssText = 'display:block; width:100%; height:100%; touch-action:none; cursor:grab;';
      canvas3d.title = 'Drag: rotate · right drag or Shift + drag: move · wheel: zoom · double-click: fit';
      const status3d = document.createElement('div');
      status3d.style.cssText =
          'position:absolute; left:8px; bottom:6px; font:12px sans-serif; color:var(--tp-fg); opacity:.75; pointer-events:none;';
      stage3d.append(canvas3d, status3d);
      // Cache progress (bottom left)
      const progress = document.createElement('div');
      progress.className = 'tp-progress';
      progress.innerHTML = '<div class="tp-progress-bar"><div class="tp-progress-fill"></div></div><span></span>';
      // (children written just above)
      const progressBar = progress.firstElementChild;
      const progressFill = progressBar.firstElementChild;
      const progressText = progress.lastElementChild;
      // Status bar (fixed height): cache state left, view switch right
      const statusBar = document.createElement('div');
      statusBar.className = 'tp-statusbar';
      // Spreadsheets: sheet or table shown; its menu lists sheets and tables side by side
      const sheetPicker = createPicker(statusBar, (list, i) => v.selectSheet?.(i, list ? 'tables' : 'sheets'));
      const views = document.createElement('div');
      views.className = 'tp-views';
      views.append(textBtn, previewBtn, sheetPicker.button);
      // Format: recognised or chosen (any format can be chosen: its reader tries the file)
      const formatPicker = createPicker(statusBar, (list, i) => chooseFormat(FORMAT_LISTS[list][1][i]));
      const formatBar = document.createElement('div');
      formatBar.className = 'tp-views tp-format';
      formatBar.append(formatPicker.button);
      // Text size: − 100 % + (value: back to 100 %)
      const zoomBar = document.createElement('div');
      zoomBar.className = 'tp-views tp-zoom';
      zoomBar.innerHTML = `
      <button type="button" class="tp-view-btn" title="Smaller text (Ctrl −, Ctrl + wheel)">−</button>
      <button type="button" class="tp-view-btn tp-zoom-value" title="Text size: back to 100 % (Ctrl 0)"></button>
      <button type="button" class="tp-view-btn" title="Larger text (Ctrl +, Ctrl + wheel)">+</button>`;
      const [zoomOut, zoomValue, zoomIn] = [...zoomBar.children];
      statusBar.append(progress, formatBar, zoomBar, views);
      box.append(header, csvBar, content, stage3d, editorWrap, loadMoreBtn, statusBar, splitter);

      // Keep panel's events away from SharePoint's handlers (split mode: inside its DOM)
      for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown', 'keydown', 'keyup', 'contextmenu', 'wheel']) {
          box.addEventListener(type, (e) => e.stopPropagation());
      }

      const v = {
          backdrop,
          box,
          header,
          layoutBtn,
          hBtn,
          vBtn,
          pBtn,
          refreshBtn,
          loadAllBtn,
          stopBtn,
          clearBtn,
          clearAllBtn,
          saveBtn,
          uploadBtn,
          writeBtn,
          newBtn,
          textBtn,
          previewBtn,
          sheetPicker,
          formatPicker,
          stage3d,
          canvas3d,
          status3d,
          progress,
          progressBar,
          progressFill,
          progressText,
          editor,
          editorWrap,
          updateGutter,
          title,
          titleName,
          titleSheet,
          metaLine,
          csvBar,
          copyBtn,
          closeBtn,
          lint,
          content,
          loadMoreBtn,
          splitter,
          mode: 'popup',
          text: '',
          loadToken: 0,
          originalBodyStyle: document.body.getAttribute('style'),
      };
      setPreview(v, null);

      // Popup: drag header (not its buttons, menus or properties grip) to move window
      header.addEventListener('pointerdown', (e) => {
          if (v.mode !== 'popup' || e.button !== 0) return;
          if ((e.target).closest('button, select, input, textarea, a, .tp-menu, .tp-meta-grip, .tp-lint'))
              return;
          if (metaLine.contains(e.target)) return; // properties stay selectable
          startMove(e, box, POPUP_POS_KEY);
      });

      // Esc: open drop-down first, then edit (same as cancel), then viewer; settings form: its own
      const onEscape = (e) => {
          if (e.key !== 'Escape' || viewer !== v || document.querySelector('.tp-settings')) return;
          if ((e.target).classList?.contains('tp-name-input')) return; // name box: its own Esc
          e.stopPropagation();
          for (const p of [sheetPicker, formatPicker]) if (!p.menu.hidden) return void p.close();
          if (v.writeMode) return void cancelEdits(v);
          closeViewer();
      };

      // Window resized -> recompute horizontal split (it uses pixel positions)
      const onResize = () => {
          if (viewer === v && !v.selfResize && v.mode !== 'popup') layoutPage(v, v.mode);
      };
      document.addEventListener('keydown', onEscape, true);
      window.addEventListener('resize', onResize);
      v.removeListeners = () => {
          document.removeEventListener('keydown', onEscape, true);
          window.removeEventListener('resize', onResize);
      };

      backdrop.onclick = closeViewer;
      closeBtn.onclick = closeViewer;
      themeBtn.onclick = () => {
          view.theme = view.theme === 'dark' ? 'light' : 'dark';
          savePref(THEME_KEY, view.theme);
          box.classList.remove('tp-dark', 'tp-light');
          box.classList.add(`tp-${view.theme}`);
          themeBtn.setAttribute('aria-pressed', String(view.theme === 'dark'));
      };
      hBtn.onclick = () => v.mode !== 'horizontal' && setMode('horizontal');
      vBtn.onclick = () => v.mode !== 'vertical' && setMode('vertical');
      pBtn.onclick = () => v.mode !== 'popup' && setMode('popup');
      refreshBtn.onclick = () => v.file && showFile(v.file.name, v.file.url, true);
      stopBtn.onclick = () => {
          if (v.writeMode) return void cancelEdits(v); // in write mode: cancel all changes (asks first)
          if (!v.busy) return;
          v.userStopped = true;
          cancelLoad(v, true);
          setBusy(v, false);
      };
      clearBtn.onclick = () => v.file && clearCached(v);
      clearAllBtn.onclick = () => clearAllCached();
      settingsBtn.onclick = () => openSettingsForm();
      newBtn.onclick = () => newFile();
      newItem.onclick = () => newFile();
      writeBtn.onclick = () => (v.writeMode ? leaveWrite() : enterWrite(v));
      // 3D choice remembered for next IFC files (also across reloads)
      const set3d = (on) => {
          view.show3d = on;
          savePref('tp-preview-3d', on ? '1' : '0');
      };

      textBtn.onclick = () => {
          if (v.view3d) {
              set3d(false);
              close3d(v);
          }
          if (tableView(v)) showView('table', false);
          else if (markdownView(v)) showView('markdown', false);
          updateViews(v);
      };
      previewBtn.onclick = () => {
          const kind = previewOf(v.lang);
          if (kind === '3d' && !v.view3d) {
              set3d(true);
              toggle3d(v);
          } else if (kind === 'table' && !tableView(v)) showView('table', true);
          else if (kind === 'md' && !markdownView(v)) showView('markdown', true);
          updateViews(v);
      };
      // Table or Markdown view on / off (remembered for files of its type)
      const showView = (key, on) => {
          if (v.writeMode && v.dirty) {
              alert('Please save your changes first, then switch the view.');
              return void flash(saveBtn);
          }
          close3d(v); // back to text / table / Markdown
          const k = viewKey(v, key); // logs: own choice
          view[k] = on;
          savePref(VIEW_KEYS[k], on ? '1' : '0');
          applyColour(); // each view has its own colour choice
          if (!v.writeMode) return void v.rerender?.();
          exitWriteView(v); // Markdown, log table: shown from saved text, edit ends
          if (k === 'table') enterWrite(v); // edit on in other view (table <-> text), on saved text
      };
      // Back to read mode (edit button again): unsaved edits only after asking
      const leaveWrite = () => {
          if (!v.writeMode) return;
          if (v.dirty) {
              // only unsaved edits are at stake here; saved changes stay
              flash(saveBtn);
              if (!confirm('You have unsaved changes. Discard them?')) return void flash(saveBtn);
          }
          exitWriteView(v);
      };
      // Save stages edits; upload hands saved state to SharePoint
      saveBtn.onclick = () => {
          const src = v.source;
          if (!v.writeMode || !v.dirty || !src) return;
          const staged = editedText(v);
          v.staged = staged;
          v.stagedName = v.newName ?? null;
          if (src.originalText == null) src.originalText = src.text; // for cancel / discard
          src.text = staged;
          v.text = staged;
          src.lintResult = null;
          // Saved text is checked again: now if colours are on, else once they are switched on
          src.needsLint = true;
          if (colourOn(v)) v.relint?.();
          v.dirty = false;
          saveBtn.disabled = true;
          uploadBtn.disabled = false;
      };
      uploadBtn.onclick = () => {
          if (v.dirty) {
              alert('Please save your latest changes first, then upload.');
              flash(saveBtn);
              return;
          }
          if (v.staged == null) return;
          const file = v.file;
          const to = target(v, v.stagedName);
          uploadEdits(v, v.staged).then((ok) => {
              if (viewer !== v || v.file !== file) return; // viewer closed / other file meanwhile
              if (!ok) return void flash(uploadBtn);
              if (to.isNew) {
                  discardEdits(v); // the original stays as it was
                  return void showFile(to.name, to.url, true);
              }
              v.staged = null;
              uploadBtn.disabled = true;
              v.rerender?.();
          });
      };
      editor.addEventListener('input', () => markEdited(v));
      loadAllBtn.onclick = () => {
          const src = v.source;
          if (!src || src.done) return;
          const big = src.total > LARGE_FILE_BYTES;
          if (big && !confirm(`This file is large (${formatBytes(src.total)}). Cache all of it?`)) return;
          if (!makeRoom(v, src.total - src.loaded)) return;
          v.loadAll?.();
      };
      const applyColour = () => colourBtn.setAttribute('aria-pressed', String(colourOn(v)));
      v.applyColour = applyColour;
      colourBtn.onclick = () => {
          const key = colourKey(v);
          colourPrefs[key] = !colourPrefs[key];
          savePref(COLOUR_KEYS[key], colourPrefs[key] ? '1' : '0');
          applyColour();
          v.rerender?.();
          // Saved edit not yet checked: check now that colours are on
          if (colourOn(v) && v.source?.needsLint) v.relint?.();
      };
      applyColour();

      const applyWrap = () => {
          content.classList.toggle('tp-wrap', view.wrap);
          wrapBtn.setAttribute('aria-pressed', String(view.wrap));
      };
      propsBtn.onclick = () => {
          view.props = !view.props;
          savePref(PROPS_KEY, view.props ? '1' : '0');
          setMetaLines(view.metaLines);
      };
      wrapBtn.onclick = () => {
          view.wrap = !view.wrap;
          savePref(WRAP_KEY, view.wrap ? '1' : '0');
          applyWrap();
      };
      applyWrap();

      // Text size (content area and editor): CSS variable; text and table views are laid out anew
      // (their unfilled blocks keep heights measured at the old size), keeping the position in the file
      const applyZoom = (z) => {
          for (const el of [content, editorWrap]) el.style.setProperty('--tp-zoom', String(z));
          zoomValue.textContent = `${Math.round(z * 100)} %`;
          zoomOut.disabled = z <= ZOOM_RANGE[0];
          zoomIn.disabled = z >= ZOOM_RANGE[1];
      };
      applyZoom(view.zoom);
      let relayout = 0;
      let scrollShare = 0;
      const setZoom = (z) => {
          z = Math.round(Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], z)) * 100) / 100;
          if (z === view.zoom) return;
          view.zoom = z;
          savePref(ZOOM_KEY, String(z));
          applyZoom(z);
          if (v.writeMode || v.view3d) return; // editor: CSS alone; CSV cell edits are not redrawn
          if (!relayout) scrollShare = content.scrollTop / Math.max(1, content.scrollHeight);
          clearTimeout(relayout);
          relayout = setTimeout(() => {
              relayout = 0;
              if (viewer !== v || v.writeMode || v.view3d) return;
              v.rerender?.();
              content.scrollTop = scrollShare * content.scrollHeight;
          }, 150);
      };
      const zoomBy = (steps) => setZoom(view.zoom + steps * ZOOM_STEP);
      zoomOut.onclick = () => zoomBy(-1);
      zoomIn.onclick = () => zoomBy(1);
      zoomValue.onclick = () => setZoom(1);
      let wheel = 0;
      box.addEventListener(
          'wheel',
          (e) => {
              const t = e.target;
              if (!(e.ctrlKey || e.metaKey) || !(content.contains(t) || editorWrap.contains(t))) return;
              e.preventDefault(); // not the page's zoom
              wheel += e.deltaY;
              const steps = Math.trunc(wheel / WHEEL_STEP);
              if (!steps) return;
              wheel -= steps * WHEEL_STEP;
              zoomBy(-steps);
          },
          { passive: false },
      );

      // Text view: whole file selected (also lines not drawn yet), and copied as such
      const selectAll = () => {
          const lines = content.firstElementChild;
          if (!lines?.classList.contains('tp-lines')) return false; // table, Markdown: as the browser does
          getSelection()?.selectAllChildren(lines);
          return true;
      };
      content.addEventListener('copy', (e) => {
          const lines = content.firstElementChild;
          const s = getSelection();
          if (!lines || !s || !v.text || s.anchorNode !== lines || s.focusNode !== lines) return;
          const ends = [s.anchorOffset, s.focusOffset].sort((a, b) => a - b);
          if (ends[0] !== 0 || ends[1] !== lines.childNodes.length) return;
          e.clipboardData?.setData('text/plain', v.text);
          e.preventDefault();
      });

      // Keys in the content area (once clicked into) or editor: Ctrl / ⌘ with + − 0 (text size), A (select all)
      box.addEventListener('keydown', (e) => {
          const t = e.target;
          if (e.key === 'F2' && renamable(v)) {
              e.preventDefault();
              return void startRename(v); // another name (edited text, or a copy of a read-only file)
          }
          if (!(e.ctrlKey || e.metaKey) || e.altKey || !(content.contains(t) || t === editor)) return;
          if (e.key === '+' || e.key === '=') zoomBy(1);
          else if (e.key === '-') zoomBy(-1);
          else if (e.key === '0') setZoom(1);
          else if (e.key.toLowerCase() !== 'a' || t !== content || !selectAll()) return;
          e.preventDefault();
      });

      copyBtn.onclick = async () => {
          try {
              if (v.source && !v.source.done && !v.source.isSheet) {
                  // (spreadsheets: only the sheet shown is copied, nothing more to cache)
                  const big = v.source.total > LARGE_FILE_BYTES;
                  if (big && !confirm('This text file is large are you sure you want to load it all into the previewer?'))
                      return;
                  copyBtn.disabled = true;
                  const ok = await v.loadAll?.();
                  copyBtn.disabled = false;
                  if (!ok) throw new Error('caching failed');
              }
              await navigator.clipboard.writeText(
                  v.tableEditing ? (v.lineView?.csvText?.() ?? '') : v.writeMode ? v.editor.value : v.text,
              );
              copyBtn.innerHTML = CHECK_SVG;
              copyBtn.title = 'Copied!';
              copyBtn.style.background = '#107c41';
          } catch (_err) {
              copyBtn.innerHTML = '!';
              copyBtn.title = 'Copy failed';
              copyBtn.style.background = '#a80000';
          }
          setTimeout(() => {
              copyBtn.innerHTML = COPY_SVG;
              copyBtn.title = 'Copy';
              copyBtn.style.background = '#0078d4';
          }, 2000);
      };

      // Appended to <html>, not <body>: in split mode <body> is shrunk (see setMode)
      document.documentElement.append(backdrop, box);
      return v;
  }

  // Module: viewer/open.ts

  // Opening files: viewer state, previews, properties line

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  let viewer = null; // single open viewer, if any

  const pendingOpens = new Map(); // url -> first fetch still running { promise, relay, ctl }
  const forcedUrls = new Set(); // big Parquet / IFCZIP files the user chose to cache in full
  const formatChoices = new Map(); // url -> format chosen by the user (while the page is open)
  const knownSizes = new Map(); // url -> file size seen before (shown right away next time)

  // ===========================================================================
  // METHODS
  // ===========================================================================

  function closeViewer() {
      if (!viewer) return;
      setTimeout(refreshEyes); // row highlight off, once viewer is gone
      if (!confirmDiscard(viewer)) return; // pending: keep viewer open
      if (viewer.writeMode) exitWriteView(viewer);
      cancelLoad(viewer);
      viewer.lineView?.stop();
      close3d(viewer);
      if (viewer.mode !== 'popup') layoutPage(viewer, 'popup');
      restorePage(viewer);
      viewer.removeListeners?.();
      viewer.backdrop.remove();
      viewer.box.remove();
      viewer = null;
  }

  // Opens a file (following .url links): { src } or { message }, plus final name and hops
  /**
   * @param format chosen by the user for the file as listed (its links are then not followed)
   */
  async function openFile(
      fetchUrl,
      fileName,
      hops,
      getSignal,
      reload,
      onProgress,
      onLink,
      force,
      format,
  ) {
      hops = [...hops];
      for (let hop = 0; ; hop++) {
          const chosen = hop === 0 ? format : null;
          const reader = readerOf(chosen || formatOf(fileName));
          const result =
              reader === 'parquet'
                  ? await openParquetSource(fetchUrl, getSignal, reload, onProgress, force)
                  : reader === 'sheet'
                    ? await openSheetSource(fetchUrl, getSignal, reload, onProgress, sheetMode(hops[0]))
                    : reader === 'ifczip'
                      ? await openZipSource(fetchUrl, getSignal, reload, onProgress, force)
                      : await openSource(fetchUrl, getSignal, reload, onProgress);
          if ('deferred' in result) return { src: null, deferred: result, message: null, fileName, hops };
          if ('error' in result) {
              // file from search results, not found by name: say so first, details below
              const note = lookupNotes.get(hops[0]);
              const type = (fileName.match(/\.[^.]+$/)?.[0] ?? 'this type').toLowerCase();
              const hint = note
                  ? `Files of type ${type} cannot be viewed from search results (SharePoint gives no path for them).\n` +
                    "Open the file's folder to view it."
                  : '';
              const message = [hint, `${result.error}\n${hops.join('\n→ ')}`, note].filter(Boolean).join('\n\n');
              return { src: null, message, fileName, hops };
          }
          if ('binary' in result) {
              return {
                  src: null,
                  message: 'Not a plain text file: use the standard SharePoint preview, or download the file.',
                  fileName,
                  hops,
              };
          }
          if (hop > 0 && result.name) fileName = result.name;
          const follow = FOLLOW_LINKS && !chosen && hop < MAX_LINK_HOPS && result.done;
          const target = follow ? linkTarget(fileName, result.text) : null;
          if (!target) return { src: result, message: null, fileName, hops };
          hops.push(target.display);
          fileName = target.name;
          fetchUrl = target.fetchUrl;
          onLink(`Link → ${target.display}`);
      }
  }

  // Open file viewed as another format (a wrong one too: that format's reader tries);
  // the recognised format drops the choice
  function chooseFormat(format) {
      const v = viewer;
      if (!v?.file) return;
      const fresh = !!v.source?.fresh; // new file: its text stays (only in memory), shown as the format chosen
      if (fresh && readerOf(format) !== 'text')
          return void alert('A new file is plain text: please choose a text format.');
      if (fresh && v.dirty) {
          alert('Please save your changes first, then choose the format.');
          return void flash(v.saveBtn);
      }
      if (!fresh && !confirmDiscard(v)) return;
      const { name, url } = v.file;
      if (format === formatOf(name)) formatChoices.delete(url);
      else formatChoices.set(url, format);
      showFile(name, url, false, fresh);
  }

  // Same file, any encoding / case of path
  function sameFile(a, b) {
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
  function openEmptyViewer() {
      if (viewer && !viewer.file) return void closeViewer();
      if (!viewer) {
          viewer = createViewer();
          setMode(view.mode);
      }
      showEmpty(viewer);
  }

  // New file in the folder open in SharePoint (plain text): name asked (checked), then shown as any file
  // (colours, checks, views by its format) and edited; the empty text counts as saved (may be uploaded as it is)
  async function newFile() {
      const folder = currentFolder();
      if (!inLibrary() || !folder) {
          alert('New files go into the folder open in SharePoint: please open a folder of a library first.');
          return;
      }
      if (viewer && !confirmDiscard(viewer)) return; // pending in the open file: stay
      const name = await askName(folder);
      if (!name) return;
      const url = `${folder}/${name}`;
      const src = { total: 0, loaded: 0, done: true, text: '', more: async () => {}, loadAll: async () => {} };
      src.fresh = true;
      formatChoices.delete(url);
      keepInMemory(url, { src, fileName: name, hops: [url], reader: 'text' }); // shown from memory, never fetched
      await showFile(name, url, false);
      const v = viewer;
      if (v?.source !== src) return;
      await enterWrite(v); // shows the name (click: another name)
      v.staged = ''; // saved as it is: may be uploaded empty
      v.uploadBtn.disabled = false;
  }

  // Viewer back to no file; false if user keeps pending changes
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
      for (const b of [v.copyBtn, v.loadAllBtn, v.writeBtn, v.clearBtn]) b.disabled = true;
      setPreview(v, null);
      showSheets(v, null);
      showFormat(v, null);
      updateViews(v);
      v.titleName.textContent = '–';
      v.titleName.title = '';
      v.titleName.className = 'tp-title-name';
      v.newBtn.hidden = false;
      v.metaLine.innerHTML = '';
      v.metaLine.title = '';
      showPlain(
          v,
          'No file opened.\nClick the eye next to a file to preview it, or create a new file (button above, or ⋯ menu).',
      );
      refreshEyes();
      return true;
  }

  async function openPreview(row) {
      const name = row && rowName(row);
      if (!name) {
          alert('Preview: could not find the file name in this row.');
          return;
      }
      const folder = currentFolder();
      // row without the file's path (search results): found by search, else guessed in the open folder
      let url = rowFilePath(row, name);
      if (!url && folder) {
          url = (await findFile(folder, name)) || `${folder}/${name}`;
          const eye = row.querySelector('.tp-preview');
          if (eye instanceof HTMLElement) eye.dataset.url = url; // cache state of the file found
      }
      if (url && viewer?.file && sameFile(viewer.file.url, url)) return void closeViewer(); // eye of open file: same as close
      if (url) showFile(name, url, false);
  }

  // Load file into viewer; `reload` skips browser's cache (refresh button)
  /** @param keep pending changes stay (new file shown as another format) */
  async function showFile(name, url, reload, keep = false) {
      const encodedUrl = encodePath(url);

      // Reuse open viewer (e.g. in split mode, click through files one after another)
      if (!viewer) {
          viewer = createViewer();
          setMode(view.mode);
      }
      const v = viewer;
      if (!keep && !confirmDiscard(v)) return; // pending in open file: stay
      close3d(v);
      if (v.writeMode) exitWriteView(v);
      cancelLoad(v); // previous file may still be on its way
      const token = ++v.loadToken;
      const current = () => viewer === v && token === v.loadToken; // not closed / replaced
      v.file = { name, url };
      refreshEyes(); // highlight its row

      if (clearedUrls.delete(url)) reload = true; // cleared before: skip stored copy once
      v.userStopped = false;

      v.newBtn.hidden = true;
      v.titleName.className = 'tp-title-name';
      v.titleName.textContent = name;
      v.titleName.title = url;
      // what is known before the content: format (recognised or chosen), then size (from the first response)
      const chosen = formatChoices.get(url) || null;
      const early = chosen || formatOf(name);
      const reader = readerOf(early); // cached copies of another reader are read anew
      const earlyLang = langOfFormat(early);
      const earlyFormat = (!chosen && sheetFormat(name)) || formatName(early);
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
      setPreview(v, previewOf(earlyLang), 'Preview: once the file is cached');
      showSheets(v, null);
      showFormat(v, early, formatOf(name));
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
      const relay = {
          fn: null,
          controller: null,
      };
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
      const relayed = (loaded, total) => relay.fn?.(loaded, total);
      if (reload && memoryCache.delete(url)) refreshEyes(); // refresh: fetch anew
      if (memoryCache.get(url)?.reader !== reader && memoryCache.delete(url)) refreshEyes(); // other format chosen
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
              if (pending?.reader !== reader) pending?.ctl.abort(); // other format chosen meanwhile
              if (pending?.reader === reader) pending.relay.fn = progress;
              else {
                  const ctl = new AbortController();
                  relay.controller = ctl;
                  pending = {
                      reader,
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
                          chosen,
                      ),
                  };
                  const own = pending;
                  pendingOpens.set(url, own);
                  refreshEyes(); // half open while it caches
                  pending.promise
                      .then(
                          (r) => {
                              if (r.src) {
                                  r.src.relay = relay;
                                  keepInMemory(url, { src: r.src, fileName: r.fileName, hops: [...r.hops], reader });
                              }
                          },
                          () => {},
                      )
                      .finally(() => {
                          relay.controller = null;
                          if (pendingOpens.get(url) === own) pendingOpens.delete(url);
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
              if ((err).name === 'AbortError') {
                  if (current() && v.userStopped) showPlain(v, 'Caching stopped. Use refresh to cache this file again.');
                  return;
              }
              message = `Caching failed: ${(err).message}\n${hops.join('\n→ ')}`;
          }
      if (current()) v.opening = false;
      if (current()) setBusy(v, false);
      if (hops.length > 1) {
          v.titleName.textContent = `${name} → ${fileName}`;
          v.titleName.title = hops.join('\n→ ');
      }
      v.abort = null;

      if (!current()) return;
      v.linked = hops.length > 1; // reached through a link: not renamed, not uploaded

      if (deferred) {
          // Big Parquet / IFCZIP: only on request (whole file); "cache all" opens it in full
          v.source = {
              total: deferred.size,
              loaded: 0,
              done: false,
              dates: deferred.dates,
              deferred: true,
              text: '',
              more: async () => {},
              loadAll: async () => {}, // the viewer's loadAll opens the file in full
          };
          knownSizes.set(url, deferred.size);
          v.text = '';
          v.copyBtn.disabled = true;
          v.writeBtn.disabled = true;
          v.rerender = null;
          v.relint = null;
          v.loadAllBtn.disabled = false;
          setPreview(v, previewOf(earlyLang), 'Preview: once the whole file is cached');
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
          showName(v); // read only: a copy under another name
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
          setPreview(v, null);
          showPlain(v, message);
          showCached(v); // nothing cached (not the last file's state)
          showName(v); // binary: a copy under another name
          return;
      }

      // Copy gets whole file: rest is cached first if needed
      v.source = src;
      v.fileName = fileName;
      const format = chosen || formatOf(fileName);
      v.lang = langOfFormat(format);
      showName(v); // name an edit goes to (another name, new file)
      v.writeBtn.disabled = !canWrite(v);
      v.writeBtn.title = src.isSheet ? 'Edit: not available for spreadsheets (read only)' : 'Edit (text files only)';
      const kind = previewOf(v.lang);
      const ifcSize = src.ifcBytes ? src.ifcBytes.length : src.total;
      const tooBig = kind === '3d' && ifcSize > MAX_3D_BYTES;
      setPreview(v, kind, tooBig ? `3D view: only for IFC files up to ${formatBytes(MAX_3D_BYTES)}` : '');
      showFormat(v, format, formatOf(fileName));
      updateViews(v);
      v.text = src.text;

      const lang = ['parquet', 'sheet'].includes(v.lang ?? '') ? 'csv' : (v.lang ?? ''); // their rows come as CSV; '' plain text
      const plain = (t) => [['', t]];
      const highlight = HIGHLIGHTERS[lang] || plain;
      let problemsByLine = new Map();
      let lines = [];
      let logShown = null; // log as a table (while shown)

      // Cached lines; unfinished last line waits (unless there is no break at all)
      const loadedLines = () => {
          let t = src.text;
          if (!src.done && !src.wholeLines && t.includes('\n')) t = t.slice(0, t.lastIndexOf('\n'));
          return t.split(/\r?\n/);
      };

      // Table view: sort and filters stay while this file is open (also across "Cache next"); per sheet or table
      const tableState = { sort: null, filters: new Map() };
      const sheetStates = new Map();
      /** @param i e.g. "sheets 0" */
      const sheetState = (i) => {
          if (!sheetStates.has(i)) sheetStates.set(i, { sort: null, filters: new Map() });
          return sheetStates.get(i); // set just above
      };

      // Metadata line: dates, size, format and, for tables, their shape

      const updateMeta = () => {
          const d = src.dates || {};
          const encoding = src.encoding ? `, ${src.encoding}` : '';
          const info = [
              // from the file's own response only (no list columns, no API)
              ['created', d.created],
              ['modified', d.modified || 'n/a'],
              ['size', src.total ? `${formatBytes(src.total)} (${src.total.toLocaleString()} bytes)` : null],
              ['format', src.format || `${LANG_NAMES[lang] || 'Text'}${encoding}`],
          ];
          if (!src.format && lang !== 'csv') info.push(['indent', indentation(src.text)]);
          if (src.info)
              info.push(...src.info); // Parquet, archives, spreadsheets
          else if (lang === 'csv') {
              const sep = csvSeparator(src.text);
              const header = src.text.slice(0, (src.text.indexOf('\n') + 1 || src.text.length + 1) - 1);
              const cols = header ? header.split(sep).length : 0;
              const rows = Math.max(0, lines.filter((l) => l.trim()).length - 1);
              const to =
                  v.tableEditing && csvFormat.sep && csvFormat.sep !== sep ? ` → ${SEPARATOR_NAMES[csvFormat.sep]}` : '';
              info.push(['delimiter', `${SEPARATOR_NAMES[sep]}${to}`]);
              if (v.tableEditing && csvFormat.quote)
                  info.push(['quotes', QUOTE_MODES[csvFormat.quote].replace('Quotes: ', '')]);
              info.push(['shape', `${src.done ? '' : '≥ '}${rows.toLocaleString()} rows × ${cols} columns`]);
          }
          if (logShown) {
              const entries = `${src.done ? '' : '≥ '}${logShown.rows.length.toLocaleString()} entries`;
              info.push(['shape', `${entries} × ${logShown.header.length} columns`]);
              info.push(['fields', `${logShown.kinds.join(', ')} (guessed)`]);
          }
          const shown = info.filter(([, x]) => x !== null && x !== undefined && x !== '');
          const pairs = shown.map(([k, x]) => `${k}: ${x}`);
          v.metaLine.innerHTML = `<strong>Properties:</strong> ${esc(pairs.join(' · '))}`;
          v.metaLine.title = pairs.join('\n');
      };

      // Markdown: relative links and images point into the file's folder
      const folderUrl = new URL(fetchUrl.replace(/[^/]*$/, ''), location.origin).href;

      // Very long lines (e.g. minified files) are cut for display; copy still gets everything
      const render = () => {
          rendered = true;
          lines = loadedLines();
          // Line numbers: one width for the whole column, max(L, digits(last line) + 2), L = digits(rows of the file)
          const rowsDigits = String(src?.done ? lines.length : 0).length;
          const lastDigits = String(lines.length).length;
          v.content.style.setProperty('--tp-ln-w', `${Math.max(rowsDigits, lastDigits + 2)}ch`);
          const scrollTop = v.content.scrollTop;
          const truncated = new Map();
          const visible = lines.map((line, i) => {
              if (line.length <= MAX_LINE_CHARS) return line;
              truncated.set(i + 1, line.length - MAX_LINE_CHARS);
              return line.slice(0, MAX_LINE_CHARS);
          });
          v.lineView?.stop();
          // Logs: table only if fields were found (first lines), parsed in full while shown
          if (v.lang === 'log') {
              const found = hasFields(lines);
              setPreview(v, 'table', found ? '' : 'Table view: no recognisable fields in this log');
              updateViews(v);
          }
          logShown = v.lang === 'log' && tableView(v) ? parseLog(lines.join('\n')) : null;
          const shown = src.isSheet ? src.shown : null;
          if (shown && !shown.rows.length) {
              // chart sheet, empty or unreadable sheet, empty table: a note instead
              v.lineView = mountLines(v.content, renderLines([['', shown.note]], new Map()));
              v.content.firstElementChild?.classList.add('tp-notice');
          } else if (shown && view.table) {
              v.lineView = mountTable(v.content, shown.header, shown.rows, {
                  state: sheetState(`${src.mode} ${src.current}`),
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
          } else if (logShown) {
              const { header, rows } = logShown;
              const level = header.indexOf('level');
              const message = header.length - 1;
              v.lineView = mountTable(v.content, header, rows, {
                  state: tableState,
                  colour: colourOn(v),
                  classOf: (c, value) =>
                      c === level ? levelClass(value) : c === message && value.includes('\n') ? 'multi' : '',
                  expand: logExpand(rows, colourOn(v)),
              });
          } else if (markdownView(v)) {
              v.lineView = mountMarkdown(v.content, lines.join('\n'), { colour: colourOn(v), base: folderUrl });
          } else {
              const tokens = (colourOn(v) ? highlight : plain)(visible.join('\n'));
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
              if ((err).name === 'AbortError') {
                  v.text = src.text;
                  render(); // stopped: show what is cached so far, "Cache next" works again
                  return false;
              }
              v.loadMoreBtn.disabled = false;
              v.loadAllBtn.disabled = false;
              v.loadMoreBtn.textContent = `Caching failed: ${(err).message} · Refresh to try again`;
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

      // Other sheet or table: its sheet cached on first choice (stop keeps what was shown before);
      // sheets or tables: remembered for this file
      v.selectSheet = async (i, mode = src.mode) => {
          if (!src.isSheet || !(mode === 'tables' ? src.tables : src.sheets)[i]) return;
          if (mode === src.mode && i === src.current && !src.waiting) return;
          if (mode !== src.mode) rememberSheetMode(url, mode);
          const s = src.sheetOf(i, mode);
          if (src.sheets[s].data === undefined) {
              const job = async () => {
                  await src.loadSheet(s);
                  src.select(i, mode);
              };
              const ok = await load(false, job, src.sheets[s].size);
              if (!current()) return;
              if (!ok) return void showSheets(v, src); // drop-downs back to what is shown
          }
          if (src.mode !== mode || src.current !== i || src.waiting) {
              src.select(i, mode);
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
      if (view.show3d && ifcLibraryReady && kind === '3d' && !v.previewBtn.disabled) toggle3d(v);
  }

  // Module: viewer/layout.ts

  // Page layout: viewer beside or below the list, size, drag

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Card look, like SharePoint's own list card: grey border, round corners, soft shadow
  const CARD_CSS = `
    border: 1px solid var(--tp-edge);
    border-radius: 8px;
  `;

  const BOX_CSS = {
      popup: `
      position: fixed;
      left: 10vw;
      top: 10vh;
      width: 80vw;
      height: 80vh;
      ${CARD_CSS}
      box-shadow: 0 8px 32px rgba(0,0,0,.35);
    `,
      vertical: `
      position: fixed;
      left: 50vw;
      right: 0;
      top: 0;
      bottom: 0;
      ${CARD_CSS}
      box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.11);
    `,
      horizontal: `
      position: fixed;
      left: 0;
      right: 0;
      top: 50vh;
      bottom: 0;
      ${CARD_CSS}
      box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.11);
    `,
  };

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const restoreStyle = (el, original) => {
      if (original == null) el.removeAttribute('style');
      else el.setAttribute('style', original);
  };

  // List's card: scroll area plus its frame and scrollbars, no command bar
  /** @returns card around the list, and the element that scrolls it */
  function listRegion() {
      const grid = document.querySelector('[role="grid"], [role="treegrid"]');
      let scroller = grid;
      for (let el = grid; el && el !== document.body; el = el.parentElement) {
          const { overflowY } = getComputedStyle(el);
          if ((overflowY === 'auto' || overflowY === 'scroll') && el.clientHeight > 100) {
              scroller = el;
              break;
          }
      }
      if (!scroller) return null;

      // Go up while parent only adds thin frame
      const SLACK = 24;
      const s = scroller.getBoundingClientRect();
      let card = scroller;
      for (let el = scroller.parentElement; el && el !== document.body; el = el.parentElement) {
          const r = el.getBoundingClientRect();
          const thin =
              r.top >= s.top - SLACK &&
              r.left >= s.left - SLACK &&
              r.right <= s.right + SLACK &&
              r.bottom <= s.bottom + SLACK;
          if (!thin) break;
          card = el;
      }
      return { card, scroller };
  }

  // Visible right / bottom edge of list, incl. scrollbars drawn just outside it
  function listEdges(card, scroller) {
      const c = scroller.getBoundingClientRect();
      const REACH = 30;
      let right = c.right;
      let bottom = c.bottom;
      const root = card.parentElement || card;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
          acceptNode: (n) => (n === scroller ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const n = node; // elements only (SHOW_ELEMENT)
          if (n.contains(scroller) || n.closest('.tp-cell, .tp-head')) continue; // frames around list don't count
          const r = n.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const besideRight = r.top < c.bottom && r.bottom > c.top && r.left < c.right && r.right > c.right;
          const besideBelow = r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.bottom;
          if (besideRight && r.right <= c.right + REACH) right = Math.max(right, r.right);
          if (besideBelow && r.bottom <= c.bottom + REACH) bottom = Math.max(bottom, r.bottom);
      }
      return { right, bottom };
  }

  function restorePage(v) {
      v.regionObserver?.disconnect();
      v.regionObserver = null;
      v.containerObserver?.disconnect();
      v.containerObserver = null;
      restoreStyle(document.body, v.originalBodyStyle);
      if (v.region) {
          restoreStyle(v.region, v.regionStyle);
          v.region = null;
      }
      if (v.dock) {
          restoreStyle(v.dock, v.dockStyle);
          v.dock = null;
      }
      if (v.anchor) {
          v.anchor = null;
          document.documentElement.append(v.box); // back out of SharePoint's container
      }
      if (v.anchorParent) {
          restoreStyle(v.anchorParent, v.anchorParentStyle);
          v.anchorParent = null;
      }
  }

  // List share of space (splitter); remembered, setting is start value
  const splitFraction = (() => {
      const start = { vertical: 1 - DEFAULT_PREVIEW_SIZE, horizontal: 1 - DEFAULT_PREVIEW_SIZE };
      try {
          const kept = JSON.parse(loadPref('tp-preview-split', 'null'));
          for (const m of ['vertical', 'horizontal']) if (kept?.[m] >= 0.1 && kept[m] <= 0.9) start[m] = kept[m];
      } catch {}
      return start;
  })();

  // Element that really scrolls list vertically (prefers one that overflows)
  function verticalScroller(grid) {
      let bounded = null;
      for (let el = grid.parentElement; el && el !== document.body; el = el.parentElement) {
          const { overflowY } = getComputedStyle(el);
          if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
          if (el.clientHeight < 100 || el.getBoundingClientRect().height > window.innerHeight + 1) continue;
          if (el.scrollHeight > el.clientHeight + 1) return el;
          bounded = bounded || el;
      }
      return bounded;
  }

  // SharePoint's wrapper around file list: <div role="" style="display: contents;">
  function listWrapper(grid) {
      for (let el = grid.parentElement; el && el !== document.body; el = el.parentElement) {
          if (el.getAttribute('role') === '' && el.style.display === 'contents') return el;
      }
      return null;
  }

  // Space for horizontal split: scroller's visible area before it was shrunk (d: its bounds then)
  function dockArea(d) {
      return {
          top: Math.max(0, d.top),
          bottom: Math.min(window.innerHeight, d.bottom),
          left: d.left,
          right: d.right,
      };
  }

  const px = (n) => `${Math.max(0, Math.round(n))}px`;

  // Keep split panel next to (vertical) or below (horizontal) shrunk list
  function syncPanel() {
      const v = viewer;
      if (!v || v.mode === 'popup') return;
      const s = v.box.style;
      const { anchor, anchorParent: p, region, scroller, base, dock, dockBase, grid } = v;

      if (v.mode === 'horizontal' && anchor && p && region && scroller && v.anchorSpace !== undefined) {
          // In page after list wrapper, below shortened list
          if (v.box.previousElementSibling !== anchor) anchor.after(v.box);
          const sr = scroller.getBoundingClientRect();
          const edge = listEdges(region, scroller);
          const pr = p.getBoundingClientRect();
          s.left = `${Math.round(sr.left - pr.left - p.clientLeft + p.scrollLeft)}px`;
          s.top = `${Math.round(edge.bottom + SPLIT_GAP - pr.top - p.clientTop + p.scrollTop)}px`;
          s.width = px(edge.right - sr.left);
          s.height = px(v.anchorSpace * (1 - splitFraction.horizontal) - 2 * SPLIT_GAP);
          return;
      }

      if (v.mode === 'horizontal' && dock && dockBase && grid) {
          // Fill space below shrunk scroller
          const area = dockArea(dockBase);
          const d = dock.getBoundingClientRect();
          const g = grid.getBoundingClientRect();
          const edge = listEdges(dock, dock);
          s.left = px(Math.max(g.left, d.left));
          s.right = px(window.innerWidth - Math.min(g.right, edge.right, d.right));
          s.top = px(d.bottom + SPLIT_GAP);
          s.bottom = px(window.innerHeight - area.bottom + SPLIT_GAP);
          return;
      }

      if (v.mode === 'vertical' && region && scroller && base) {
          // Align with visible list (scroll area + its scrollbars), not card frame around it
          const sr = scroller.getBoundingClientRect();
          const edge = listEdges(region, scroller);

          if (anchor && p) {
              // In page after list wrapper: moves with list
              if (v.box.previousElementSibling !== anchor) anchor.after(v.box);
              const pr = p.getBoundingClientRect();
              s.left = `${Math.round(edge.right + SPLIT_GAP - pr.left - p.clientLeft + p.scrollLeft)}px`;
              s.top = `${Math.round(sr.top - pr.top - p.clientTop + p.scrollTop)}px`;
              s.width = px(base.right - edge.right - SPLIT_GAP);
              s.height = px(edge.bottom - sr.top);
              return;
          }

          s.left = px(edge.right + SPLIT_GAP);
          s.right = px(window.innerWidth - base.right);
          s.top = px(sr.top);
          s.bottom = px(window.innerHeight - edge.bottom);
          return;
      }

      // Fallback (list not found): whole page was shrunk
      const f = splitFraction[v.mode];
      s.left = v.mode === 'vertical' ? `calc(${f * 100}vw + ${SPLIT_GAP}px)` : `${SPLIT_GAP}px`;
      s.top = v.mode === 'horizontal' ? `calc(${f * 100}vh + ${SPLIT_GAP}px)` : `${SPLIT_GAP}px`;
      s.right = `${SPLIT_GAP}px`;
      s.bottom = `${SPLIT_GAP}px`;
  }

  function applySplit(v) {
      const f = splitFraction[v.mode];
      const vertical = v.mode === 'vertical';
      const { region, base, anchorSpace, dock, dockBase } = v;
      if (vertical && region && base) {
          const size = `${Math.round(base.width * f)}px`;
          const st = region.style;
          st.width = size;
          st.maxWidth = size;
          st.minWidth = '0';
          st.flex = 'none';
      } else if (v.mode === 'horizontal' && v.anchor && region && anchorSpace !== undefined) {
          // List (card) gets shorter; panel goes into freed space below it
          const height = `${Math.round(anchorSpace * f)}px`;
          const st = region.style;
          st.height = height;
          st.maxHeight = height;
          st.minHeight = '0';
          st.flex = 'none';
      } else if (v.mode === 'horizontal' && dock && dockBase) {
          const area = dockArea(dockBase);
          const height = `${Math.round((area.bottom - area.top) * f)}px`;
          const st = dock.style;
          st.height = height;
          st.maxHeight = height;
          st.minHeight = '0';
          st.flex = 'none';
      } else {
          // Fallback (no list): shrink whole page (transform: <body> holds fixed parts)
          const st = document.body.style;
          st.position = 'fixed';
          st.left = '0';
          st.top = '0';
          st.width = vertical ? `${f * 100}vw` : '100vw';
          st.height = vertical ? '100vh' : `${f * 100}vh`;
          st.overflow = 'hidden';
          st.transform = 'translateZ(0)';
      }
      syncPanel();
  }

  // Let SharePoint re-measure its lists (ignored by our own resize handler)
  function notifyResize(v) {
      v.selfResize = true;
      window.dispatchEvent(new Event('resize'));
      v.selfResize = false;
      // List can also move (not just resize) while SharePoint re-flows
      requestAnimationFrame(syncPanel);
      setTimeout(syncPanel, 300);
  }

  // Make room for split panel (top bar, command bar, navigation untouched)
  function layoutPage(v, mode) {
      restorePage(v);

      if (mode !== 'popup') {
          const list = listRegion();
          const region = list?.card ?? null;
          const scroller = list?.scroller ?? null;
          v.grid = document.querySelector('[role="grid"], [role="treegrid"]');

          if (mode === 'vertical' && region) {
              v.region = region;
              v.regionStyle = region.getAttribute('style');
              v.base = region.getBoundingClientRect(); // natural size, before it gets smaller
              v.scroller = scroller;
              v.regionObserver = new ResizeObserver(syncPanel);
              v.regionObserver.observe(region);

              // Preferred: after list wrapper (<div role="" style="display: contents;">)
              const anchor = v.grid && listWrapper(v.grid);
              if (anchor) {
                  const parent = anchor.parentElement; // wrapper inside the page
                  v.anchor = anchor;
                  v.anchorParent = parent;
                  v.anchorParentStyle = parent.getAttribute('style');
                  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
                  const st = v.box.style;
                  st.position = 'absolute';
                  st.right = st.bottom = '';
                  st.margin = '0';
                  anchor.after(v.box);
              }
          } else if (mode === 'horizontal' && v.grid) {
              // Preferred: after list wrapper; its container sizes list
              const anchor = region && listWrapper(v.grid);
              const dock = anchor ? null : verticalScroller(v.grid);
              if (anchor) {
                  v.region = region;
                  v.regionStyle = region.getAttribute('style');
                  v.base = region.getBoundingClientRect(); // natural size, before it gets shorter
                  v.scroller = scroller;
                  // Space to share: list's visible height (list may be taller than window)
                  v.anchorSpace = Math.min(v.base.height, window.innerHeight - Math.max(0, v.base.top));
                  v.regionObserver = new ResizeObserver(syncPanel);
                  v.regionObserver.observe(region);

                  const parent = anchor.parentElement; // wrapper inside the page
                  v.anchor = anchor;
                  v.anchorParent = parent;
                  v.anchorParentStyle = parent.getAttribute('style');
                  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
                  const st = v.box.style;
                  st.position = 'absolute';
                  st.right = st.bottom = '';
                  st.margin = '0';
                  anchor.after(v.box);
              } else if (dock) {
                  v.dock = dock;
                  v.dockStyle = dock.getAttribute('style');
                  v.dockBase = dock.getBoundingClientRect(); // before it gets smaller
                  v.regionObserver = new ResizeObserver(syncPanel);
                  v.regionObserver.observe(dock);
              }
          }
          applySplit(v);
          watchContainer(v);
      }
      notifyResize(v);
  }

  // SharePoint's side panels change width without window resize: lay out anew
  function watchContainer(v) {
      const el = v.anchorParent || v.region?.parentElement || v.dock?.parentElement;
      if (!el) return;
      let width = Math.round(el.getBoundingClientRect().width);
      let queued = false;
      v.containerObserver = new ResizeObserver(() => {
          const now = Math.round(el.getBoundingClientRect().width);
          if (Math.abs(now - width) < 2 || queued) return; // only width: heights change with split itself
          width = now;
          queued = true;
          requestAnimationFrame(() => {
              queued = false;
              if (viewer === v && v.mode !== 'popup') layoutPage(v, v.mode);
          });
      });
      v.containerObserver.observe(el);
  }

  // Splitter drag (left edge in vertical mode, top edge in horizontal mode)
  function startDrag(e) {
      const v = viewer;
      if (!v || v.mode === 'popup') return;
      e.preventDefault();
      const handle = e.currentTarget; // the splitter
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('tp-drag');
      const vertical = v.mode === 'vertical';

      let queued = false;

      const onMove = (ev) => {
          let f;
          const { region, base, anchorSpace, dockBase } = v;
          if (vertical && region && base) {
              f = (ev.clientX - region.getBoundingClientRect().left) / base.width;
          } else if (!vertical && v.anchor && region && anchorSpace !== undefined) {
              f = (ev.clientY - region.getBoundingClientRect().top) / anchorSpace;
          } else if (!vertical && v.dock && dockBase) {
              const area = dockArea(dockBase);
              f = (ev.clientY - area.top) / (area.bottom - area.top);
          } else {
              f = vertical ? ev.clientX / window.innerWidth : ev.clientY / window.innerHeight;
          }
          splitFraction[v.mode] = Math.min(0.9, Math.max(0.1, f));
          savePref('tp-preview-split', JSON.stringify(splitFraction));
          if (!queued) {
              queued = true;
              requestAnimationFrame(() => {
                  queued = false;
                  if (viewer === v) applySplit(v);
              });
          }
      };

      const onUp = () => {
          handle.classList.remove('tp-drag');
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          if (viewer === v) notifyResize(v);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
  }

  function setMode(mode) {
      const v = viewer;
      if (!v) return;
      v.mode = mode;
      view.mode = mode;
      savePref('tp-preview-mode', mode);

      v.box.style.cssText = `
      ${BOX_CSS[mode]}
      z-index: ${mode === 'popup' ? 2147483001 : 10}; /* popup: above SharePoint's panels; split: just above the page, below SharePoint menus */
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    `;
      v.backdrop.style.display = mode === 'popup' ? 'block' : 'none';
      v.header.style.cursor = mode === 'popup' ? 'move' : ''; // popup: drag header to move it
      if (mode === 'popup') placeMoved(v.box, POPUP_POS_KEY);
      v.splitter.className = `tp-splitter tp-splitter-${mode}`;
      v.backdrop.classList.toggle('tp-overlay', mode === 'popup');

      v.layoutBtn.innerHTML = { horizontal: SPLIT_H_SVG, vertical: SPLIT_V_SVG, popup: POPUP_SVG }[mode];
      for (const [btn, m] of [
          [v.hBtn, 'horizontal'],
          [v.vBtn, 'vertical'],
          [v.pBtn, 'popup'],
      ]) {
          const active = mode === m;
          btn.setAttribute('aria-pressed', String(active));
      }

      layoutPage(v, mode);
  }

  // Module: viewer/edit.ts

  // Read / write mode

  // ===========================================================================
  // METHODS
  // ===========================================================================

  const canWrite = (v) =>
      !!(v.source && !v.source.isParquet && !v.source.isZip && !v.source.isSheet); // read only

  async function enterWrite(v) {
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
      if (v.lang === 'csv' && view.table && src.text) {
          // CSV in table view: edit cells directly (empty: in the text box)
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
  function confirmDiscard(v) {
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

  // Cancel (button, Esc): drop all changes (unsaved and saved) after asking, back to read view
  // (new file: to the empty viewer); false = user keeps them
  function cancelEdits(v) {
      if (!v.writeMode || !confirmDiscard(v)) return false;
      if (v.source?.fresh) return showEmpty(v);
      exitWriteView(v);
      return true;
  }

  // Drop pending changes; show file as cached
  function discardEdits(v) {
      const src = v.source;
      if (src && src.originalText != null) {
          src.text = src.originalText;
          src.originalText = null;
          src.lintResult = null;
          v.text = src.text;
      }
      if (src?.fresh && v.file) memoryCache.delete(v.file.url); // new file, never uploaded: nothing to keep
      v.dirty = false;
      v.staged = null;
      v.newName = null;
      v.stagedName = null;
      v.saveBtn.disabled = true;
      v.uploadBtn.disabled = true;
      showName(v);
  }

  // Back to read view (keeps saved changes, drops unsaved edits)
  function exitWriteView(v) {
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
  function editedText(v) {
      if (!v.tableEditing) return v.editor.value;
      return (v.lineView?.csvText?.() ?? '') + (v.source?.trailingNewline ? '\n' : '');
  }

  // Edited: save (again) before upload
  function markEdited(v) {
      v.dirty = true;
      v.saveBtn.disabled = false;
      v.uploadBtn.disabled = true;
  }

  // Draw attention to button: blue glow that fades out over 3 seconds
  function flash(btn) {
      btn.classList.remove('tp-attn');
      void btn.offsetWidth; // restart animation
      btn.classList.add('tp-attn');
      setTimeout(() => btn.classList.remove('tp-attn'), 3000);
  }

  // ---------------------------------------------------------------------------
  // Upload: as a user would (drop, or SharePoint's upload dialogue); no API
  // ---------------------------------------------------------------------------

  /** @returns file shown is in the folder open in SharePoint (only there can it be uploaded); else says so */
  function uploadable(v) {
      const url = v.file?.url ?? '';
      const folder = currentFolder();
      if (!v.linked && folder && url.slice(0, url.lastIndexOf('/')).toLowerCase() === folder.toLowerCase()) return true;
      alert(
          'Uploading only works for a file in the folder that is open in SharePoint\n' +
              '(not for search results or files reached through a link).\n' +
              "Open the file's folder and upload from there.",
      );
      return false;
  }

  // Saved text to SharePoint: the file itself, or under another name a new file (the original stays)
  /** @returns true once SharePoint has the new file */
  async function uploadEdits(v, edited) {
      const src = v.source;
      if (!src || !v.file || !uploadable(v)) return false;
      const to = target(v, v.stagedName);
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
      const name = to.isNew ? to.name : (v.fileName ?? v.file.name);
      const file = new File([src.bom ? `\uFEFF${text}` : text], name, { type: 'text/plain', lastModified: Date.now() });
      if (!(await uploadFile(v, file, to))) return false;

      if (to.isNew) return true; // original unchanged: the caller opens the new file
      // Confirmed: uploaded text is file from now on
      src.text = text;
      src.originalText = null;
      v.text = text;
      src.lintResult = null;
      return true;
  }

  // Hands a file to SharePoint (drop, else its upload dialogue); a HEAD request confirms the change,
  // otherwise the user can save the file and upload it by hand
  /** @returns true once SharePoint has the file */
  async function uploadFile(v, file, to) {
      const transfer = new DataTransfer();
      transfer.items.add(file);

      // How file looks on SharePoint right now (none: new file); upload changes this
      const stamp = () => fileStamp(to.url);
      const before = await stamp();
      // Watch for SharePoint to change file (it may first ask "replace?"): up to `ms`, shown in the status bar
      const changed = async (ms, how) => {
          for (const end = Date.now() + ms; Date.now() < end; ) {
              const left = Math.ceil((end - Date.now()) / 1000);
              showStatus(v, `Uploading "${to.name}" (${how}) … waiting for SharePoint (${left} s)`);
              await new Promise((r) => setTimeout(r, 1500));
              const now = await stamp();
              if (now && now !== before) return true;
          }
          return false;
      };

      const ready = !v.uploadBtn.disabled; // upload button as before (copies: not involved)
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
          done = await changed(20000, 'dropped on the list');
      }

      // 2. Like choice in SharePoint's own upload dialogue
      if (!done) {
          const input = [...document.querySelectorAll('input[type="file"]')].find((i) => !i.closest('.tp-viewer'));
          if (input) {
              (input).files = transfer.files;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              done = await changed(20000, "SharePoint's upload dialogue");
          }
      }

      showCached(v);
      v.uploadBtn.title = 'Upload the saved changes to SharePoint';
      if (done) return true;
      v.uploadBtn.disabled = !ready;
      // 3. user does it: file is saved locally, ready to drag into folder
      if (
          confirm(
              'SharePoint did not take the file automatically.\n\n' +
                  'Download the file now, so you can drag it into the folder yourself?\n' +
                  '(Saved changes stay in the viewer until an upload is confirmed.)',
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

  /** Page-wide edit guards: Ctrl+S / Cmd+S saves, unsaved changes ask before leaving. */
  function guardEdits() {
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
  function setupCsvBar(v, fileSep) {
      const sepSel = v.csvBar.querySelector('.tp-csv-sep'); // in the bar's HTML
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

  // Module: viewer/cache.ts

  // Cache of opened files: memory limits, clearing, cancelled loads

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  // Previewed files in memory up to MEMORY_CACHE_BYTES (least recently viewed go first)
  const memoryCache = new Map(); // url -> { src, fileName, hops, reader }

  // Cleared files: next fetch skips (and replaces) browser's stored copy
  const clearedUrls = new Set();

  // ===========================================================================
  // METHODS
  // ===========================================================================

  /** @returns bytes */
  const keptSize = (entry) => entry.src.loaded || 0; // bytes of the file cached

  // Room for `need` more bytes in the cache; else asks to clear the other files first
  function makeRoom(v, need) {
      let used = 0;
      for (const entry of memoryCache.values()) used += keptSize(entry);
      if (used + need <= MEMORY_CACHE_BYTES) return true;
      const own = memoryCache.get(v.file?.url);
      const mine = own ? keptSize(own) : 0;
      if (mine + need > MEMORY_CACHE_BYTES) {
          alert(
              `This file is bigger than the cache limit (${formatBytes(MEMORY_CACHE_BYTES)}). Raise it in the settings to cache more.`,
          );
          return false;
      }
      if (
          !confirm(
              `The cache is full (${formatBytes(used)} of ${formatBytes(MEMORY_CACHE_BYTES)}). Clear the other cached files first, then go on?`,
          )
      )
          return false;
      for (const url of [...memoryCache.keys()]) {
          if (url === v.file?.url || memoryCache.get(url).src.fullJob) continue;
          clearedUrls.add(url);
          memoryCache.delete(url);
      }
      refreshEyes();
      return true;
  }

  function trimMemory() {
      let total = 0;
      for (const entry of memoryCache.values()) total += keptSize(entry);
      for (const [url, entry] of memoryCache) {
          if (total <= MEMORY_CACHE_BYTES || memoryCache.size <= 1) break;
          if (entry.src.fullJob) continue; // still caching in the background
          total -= keptSize(entry);
          memoryCache.delete(url);
      }
      refreshEyes();
  }

  function keepInMemory(
      url,
      entry,
  ) {
      memoryCache.delete(url);
      memoryCache.set(url, entry);
      trimMemory();
  }

  // Clear every file this previewer cached (its own memory only; nothing else is touched)
  function clearAllCached() {
      if (viewer?.file && memoryCache.has(viewer.file.url)) {
          clearCached(viewer);
          if (memoryCache.has(viewer.file.url)) return; // kept: pending, user stayed
      }
      for (const url of memoryCache.keys()) clearedUrls.add(url);
      memoryCache.clear();
      refreshEyes();
  }

  function clearCached(v) {
      const file = v.file;
      if (!file) return;
      close3d(v);
      forcedUrls.delete(file.url); // asks again next time
      cancelLoad(v, true);
      setBusy(v, false);
      clearedUrls.add(file.url);
      memoryCache.delete(file.url);
      refreshEyes();
      if (!confirmDiscard(v)) return;
      if (v.writeMode) exitWriteView(v);
      v.loadToken++; // anything still on its way is ignored
      v.source = null;
      v.writeBtn.disabled = true;
      v.rerender = null;
      v.relint = null;
      v.text = '';
      v.copyBtn.disabled = true;
      v.loadAllBtn.disabled = true;
      v.clearBtn.disabled = true;
      v.lint.style.display = 'none';
      showSheets(v, null);
      showPlain(v, 'Cache cleared for this file. Use refresh, or open the file again, to cache it anew.');
  }

  // Cancel the fetch; a running "cache all" goes on in the background (unless `stop`)
  function cancelLoad(v, stop = false) {
      if (stop || !(v.source?.fullJob || v.opening)) v.abort?.abort();
      v.opening = false;
      v.abort = null;
      v.lintWorker?.terminate(); // cancels check in progress
      v.lintWorker = null;
  }

  // Module: _core/list.ts

  // SharePoint list: eye per file row and in the header, current folder, clicks

  // ===========================================================================
  // CONSTANTS
  // ===========================================================================

  const NAME_SELECTORS = [
      '[data-automationid="FieldRenderer-name"]',
      '[data-automationid="field-LinkFilename"] button',
      '[data-automationid="field-LinkFilename"] a',
      '[data-automationid="field-LinkFilename"]',
  ].join(',');

  // Single path segment with extension, e.g. "notes.txt"
  const FILENAME_RE = /^[^\\/:*?"<>|\r\n]+\.[A-Za-z0-9_-]{1,12}$/;

  // Folder markers in technical attributes (icon URLs, classes, data-*): same in every UI language
  const FOLDER_RE = /folder/i;
  const TEXT_ATTRS = new Set(['href', 'aria-label', 'title', 'alt']); // links, translated texts

  const EYE_TITLES = {
      closed: 'Preview',
      half: 'Preview (partly cached)',
      open: 'Preview (fully cached)',
  };

  let scheduled = false;

  // Containers of SharePoint's dialogues, panels and pop-ups (Fluent UI layers)
  const OVERLAY =
      '.ms-Layer, .fui-Portal, [role="dialog"], [role="alertdialog"], [aria-modal="true"], .ms-Panel, .ms-Modal, .ms-Callout';

  let headerDirty = true;

  // Changes inside script's own elements (viewer, eyes) don't need new scan
  const OWN = '.tp-viewer, .tp-cell, .tp-head';

  // ===========================================================================
  // METHODS
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // Current folder, from URL only
  //  .../AllItems.aspx?id=/sites/X/Shared Documents/Folder -> id
  //  .../Shared Documents/Forms/AllItems.aspx -> library root
  // ---------------------------------------------------------------------------

  /** @returns page is a library's list view (.../Forms/<view>.aspx): eyes only there */
  function inLibrary() {
      return /\/forms\/[^/]+\.aspx$/i.test(decodeURIComponent(location.pathname));
  }

  /** @returns server-relative folder of the open view, or null outside a library */
  function currentFolder() {
      const params = new URLSearchParams(location.search);
      // "parent" is set while SharePoint shows its own file preview
      const id = params.get('parent') || params.get('id') || params.get('RootFolder');
      if (id) return id.replace(/\/+$/, '');

      const path = decodeURIComponent(location.pathname);
      const i = path.toLowerCase().indexOf('/forms/');
      return i >= 0 ? path.slice(0, i) : null;
  }

  // ---------------------------------------------------------------------------
  // Row inspection (purely from list view's HTML)
  // ---------------------------------------------------------------------------

  function rowName(row) {
      // 1. Known SharePoint name-field selectors
      const el = row.querySelector(NAME_SELECTORS);
      const name = el?.textContent.trim();
      if (name) return name;

      // 2. Fallback: first visible text in row that looks like file name
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.parentElement?.closest('.tp-cell')) continue;
          const text = (node.textContent ?? '').trim(); // text nodes always have text
          if (FILENAME_RE.test(text)) return text;
      }

      // 3. Fallback: title / aria-label attributes that look like file name
      for (const attrEl of row.querySelectorAll('[title], [aria-label]')) {
          for (const attr of ['title', 'aria-label']) {
              const value = (attrEl.getAttribute(attr) || '').trim();
              if (FILENAME_RE.test(value)) return value;
          }
      }
      return null;
  }

  function isFolder(row) {
      const name = rowName(row);
      for (const el of row.querySelectorAll('*')) {
          if (el.closest('.tp-cell')) continue;
          for (const { name: attr, value } of el.attributes) {
              if (TEXT_ATTRS.has(attr)) continue;
              if (value && value !== name && !value.includes(name ?? '\0') && FOLDER_RE.test(value)) {
                  return true;
              }
          }
      }
      return false;
  }

  // Only rows that show file name (skips folders and totals/footer row)
  function isFileRow(row) {
      return !!rowName(row) && !isFolder(row);
  }

  // ---------------------------------------------------------------------------
  // Inject column
  // ---------------------------------------------------------------------------

  // Header eye: overlaid at x position of row eyes (other cell layout)
  function processHeader(row) {
      const rowEye = document.querySelector('.tp-cell');
      const ref = row.querySelector('[role="columnheader"]');
      if (!rowEye || !ref || document.querySelector('.tp-overlay')) return;

      const target = rowEye.getBoundingClientRect();
      let head = document.querySelector('.tp-head');
      if (head) {
          if (Math.abs(head.getBoundingClientRect().left - target.left) < 1) return;
          head.remove(); // layout changed -> reposition
      }

      const refRect = ref.getBoundingClientRect();
      const x = target.left + target.width / 2;
      const y = refRect.top + refRect.height / 2;

      // Host = box under that point in header (or one that contains it)
      let host = document.elementFromPoint(x, y);
      if (!host || !(row.contains(host) || host.contains(row))) host = ref;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

      const hostRect = host.getBoundingClientRect();
      head = document.createElement('span');
      head.className = 'tp-head';
      head.title = 'Open the previewer (no file)';
      head.setAttribute('role', 'button');
      head.tabIndex = 0;
      head.innerHTML = EYE_CLOSED_SVG; // state set by refreshEyes()
      head.style.cssText = `
      position: absolute;
      left: ${target.left - hostRect.left + host.scrollLeft}px;
      top: ${refRect.top - hostRect.top + host.scrollTop}px;
      width: ${COL_WIDTH}px;
      height: ${refRect.height}px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #0078d4; /* blue like the row eyes: clickable */
      cursor: pointer;
      z-index: 1;
    `;
      host.append(head);
      refreshEyes();
  }

  // Return true if row was (re)worked on
  /** @returns true if the row was (re)worked on */
  function processRow(row) {
      if (row.querySelector('[role="columnheader"]')) return false; // header: see processHeader

      // Fast path: same content as last time (SharePoint reuses rows)
      const sig = row.textContent;
      if (row.dataset.tpSig === sig && row.querySelector('.tp-cell')) return false;
      row.dataset.tpSig = sig;

      // One shared grid: nothing may go between cells. eye sits in first cell's
      // reserved left padding, same offset in every row.
      const cells = [...row.querySelectorAll('[role="gridcell"], [role="rowheader"]')].filter(
          (c) => c.getClientRects().length,
      ); // skip hidden cells
      if (!cells.length) return false;
      const target = cells.reduce((a, b) => (b.getBoundingClientRect().left < a.getBoundingClientRect().left ? b : a));

      let cell = target.querySelector(':scope > .tp-cell');
      if (!cell) {
          for (const n of row.querySelectorAll('.tp-cell')) n.remove(); // recycled row
          if (!target.dataset.tpPadded) {
              target.dataset.tpPadded = '1';
              const pad = parseFloat(getComputedStyle(target).paddingLeft) || 0;
              target.style.paddingLeft = `${pad + COL_WIDTH}px`;
              if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
          }
          cell = document.createElement('span');
          cell.className = 'tp-cell';
          cell.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: ${COL_WIDTH}px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
      `;
          target.prepend(cell);
      }

      // Align with row's own icon (at top in tall rows)
      const icons = [...row.querySelectorAll('img, svg, i[data-icon-name]')]; // SVG too: Element methods only
      const icon = icons.find((el) => !el.closest('.tp-cell') && el.getBoundingClientRect().height);
      if (icon) {
          const ir = icon.getBoundingClientRect();
          const mid = ir.top + ir.height / 2 - target.getBoundingClientRect().top;
          cell.style.top = `${Math.round(mid - 14)}px`;
          cell.style.bottom = 'auto';
          cell.style.height = '28px';
      }

      // SharePoint recycles row elements -> re-check state on every pass
      const state = isFileRow(row) ? 'file' : 'none';
      if (cell.dataset.state !== state) {
          cell.dataset.state = state;
          cell.innerHTML =
              state === 'file'
                  ? `
          <span class="tp-preview" role="button" tabindex="0" title="Preview"
                style="display:flex; cursor:pointer; color:#0078d4; padding:4px"></span>
        `
                  : '';
      }
      if (state === 'file') {
          // Which file this row is now (rows are reused), for eye's cache state
          const eye = cell.querySelector('.tp-preview'); // written just above
          const name = rowName(row);
          const folder = currentFolder();
          const guess = folder && `${folder}/${name}`;
          eye.dataset.url = (name && (rowFilePath(row, name) || (guess && (foundPaths.get(guess) || guess)))) || '';
          setEye(eye);
      }
      return true;
  }

  // Eye per file: closed = not cached, half open = partly cached (previewed), open = fully cached
  function eyeState(url) {
      if (url && pendingOpens.has(url)) return 'half'; // first fetch under way (e.g. Parquet)
      const src = url && memoryCache.get(url)?.src;
      if (!src) return 'closed';
      return src.done || (src.total > 0 && src.loaded >= src.total) ? 'open' : 'half'; // all bytes here
  }

  function setEye(eye) {
      // Row of file shown in viewer: highlighted like row under mouse
      const shown = !!(viewer?.file && eye.dataset.url && sameFile(viewer.file.url, eye.dataset.url));
      eye.closest('[role="row"]')?.classList.toggle('tp-row-shown', shown);
      const state = eyeState(eye.dataset.url);
      if (eye.dataset.eye === state) return;
      eye.dataset.eye = state;
      eye.innerHTML = { closed: EYE_CLOSED_SVG, half: EYE_HALF_SVG, open: EYE_FULL_SVG }[state];
      eye.title = EYE_TITLES[state];
  }

  // Called whenever cache changes
  function refreshEyes() {
      document.querySelectorAll('.tp-preview').forEach(setEye);
      // Header eye: closed = no viewer, half = viewer with file, open = viewer without file
      const head = document.querySelector('.tp-head');
      if (head) {
          const state = !viewer ? 'closed' : viewer.file ? 'half' : 'open';
          if (head.dataset.eye !== state) {
              head.dataset.eye = state;
              head.innerHTML = { closed: EYE_CLOSED_SVG, half: EYE_HALF_SVG, open: EYE_FULL_SVG }[state];
          }
      }
      if (viewer) viewer.clearAllBtn.disabled = memoryCache.size === 0;
  }

  function scan() {
      scheduled = false;
      // H-mode panel inside SharePoint's container: put it back if SharePoint re-rendered
      if (viewer?.anchor && !viewer.box.isConnected) syncPanel();
      if (!inLibrary()) {
          for (const el of document.querySelectorAll('.tp-cell, .tp-head')) el.remove(); // left from library page
          return;
      }
      // Only library's list, not grids in dialogues, panels or pop-ups
      const rows = [...document.querySelectorAll('[role="grid"] [role="row"], [role="treegrid"] [role="row"]')].filter(
          (row) => !row.closest(OVERLAY),
      );
      document.querySelectorAll('.tp-cell, .tp-head').forEach((el) => {
          if (el.closest(OVERLAY)) el.remove(); // added before grid moved into overlay
      });
      // Rows first (header eye aligns to them); header re-measured only on change
      let changed = headerDirty;
      for (const row of rows) if (processRow(row)) changed = true;
      headerDirty = false;
      const header = changed && rows.find((r) => r.querySelector('[role="columnheader"]'));
      if (header) processHeader(header);
  }

  /** Watches the list: rescans on DOM changes and resize, plus a first scan. */
  function watchList() {
      new MutationObserver((changes) => {
          if (changes.every((c) => (c.target).closest?.(OWN))) return; // text nodes: no closest()
          if (!scheduled) {
              scheduled = true;
              requestAnimationFrame(scan);
          }
      }).observe(document.body, { childList: true, subtree: true });
      window.addEventListener('resize', () => {
          headerDirty = true; // re-align header eye
          requestAnimationFrame(scan);
      });
      requestAnimationFrame(scan); // first scan once page has settled
  }

  // ---------------------------------------------------------------------------
  // Clicks (capture phase, so SharePoint doesn't select/open row)
  // ---------------------------------------------------------------------------

  const findPreview = (e) =>
      (e.target)?.closest?.('.tp-preview') ?? null;
  const findHead = (e) => (e.target)?.closest?.('.tp-head') ?? null;

  /** Eye clicks and keys (capture phase): preview a row, or open the empty viewer. */
  function handleEyes() {
      for (const type of ['pointerdown', 'mousedown', 'dblclick']) {
          document.addEventListener(
              type,
              (e) => {
                  if (findPreview(e) || findHead(e)) e.stopPropagation(); // not sort / row selection
              },
              true,
          );
      }

      // Header eye: previewer without file (to see it, change settings, ...); again: close
      document.addEventListener(
          'click',
          (e) => {
              if (!findHead(e)) return;
              e.preventDefault();
              e.stopPropagation();
              openEmptyViewer();
          },
          true,
      );
      document.addEventListener(
          'keydown',
          (e) => {
              if (!findHead(e) || (e.key !== 'Enter' && e.key !== ' ')) return;
              e.preventDefault();
              e.stopPropagation();
              openEmptyViewer();
          },
          true,
      );

      document.addEventListener(
          'click',
          (e) => {
              const btn = findPreview(e);
              if (!btn) return;
              e.preventDefault();
              e.stopPropagation();
              openPreview(btn.closest('[role="row"]'));
          },
          true,
      );

      document.addEventListener(
          'keydown',
          (e) => {
              const btn = findPreview(e);
              if (!btn || (e.key !== 'Enter' && e.key !== ' ')) return;
              e.preventDefault();
              e.stopPropagation();
              openPreview(btn.closest('[role="row"]'));
          },
          true,
      );
  }

  // File's path from row's links (search results mix folders)
  function rowFilePath(row, name) {
      const host = location.hostname;

      const toPath = (value) => {
          let u;
          try {
              u = new URL(value, location.href);
          } catch {
              return null;
          }
          if (u.hostname !== host) return null;
          const id = u.searchParams.get('id');
          if (/\.aspx$/i.test(u.pathname) && id) return id;
          return decodeURIComponent(u.pathname.replace(/^\/:[a-z]:\/r(?=\/)/i, ''));
      };
      for (const el of row.querySelectorAll('*')) {
          if (el.closest('.tp-cell')) continue;
          for (const { name: attr, value } of el.attributes) {
              if (!value || value.length > 2000 || !/[/%]/.test(value)) continue;
              if (!/^(href|src|title|aria-label|data-[\w-]+)$/i.test(attr)) continue;
              const path = /^(https?:|\/)/i.test(value) ? toPath(value) : null;
              if (path && path.split('/').pop() === name) return path;
          }
      }
      return null;
  }

  // Module: main.ts

  // Entry of the userscript: modules in load order (they only define), then start-up in one place

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  registerMenu();
  watchList();
  handleEyes();
  injectStyles();
  guardEdits();
})();
