# Sharepoint Previewer - Technical Notes #

A userscript (Tampermonkey)
that adds a preview column to Sharepoint Online document libraries.
It shows text-like files directly in the browser,
including files Sharepoint itself cannot preview.
It displays CSV, Parquet and spreadsheets (Excel, OpenDocument) as sortable tables,
IFC building models in 3D
and Markdown as formatted text,
and offers a simple editor for plain-text files.

This document is written for IT staff
who need to decide whether the script can be used permanently within the company's Sharepoint.
It describes what the script does,
what it does **not** do,
which network requests it makes
and where it stores data.

---

## 1. Summary for decision makers ##

| Topic | Behaviour |
| :---- | :-------- |
| Form | One JavaScript file (userscript, ~280 KB; minified ~200 KB), runs in the user's browser via Tampermonkey. Built from TypeScript modules in the repository (types removed by the build) |
| Scope | Only on `https://*.sharepoint.com/*/*/*`, and only inside a library's file list |
| APIs | **No** Sharepoint REST / Graph API calls. It reads the page's HTML and fetches the file itself, like opening its URL |
| Third parties | **None.** No CDN, no analytics, no external servers. All requests go to the same Sharepoint origin |
| External libraries | None in the script itself. Optional 3D view: two files (ifc-lite, MPL-2.0) that **you** host in your own Sharepoint |
| Permissions | Those of the signed-in user, through the browser's normal session. No extra rights, no tokens |
| Data leaving the browser | Only when the user explicitly uploads a file (edited, new, or a renamed copy), through Sharepoint's own upload (as if done by hand) |
| Storage | Settings in Tampermonkey's script storage. View choices and window positions in the browser's `localStorage` for the Sharepoint origin. File contents only in memory, gone on reload |
| Cookies | Not used |
| Tampermonkey grants | `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand` (settings only) |

---

## 2. What the user sees ##

- **Eye column** at the far left of every file and folder row in a document library:
  - closed eye = not cached
  - half-open eye = partly cached
  - open eye = fully cached
  - the eye in the column header opens the viewer without a file,
    e.g. to change settings
  - the eye of a folder does the same for that folder (open eye = folder shown)
- **Viewer** in three layouts:
  - below the list
  - right of the list
  - as a movable pop-up
- **Header:**
  - layout, edit, cache whole file, stop / cancel, save, upload
  - file name, with (i) for the properties and a chain icon:
    a click copies the clean link (not encoded, no query) of the file shown
    (a link file or search result: where it leads),
    or of the folder in the viewer without a file
  - ⋯ menu: new file, full settings, dark mode, syntax colours, line wrap, properties, reload, clear cache
- **Properties line:**
  modified date (from the file's own HTTP response),
  size, format, encoding, indentation,
  CSV delimiter and table shape,
  Parquet details,
  number of sheets and tables, shape of the sheet or table shown.
- **Status bar:**
  - left: cache progress
    (blue while caching, neutral when idle or complete),
    with a "click to fully cache" hint
  - right: format of the file (recognised from its name);
    its menu lists text formats and file formats (Parquet, spreadsheet, IFCZIP) side by side,
    any of them can be chosen (also a wrong one: the file is then read as that format, or a message says why not;
    a chosen format is marked and kept while the page is open);
    text size **− 100 % +**
    (also Ctrl / ⌘ with + − 0, or Ctrl / ⌘ + wheel, in the content area);
    view switch **Text | Preview**,
    the preview by file type: **Table** (CSV, Parquet, spreadsheets, logs), **3D** (IFC), **Markdown**;
    for spreadsheets a picker right of **Table**:
    its menu shows the sheets or the tables, switched with ‹ › or ← →
    (● cached, ○ not cached yet; hidden sheets marked);
    picking a table shows tables, picking a sheet shows sheets
    (start value: setting `spreadsheet-view`, then the last choice per file);
    spreadsheets larger than `spreadsheet-autoload-bytes` show nothing until a sheet or table is chosen,
    the sheet shown is also named next to the file name
- **Text view:** Ctrl / ⌘ + A (once clicked into it) selects the whole text, copy gives the whole cached text
- **Markdown view:** headings, lists, task lists, quotes, code (with colours), tables, links, images;
  raw HTML is shown as text;
  links open in a new tab (scripts not followed);
  images are shown only from the same Sharepoint, others only as links (nothing fetched from elsewhere)

The script never changes Sharepoint's own UI,
apart from adding the eye column and making room for the viewer.
It ignores lists inside dialogues and pop-ups (e.g. "Copy to"),
and it does not depend on the UI language.

---

## 3. Architecture ##

```text
Sharepoint page (DOM)
 └─ userscript (Tampermonkey, @grant GM_getValue/GM_setValue/GM_registerMenuCommand)
     ├─ MutationObserver: finds file and folder rows → adds eye cells (HTML only)
     ├─ Viewer (own DOM elements, own CSS, prefix "tp-")
     │   ├─ text view: syntax colours, whitespace markers, virtualised rendering
     │   ├─ table view: CSV / Parquet / spreadsheets / logs, sort, filter, column widths, CSV editing
     │   ├─ Markdown view: own small renderer (no library), raw HTML escaped
     │   └─ 3D view: ifc-lite (optional, loaded from your Sharepoint on first use)
     ├─ Sources: same-origin fetch with HTTP Range (chunks), in-memory cache (LRU)
     ├─ Decoders built in: Parquet (Thrift, RLE/bit-packing, dictionary, v1/v2 pages),
     │   Snappy, LZ4_RAW, ZSTD (RFC 8878); GZIP / ZIP via the browser's DecompressionStream;
     │   spreadsheets: OOXML (XML scanner, no DOM), XLSB (BIFF12), XLS (BIFF8/BIFF5 in a
     │   compound file), OpenDocument
     └─ Checks (linters) in a Web Worker created from the script's own code (blob: URL)
```

- **File identification:**
  - the file name is read from the row's HTML
  - the folder comes from the browser URL (`id=` parameter or library path)
  - in search results, the path is taken from the row's own link
- **Nothing else from the list is read.**
  No column values, no hidden data.

---

## 4. Network behaviour (complete list) ##

All requests use `fetch` with `credentials: 'same-origin'`
and are **refused by the script if the target is not the current Sharepoint origin**.

| Request | When | Purpose |
| :------ | :--- | :------ |
| `GET <file>` with `Range: bytes=…` | Opening a file; "Cache next"; "Cache all" | Read the file in chunks (default 512 KB). If Sharepoint ignores ranges, one transfer is kept paused between chunks |
| `GET <file>` `Range: bytes=0-3` | Opening a Parquet file | File size; then footer and needed column chunks by range |
| `GET <file>` (whole) | Opening an `.ifczip` (after confirmation if > chunk size) | ZIP archive, unpacked in the browser |
| `GET <file>` `Range: bytes=0-7`, then further ranges | Opening a spreadsheet; choosing another sheet; "Cache next sheet" | Size and signature; then only the parts needed: ZIP directory, workbook, shared strings, styles and the sheet shown (`.xls`: the sectors of the workbook globals and of that sheet) |
| `GET <target>` | Opening a `.url` link file | Follows the link, same origin only, max. 5 hops |
| `GET <site>/_api/web/GetList(…)/items`, if refused `GET <site>/_api/search/query` | Opening a file from search results in a library (rows there carry only the name) | Finds the file's path below the open folder, by name: library list first, search index as fallback |
| `HEAD <file>` | After an upload | Checks that the file really changed (ETag / Last-Modified / size) |
| `GET <VIEWER_3D_FOLDER>/ifc-lite-3d.js`, `…/ifc-lite_bg.wasm` | First use of the 3D view only | 3D library from **your** Sharepoint; checked against fixed SHA-256 hashes before use |

There are no other requests:
no telemetry,
no update checks
and no fonts or images from outside.
The logo setting only accepts `data:` URIs.

---

## 5. Data handling and storage ##

| What | Where | Lifetime |
| :--- | :---- | :------- |
| File contents (cached chunks) | JavaScript memory of the tab | Until reload, "Clear cache", or eviction at the cache limit |
| Settings (16 values, see §9) | Tampermonkey storage for this script | Until changed / reset / script removed |
| View choices (layout, split size, theme, colours, wrap, text size, table / Markdown / 3D on/off, properties lines, CSV format, sheets or tables per spreadsheet path) and window positions | `localStorage` of the Sharepoint origin, keys `tp-preview-*` | Until the user clears site data |
| 3D camera per file | Memory | Until reload |

- **Cache limit:**
  all cached files together are limited (default 256 MB).
  - If the cache is full,
    opening another file asks first (OK / Cancel)
    whether to clear the other cached files.
  - Files still caching in the background
    and the file on screen are never cleared.
- **Memory use:**
  text uses roughly twice its file size in the browser's memory.

---

## 6. Supported formats ##

| Format | Colours | Check (lint) | Table | 3D | Edit |
| :----- | :-----: | :----------: | :---: | :-: | :--: |
| JSON, XML (incl. `.addin`, `.config`, `.csproj`, …) | ✓ | ✓ | | | ✓ |
| YAML, TOML, Power Query M, JavaScript, Python, SQL, Markdown, reStructuredText, Excel formulas (`.xlf`) | ✓ | YAML, M | | | ✓ |
| Log files (`.log`) | ✓ | | ✓ (experimental, read only; text first) | | ✓ |
| CSV / TSV (delimiter detected) | ✓ (per column) | | ✓ (sort, filter, edit cells, rows, columns) | | ✓ |
| Parquet (Snappy, GZIP, ZSTD, LZ4_RAW, uncompressed) | ✓ | | ✓ (read only) | | |
| Spreadsheets: Excel `.xlsx` `.xlsm` `.xltx` `.xltm`, `.xlsb`, `.xls` `.xlt` (97–2003, 5.0/95), OpenDocument `.ods` `.ots` | ✓ | | ✓ (read only, per sheet) | | |
| IFC / IFCZIP | ✓ | ✓ | | ✓ (up to 8 MB, setting) | IFC only |
| Any other text file | – | | | | ✓ |

Spreadsheets show the last saved value of each cell (formulas are not recalculated):
numbers as Excel's "General" shows them (15 significant digits),
percentages with `%`,
dates and times as ISO 8601 (`2026-10-24`, `14:30:00`, `2026-10-24 14:30:00`),
both date systems (1900, 1904).
Number formats beyond that (decimals, currencies, thousands separators) are not applied.
Password-protected workbooks are not opened.

Tables (Excel's "Format as Table" in `.xlsx` and `.xlsb`; named database ranges in `.ods`)
can be shown instead of whole sheets:
the table's rows below its header row (totals rows left out), its column names as header.
`.xls` files show sheets only.
The text view of a sheet shows the column letters as first line and the row numbers as first column,
as Excel does (`,A,B,C`, then `1,…`).

Log files (experimental) open as text; their table view is chosen separately (`tp-preview-log-table`).
It guesses the fields from the start of the lines
(time, level, `[…]` context, logger or process name before a separator,
a source word such as a host before one of these; e.g. Python `logging`, log4j, syslog):
one row per entry with its line number, the fields found and the message;
lines that do not start an entry (stack traces, printed tables, other output) are added to the message as one block
(⏎ in the cell).
Rows with such blocks, JSON or Python-like objects and lists in their message expand (▸ in the row number):
the message split into text and objects / lists, these indented and coloured (numbers as written);
▸ above the row numbers expands (▾ collapses) all rows shown, as filtered.
Without recognisable fields the table view is not offered.

Other binary files (PDF, Word, PowerPoint, images, archives, …)
are detected from their first bytes and not shown.

---

## 7. Caching logic ##

- **Opening a file** fetches the first chunk (default 512 KB).
  "Cache next" fetches the next chunk,
  and "Cache all" fetches the rest.
- **Spreadsheets are cached sheet by sheet:**
  opening one fetches the workbook's directory, shared strings and styles
  and the sheet that was active when it was saved.
  Other sheets are fetched when chosen in the drop-down,
  or with "Cache next sheet" / "Cache all".
  OpenDocument files hold all sheets in one part, so they are cached whole.
  The eye is fully open once every sheet is cached.
- **Big files:**
  - Big Parquet and IFCZIP files (larger than one chunk)
    are **not** fetched automatically.
    The viewer asks the user to fully cache them.
  - "Cache all" asks for confirmation above 16 MB (setting).
- **Background caching:**
  a running full cache,
  or the first fetch of a Parquet / IFCZIP file,
  continues in the background when the user switches to another file.
  Coming back resumes the display;
  nothing is fetched twice.
  The stop button cancels it.
- **Clearing:**
  - "Clear this file" / "Clear all files" remove contents from memory.
  - The browser's own HTTP cache is bypassed (`cache: 'reload'`)
    on the next fetch of a cleared file.
- **Progress bar:**
  blue only while caching.
  "Fully cached" only when every byte is present
  (percentages are rounded down).

---

## 8. Editing and upload ##

- **Write mode** is available for plain-text files.
  - The whole file is cached first;
    above 16 MB the user is asked.
  - CSV can be edited in the table:
    cells, rows and columns can be inserted, moved and deleted,
    and delimiter and quote style can be changed.
- **Another name** (click the file name, or F2):
  - Text files: in write mode; the name is saved with the text.
    The upload then creates a new file (or replaces the one of that name, after asking again).
  - Read-only files (spreadsheets, Parquet, other binary files): any time;
    the file is uploaded unchanged as a copy under the new name (after asking).
  - Either way the name is checked against Sharepoint's rules
    (if a file of that name exists, the user is asked),
    the original file stays unchanged,
    and the viewer opens the new file.
- **New file:**
  button in the title of the empty viewer (eye in the column header), or ⋯ menu.
  - Plain text only: names of spreadsheets, Parquet and other binary types are refused;
    the name is checked as above
    (a new file goes into the folder open in Sharepoint).
  - It is shown as any file of its format (by extension, or chosen in the format picker):
    colours, checks, Text / Preview.
  - The empty text counts as saved: it may be uploaded as it is.
  - Cancel goes back to the empty viewer.
- **Save** keeps the edits in the browser (staged).
  **Upload** is a separate step.
- **Upload uses no API.**
  The script hands the file to Sharepoint the way a user would:
  1. a simulated drop onto the file list, or
  2. Sharepoint's own file-upload input.

  Sharepoint then performs the upload as the signed-in user,
  including its usual "replace?" prompt.
  A `HEAD` request then confirms the change
  (the status bar shows the wait: up to 20 s per way).
- **If Sharepoint does not accept it,**
  the user is offered a local save of the edited file to upload by hand.
- **Cancel** (button) ends write mode
  and drops all changes (unsaved and saved, not yet uploaded),
  after asking if there are any.
- **Esc** only ends write mode, as the edit button does
  (saved changes stay; asks if there are unsaved ones);
  Esc again closes the viewer.
- **Unsaved or not-yet-uploaded changes** trigger warnings:
  when cancelling,
  switching files,
  closing the viewer
  or leaving the page.

---

## 9. Settings ##

They are opened via the Tampermonkey menu → "Settings …",
or the viewer's ⋯ → "Full settings …".
There is a form view and a JSON view (with validation),
plus "Reset to defaults".

| Key | Default | Meaning |
| :-- | :------ | :------ |
| `layout` | `horizontal` | Start layout: `horizontal`, `vertical`, `popup` |
| `viewer-share` | `0.33` | Share of the space for the viewer (0.2 – 0.8) |
| `theme` | `light` | `light` / `dark` |
| `show-whitespace` | `true` | Markers for spaces and tabs |
| `wrap-lines` | `false` | Wrap long lines |
| `colours-text` / `colours-table` / `colours-log` | `true` / `false` / `true` | Syntax colours per view (`colours-log`: table view of logs) |
| `colours-sheet` | `false` | Column colours in the table view of spreadsheets (rows are always striped) |
| `spreadsheet-view` | `tables` | Spreadsheets show `sheets` or `tables` (sheets if a file has none); the last choice is kept per file, a new value here resets those |
| `spreadsheet-autoload-bytes` | 512 KB | Larger spreadsheets cache no sheet until a sheet or table is chosen |
| `cache-chunk-bytes` | 512 KB | Chunk size; also the threshold for asking before big Parquet / IFCZIP |
| `memory-cache-bytes` | 256 MB | Cache limit for all files together |
| `cache-all-confirm-bytes` | 16 MB | "Cache all" asks above this size |
| `parquet-rows` | `100` | Table rows shown per step |
| `max-line-chars` | `5000` | Longer lines are cut for display |
| `follow-links` | `true` | Follow `.url` link files (same origin only) |
| `viewer-3d-folder` | *(empty)* | Folder with the 3D files: relative to the site, or from the top with a leading `/` |
| `viewer-3d-max-bytes` | 8 MB | 3D view only up to this IFC size |
| `logo` | *(empty)* | `data:image/…` URI shown in the header |

Settings that are start values (layout, size, theme, colours, wrap)
are then overridden by the user's last choice in the viewer.
Changing them in the form resets that remembered choice.

---

## 10. Security assessment ##

### Risk reduction ###

- **No new attack surface on the server side:**
  - no API usage
  - no server component
  - no app registration
  - no extra permissions (only the user's existing session)
- **Same origin only:**
  every fetch target is checked against `location.origin`.
  Link files are not followed to other sites.
- **No third-party code at runtime:**
  the optional 3D library is hosted by you
  and verified by SHA-256 before it is executed.
- **No data leaves the browser**
  except through a user-initiated upload to the same Sharepoint.
- **HTML escaping:**
  file contents are always escaped before they are put into the page.

### For further consideration ###

- **Userscripts run with access to the page.**
  Any userscript manager can, in principle, read what the user sees.
  Trust therefore depends on reviewing this file and controlling its distribution
  (pin the version, disable auto-update from untrusted URLs).
- **3D view:**
  - It runs the ifc-lite bundle with `new Function(...)` and compiles WebAssembly.
  - Sharepoint's Content Security Policy (CSP) could block this in future.
    The script then shows "3D view failed"
    and everything else keeps working.
  - It needs WebGPU (current Chrome / Edge).
- **Checks run in a Web Worker**
  created from a `blob:` URL, built from the script's own code.
  If workers are blocked, checks run on the page instead.
- **Upload simulation depends on Sharepoint's UI** (drop target / file input).
  Changes by Microsoft may break it;
  the script then offers a local save instead.
- **DOM dependence:**
  the eye column relies on Sharepoint's ARIA roles
  (`role="grid"`, `row`, `columnheader`, `gridcell`).
  Microsoft UI changes may require adjustments.

---

## 11. Deployment options ##

1. **Per user:**
   install Tampermonkey (Chrome / Edge),
   then install the script.
   Suitable for pilots.
2. **Managed:**
   - Deploy Tampermonkey through browser policy
     (Edge / Chrome extension allow-list / force-install).
   - Provide the reviewed script from an internal location.
   - Keep auto-update pointed only at that internal URL.
3. **3D view (optional):**
   - Put `ifc-lite-3d.js` (~1 MB) and `ifc-lite_bg.wasm` (~10 MB)
     into a Sharepoint library readable by the users.
   - Set `viewer-3d-folder`.
   - The script contains the expected SHA-256 hashes;
     files that don't match are refused.
   - Source of the bundle:
     `@ifc-lite/geometry`,
     `@ifc-lite/renderer`,
     `@ifc-lite/wasm`
     (versions pinned in `package.json` of the release),
     bundled with esbuild into one file
     that only exposes `globalThis.IfcLite`.
   - The `.wasm` file is the unchanged engine binary published in `@ifc-lite/wasm`.
   - Both files are delivered with each release of the script.
     The script only accepts the 3D files of its own release (SHA-256),
     so the script and the 3D files are always deployed together.

**Long-term alternative:**
if a permanent, company-wide solution is preferred,
the same logic could be ported to an SPFx extension
(list view command set / field customiser).
That is outside the scope of this script.

---

## 12. Limitations and status ##

- **Platform:**
  Sharepoint Online (modern library view); Chrome and Edge.
  The 3D view needs WebGPU.
- **Not supported:**
  - Word and PowerPoint files
  - editing spreadsheets (read only);
    their charts, images, comments and cell formatting (colours, merged cells)
  - Excel 2.x–4.x files and encrypted workbooks
  - Parquet nested types beyond simple lists
  - ZIP archives other than IFCZIP and spreadsheets
- **Dates:**
  the modified date comes from the HTTP response of the file.
  Sharepoint may report the time the file was served
  rather than when it was last changed.
- **Testing:**
  - Every module of the script has unit tests outside the browser
    (decoders for Parquet, Snappy, LZ4, ZSTD and spreadsheets, linters, highlighters, cache, …).
  - The spreadsheet reader was also checked against the public test files of
    the calamine library (~150 real-world workbooks).
  - The UI was tested in Chromium against a mock of Sharepoint's markup
    and by hand in Sharepoint Online.
  - Upload and 3D rendering were tested by hand only.

---

## 13. Credits and licences ##

- **The script:**
  written for this purpose and contains no third-party code;
  licence: MPL-2.0, see `LICENCE` in the repository
  (also named in the script's header: `@copyright`, `@license`).
- **Tampermonkey** (<https://www.tampermonkey.net>, by Jan Biniok):
  browser extension that runs the script;
  installed separately, not distributed with the script.
- **Optional 3D bundle:**
  IFClite by Louis Trümpler & contributors (LTplus AG), **MPL-2.0**
  (<https://ifclite.dev>, source code: <https://github.com/LTplus-AG/ifc-lite>).
  Used unchanged, as permitted.
  Modified IFClite source files would have to stay under MPL-2.0.
