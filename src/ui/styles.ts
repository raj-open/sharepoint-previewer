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

/** Adds the stylesheet (both themes) to the page. @returns {void} */
export function injectStyles() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.documentElement.append(style);
}
