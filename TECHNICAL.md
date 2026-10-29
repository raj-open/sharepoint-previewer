# Technical notes #

For developers: repository, build, tests, and how the script works inside.
For reviewing the script (permissions, network, storage, security, deployment): [NOTES.md](NOTES.md).

## Repository structure ##

| Path | Contents |
| :--- | :------- |
| `/src/main.ts` | entry: imports the modules, then starts up |
| `/src/_core` | Tampermonkey header (`header.ts`), settings, preferences, list view, shared types (`types.ts`) |
| `/src/{readers,text,ui,view,viewer,zen}` | the other modules (TypeScript); `zen`: Zen mode |
| `/src/@apis/ifc-lite/main.ts` | entry of the ifc-lite bundle for the optional 3D view |
| `/scripts` | build and demo scripts (`bundle.ts`, `anon.ts`, `demos.ts`, `hero.ts`) |
| `/demos` | demos with screenshots (`/demos/img`, written by `just demos`) |
| `/.github/workflows` | qa (automatic, manual) and release (cf. [Workflows](#workflows)) |
| `/tests/{unit,behave,integration}` | tests (`tests_*.ts`, run with `node --test`); unit tests mirror `/src` |
| `/templates` | templates for local files (e.g. `.env`) |
| `/dist/VERSION` | version (single source) |
| `/dist/userscript{,.min}.js` | the userscript, bundled from the modules, and minified (written by `just build-src`; local only; version and 3D hashes as dummies) |
| `/models` | (reserved) schemata |
| `specs.md` | public specs and conventions |

## Versions ##

Versions are `MAJOR.MINOR.PATCH` as in [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html);
pre-releases in short form in `/dist/VERSION` (e.g. `1.1.0a1`), in SemVer form in tags (e.g. `v1.1.0-alpha.1`; cf. `just tag`).
The history starts at `v0.0.0` (repository set-up, no source code) and continues with `v1.0.0` (the userscript moved in).
Earlier versions of the userscript were developed without version control and are not part of this history.

## System requirements ##

- The [Justfile](https://just.systems) tool.
- Node.js (≥ 22.18: runs TypeScript itself) for package dependencies, build and tests.
- Bash (Windows users should install e.g. [Git Bash](https://gitforwindows.org)).
- Behavioural tests: a Chromium-based browser.
  `just build-deps` downloads Playwright's Chromium (~120 MB) unless `BROWSER_CHANNEL` in `.env`
  names one installed already (`chrome`, `msedge`); the workflows use the Google Chrome of GitHub's runner image.

## Taskrunner recipes ##

```bash
just setup              # local files (.env, ...) from /templates
just build              # dependencies (per lock) + all artefacts in /dist
just build-src          # /dist/userscript{,.min}.js from the modules (local only)
just build-dist         # artefacts only (dependencies already installed)
just build-anon         # as build, plus the anonymous release /dist/v<BUILD_VERSION>-anon (cf. Artefacts)
just build-dist-anon    # as build-dist, plus the anonymous release (dependencies already installed)
just prettify           # format + lint with fixes (Biome)
just lint-check         # same, dry run
just tests              # all tests (tests-unit, tests-behave, tests-integration)
just tests-explore      # mock Sharepoint with the userscript on localhost (HTTP_PORT in .env); [folder]: own files
just demos [case ...]   # screenshots for /demos (/demos/img); case hero: README animation (needs ffmpeg with libwebp)
just type-check         # type check (strict): modules, tests, scripts
just qa                 # lint checks + type check + all tests
just tag                # release tag of /dist/VERSION (e.g. v1.1.0-alpha.1 for 1.1.0a1)
just clean              # node_modules + built artefacts (incl. /dist/userscript{,.min}.js)
```

## Artefacts ##

Each build writes one flat release folder `/dist/v<BUILD_VERSION>`, named after the userscript's `@version`:

| File | Contents |
| :--- | :------- |
| `sharepoint-previewer.js` | userscript to install |
| `sharepoint-previewer.min.js` | the same, minified (whitespace and syntax; names kept) |
| `ifc-lite-3d.js` | ifc-lite bundle (esbuild, versions pinned in `package.json`; unless `BUILD_3D=false`) |
| `ifc-lite_bg.wasm` | engine binary, copied unchanged from `@ifc-lite/wasm` (unless `BUILD_3D=false`) |
| `NOTES.md` | notes for review (permissions, network, storage, security, deployment) |

The build writes into the userscript:

- `@version` from `/dist/VERSION`
- the SHA-256 hashes of the two 3D files
  (`/dist/userscript{,.min}.js` have dummies: `0.0.0`, `<sha256>`)

So the userscript and the 3D files of one build are deployed together.

`BUILD_3D=false` (`.env`, or `just BUILD_3D=false build`) leaves the 3D files out of the release folder;
they are still built in a temporary folder, so the userscript carries their hashes.
The build is deterministic (versions pinned),
so such a release accepts the 3D files of the last release built with them,
as long as the ifc-lite and esbuild versions are unchanged.
The release workflow includes them only if its checkbox is ticked (default: off).

### Anonymous build ###

`just build-anon` (dependencies installed first, as `just build`) or `just build-dist-anon` writes, beside the release, the anonymous release `/dist/v<BUILD_VERSION>-anon` (same files),
from the bundle without what is marked "anon" (`npm run build:anon`, cf. `/scripts/anon.ts`):

- the regions marked "anon" are left out (marker lines included; other regions may nest inside):

  ```js
  // #region anon
  // @copyright    …
  // #endregion anon
  ```

- `ABOUT_LINKS` is emptied (`{}`: the tab "About" shows no links)

Anything else that is to be left out of the anonymous build is simply marked the same way
(in the header or in any module).
The ordinary release keeps it, without the marker lines.

## Dependencies ##

Development only (nothing is loaded at runtime):

- `@biomejs/biome` - lint + format (cf. `/biome.json`)
- `typescript`, `@types/node` - type check (cf. `/tsconfig.json`); the build removes types with Node itself
- `esbuild` - bundles the 3D view
- `@ifc-lite/geometry`, `@ifc-lite/renderer`, `@ifc-lite/wasm` - 3D view (MPL-2.0)
- `@ifc-lite/parser` - property and quantity sets of the object selected in the 3D view (MPL-2.0)

`just build` installs per `package-lock.json`;
the lock is only rewritten when `package.json` has changed.

## Workflows ##

| Workflow | Runs | Does |
| :------- | :--- | :--- |
| `qa-auto` | each push and pull request | `just qa` |
| `qa-manual` | on demand (any branch, tag or commit) | `just qa` |
| `release` | on a release tag (`just tag`) | `just qa`, then `just build-dist`; attaches the files of `/dist/v<VERSION>` to the GitHub release (pre-release for alpha, beta, rc) |

## Architecture ##

```text
Sharepoint page (DOM)
 └─ userscript (Tampermonkey, @grant GM_getValue/GM_setValue/GM_registerMenuCommand/GM_openInTab)
     ├─ MutationObserver: finds file and folder rows → adds eye cells (HTML only)
     ├─ Viewer (own DOM elements, own CSS, prefix "tp-")
     │   ├─ text view: syntax colours, whitespace markers, virtualised rendering
     │   ├─ table view: CSV / Parquet / spreadsheets / logs, sort, filter, column widths, CSV editing
     │   ├─ Markdown view: own small renderer (no library), raw HTML escaped
     │   └─ 3D view: ifc-lite (optional, loaded from your Sharepoint on first use)
     ├─ Zen mode: own list of the folder in place of Sharepoint's (REST API: read, ValidateUpdateListItem)
     ├─ Sources: same-origin fetch with HTTP Range (chunks), in-memory cache (LRU)
     ├─ Decoders built in: Parquet (Thrift, RLE/bit-packing, dictionary, v1/v2 pages),
     │   Snappy, LZ4_RAW, ZSTD (RFC 8878); GZIP / ZIP via the browser's DecompressionStream;
     │   Power BI data models: XPress9 (ported, MIT), backup (ABF), SQLite (read only);
     │   spreadsheets: OOXML (XML scanner, no DOM), XLSB (BIFF12), XLS (BIFF8/BIFF5 in a
     │   compound file), OpenDocument
     └─ Checks (linters) in a Web Worker created from the script's own code (blob: URL)
```

How the parts communicate: [NOTES.md, §3](NOTES.md#3-communication).

## Viewer ##

- **Eye column** at the far left of every file and folder row in a document library:
  - closed eye = not cached
  - half-open eye = partly cached
  - open eye = fully cached
  - the eye in the column header opens the viewer without a file,
    e.g. to change settings
  - the eye of a folder does the same for that folder (open eye = folder shown)
  - frozen: while the list scrolls sideways, the row eyes stay at its left edge
    (moved by the scroll offset, over the list's background);
    the header eye (its header scrolls away) moves into the Zen tab meanwhile, below the Zen button
- **Viewer** in three layouts:
  - below the list
  - right of the list
  - as a movable pop-up, resizable at its lower right corner (position and size kept)
- **Header:** a bar as the Zen list's (`/src/ui/bar.ts`: start, well, end), the properties below it
  - start: layout, edit, stop / cancel, save, upload (same places as in the Zen list), cache whole file
  - end: ⋯, copy, ✕ (version and logo: in the settings form, version also on About)
  - when narrow (less than 200 px left for the well): the file name on a second row
  - file name, with (i) for the properties and a chain icon:
    a click copies the clean link (not encoded, no query) of the file shown
    (a link file or search result: where it leads),
    or of the folder in the viewer without a file
  - ⋯ menu: full settings (first), dark mode, syntax colours, line wrap, properties, reload, clear cache, about (last);
    no new file (its button is in the well) and no Zen mode (its tab)
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
    its menu lists text formats and file formats (Parquet, spreadsheet, IFCZIP, Power BI) side by side,
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

What the script reads from the list and leaves alone: [NOTES.md, §2](NOTES.md#2-what-it-does).

## Supported formats ##

| Format | Colours | Check (lint) | Table | 3D | Edit |
| :----- | :-----: | :----------: | :---: | :-: | :--: |
| JSON, XML (incl. `.addin`, `.config`, `.csproj`, …) | ✓ | ✓ | | | ✓ |
| YAML, TOML, Power Query M, JavaScript, Python, SQL, Markdown, reStructuredText, Excel formulas (`.xlf`) | ✓ | YAML, M | | | ✓ |
| Log files (`.log`) | ✓ | | ✓ (experimental, read only; text first) | | ✓ |
| CSV / TSV (delimiter detected) | ✓ (per column) | | ✓ (sort, filter, edit cells, rows, columns) | | ✓ |
| Parquet (Snappy, GZIP, ZSTD, LZ4_RAW, uncompressed) | ✓ | | ✓ (read only) | | |
| Spreadsheets: Excel `.xlsx` `.xlsm` `.xltx` `.xltm`, `.xlsb`, `.xls` `.xlt` (97–2003, 5.0/95), OpenDocument `.ods` `.ots` | ✓ | | ✓ (read only, per sheet) | | |
| IFC / IFCZIP | ✓ | ✓ | | ✓ (asks first above 25 MB, setting) | IFC only |
| Power BI `.pbix` `.pbit` `.pbiviz`: overview (Markdown), parts and queries in the picker | ✓ | JSON, XML, M | | | |
| Power BI project files `.pbir` `.pbism` `.pbip` `.pbids`, tabular models `.bim` (JSON) | ✓ | ✓ | | | ✓ |
| Any other text file | – | | | | ✓ |

Spreadsheets show the last saved value of each cell (formulas are not recalculated):
numbers as Excel's "General" shows them (15 significant digits),
percentages with `%`,
dates and times as ISO 8601 (`2026-10-24`, `14:30:00`, `2026-10-24 14:30:00`),
both date systems (1900, 1904).
Number formats beyond that (decimals, currencies, thousands separators) are not applied.
Password-protected workbooks are not opened.

Power BI files are read by range: the archive's directory and its parts (each up to 16 MB);
above 25 MB of parts (setting) the viewer asks first.
Queries and parameters come from `DataMashup` (older `.pbix`) or `DataModelSchema` (`.pbit`);
newer `.pbix` files ("enhanced metadata") keep them only in the data model (`DataModel`):
then it is read as well (asked first above 25 MB),
decompressed (XPress9) in the browser, and its metadata (SQLite) read
(shared expressions and parameters, then the M partitions of the tables);
the data itself is not looked at.
The overview lists the parts as a tree, the Power Query parameters and queries.
The picker (bottom right) lists the parts and the queries side by side;
a part chosen is shown in its own format (JSON, XML, M; recognised from its start if it has no extension),
UTF-16 decoded, JSON indented and JSON held in strings (e.g. `config` in `Report/Layout`) unpacked.
Reports, visuals and data are not shown.

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

## Caching ##

- **Opening a file** fetches the first chunk (default 512 KB).
  "Cache next" fetches the next chunk,
  and "Cache all" fetches the rest in one request
  (chunk by chunk, if that request fails or Sharepoint sends less).
- **Files read by byte range** (spreadsheets, Parquet, Power BI):
  the first request fetches the first 64 KB (small files: all of it);
  smaller reads fetch 64 KB around them,
  and small pieces are kept, so that nearby parts need no further request.
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

## Zen mode ##

An own list of the folder (files, folders and their properties) in place of Sharepoint's list,
on its own: with or without the viewer; demos: [Zen mode](demos/zen.md).

- **On and off:**
  the tab out of the left edge of the list (as on a folder; outline: off, filled: on),
  at the same place for Sharepoint's list and the Zen list, joined to the one seen.
  The eye at the top left of either list opens or closes the viewer;
  the splitter released with the viewer below 20 % of the space (`VIEWER_MIN`) closes it (Zen mode stays).
  Kept (`tp-preview-zen`): on again after a page load, in any library.
  Zen mode uses the same split as the viewer, and the viewer keeps its place (edges of the list measured before Zen mode, `panelEdges`): nothing moves when it is turned on or off.
  Only in a library, and only if the setting `sharepoint-api` allows it (else no tab).
- **Place:**
  laid over Sharepoint's list: beside the viewer, what is left of it, with the viewer's edges
  (below it: same left and right; right of it: same top and bottom; one gap apart);
  without the viewer, or under the pop-up (no backdrop then): all of it.
  Sharepoint's list stays untouched underneath and is seen again when Zen mode ends.
- **Folder:** one for both lists.
  A folder opened in the Zen list is opened in Sharepoint's as well
  (address with `id=<folder>`, announced as Sharepoint's own navigation: `popstate`),
  so Back and Forward work and Zen mode off shows that folder;
  the other way round, a new folder in the address (Back, a link) is shown in the Zen list.
- **Data** (`/src/zen/data.ts`), three reads in parallel, then the items:
  - `GetList(@list)?$select=Title`, `…/Fields?$filter=Hidden eq false`,
    `…/Views?$expand=ViewFields` (the view of the page, else the default view; its columns and its query)
  - `POST …/GetItems?$expand=FieldValuesAsText` with a query scoped to the folder (`FolderServerRelativeUrl`),
    as Sharepoint's own list reads a folder: no filter on the list, so libraries above the list view threshold
    (5,000 items) work as long as the folder itself holds at most 5,000 items (pages of 5,000 by item id)
  - text shown: `FieldValuesAsText` (as Sharepoint formats it); sort key: the raw value for numbers and dates
  - order as in Sharepoint's list (`viewOrder`, `sortItems`): the sort in the address (`sortField`, `isAscending`),
    else the view's (`<OrderBy>` of its query), else by name; text in any case, not numeric (as Sharepoint: 10 before 2);
    the API itself sends the items by id.
    This order holds as long as no column is sorted in the Zen list (sorted off again: back to it)
- **List** (`/src/zen/grid.ts`):
  checkbox column, name column and column titles sticky; folders first;
  sort and filters as in the table view (`/src/view/filter.ts`, shared), on the values shown;
  rows drawn in blocks near the visible part.
- **Columns** (`/src/zen/columns.ts`):
  the view's columns shown at first, all others (not hidden fields) hidden after them;
  order, hidden ones and widths kept per library (`tp-preview-zen-columns`, at most 100 libraries).
  Widths (they never go to Sharepoint) change in any mode, by the right edge of a column title, and are kept at once
  (no Save, not part of the layout draft; `saveWidths`); a double-click on the edge: back to as it fits.
- **Columns pane** (Columns in the ⋯ menu, again or ✕ closes it; `/src/zen/columns.ts`):
  right of the list, over its full height (below the header); the columns in order with a checkbox each (shown or hidden),
  read only until its **Edit** (layout mode); its own bar: Edit, Cancel, Save, Upload (as the list's), ✕.
  Its left edge is dragged to change the width (kept: `tp-preview-zen-pane`); released narrower than 200 px, the pane closes.
- **Layout mode** (Edit in the columns pane): the only mode in which columns are shown or hidden and moved.
  Columns are moved by dragging their titles in the list or the entries of the pane with the pointer
  (`/src/view/reorder.ts`; no HTML drag and drop, which Sharepoint takes for its uploads); meanwhile a copy of the title
  or entry is lifted and moved along, the target is shaded and a blue bar marks where it goes
  (left or right of a column, down the whole list; above or below an entry).
  Changes are a draft (`z.columns`, shown at once; the columns as saved in `z.layout`):
  Save keeps them for the library (in this browser), Cancel / Edit again / ✕ / Esc drop what is not saved (after asking);
  compared as shown (order, hidden ones), not as written out.
  **Upload** (once saved, if they differ from the view; asks first: it changes the view for everyone)
  writes the columns into the page's Sharepoint view (`uploadView` in `/src/zen/data.ts`):
  `POST …/Views(guid'<id>')/ViewFields/removeAllViewFields`, then `addViewField('<name>')` per column in order,
  the view's name fields (icon, name) first as they were; needs the right to manage the list; widths stay in the browser.
  Layout mode and editing properties exclude each other (the other Edit disabled);
  sort and filters work in every mode.
- **Selection** (`/src/zen/select.ts`), as in Sharepoint's view: a checkbox per row, the head's for all rows shown (or none);
  Shift + click: the range from the last one clicked (in the order shown); outside edit mode on a row as well,
  Ctrl / ⌘ + click on a row picks it (or drops it) without opening it.
  Ctrl / ⌘ + A with the pointer over the list picks all items it shows (all loaded, also those scrolled out of sight;
  filtered out: not; nothing more read), unless the text cursor is in a field, the viewer, a bar or the columns pane.
  Esc or a click elsewhere drops the selection (not one on Download, Delete / Purge, a checkbox, a row by Shift or Ctrl / ⌘,
  the list's scrollbars; not while a download or delete runs); on release, so a click that shifts the rows still arrives.
  A selection belongs to its folder (another folder: none); rows filtered out are dropped from it.
- **Download** (`/src/zen/download.ts`, download button; again while running: stop):
  one file as it is; else a ZIP named after the folder shown (one folder alone: after it), paths inside the folder shown,
  folders with everything below them (`loadEntries`: the same query scoped to each folder, no properties; depth first).
  Files are fetched by the page (4 at a time, same origin only) and packed in the browser
  (`/src/zen/pack.ts`: ZIP after PKWARE's APPNOTE, UTF-8 names, deflated where smaller, dates from `Last-Modified`; no ZIP64);
  limits: 2 GB, 10,000 files (`MAX_DOWNLOAD`, `MAX_FILES`; Sharepoint's own download for more).
- **Delete** (`/src/zen/delete.ts`, bin button; Delete key or ⌘ + Backspace in the list, not while typing in a field):
  asks first (`confirm`: number and names of the items, at most 20, folders marked and warned of: all in them go too);
  then item by item `POST …/GetList(@list)/items(<id>)/recycle()`, as Sharepoint's own Delete:
  to the site's recycle bin (restorable there), a folder with everything below it.
  The folder is read anew; items refused are named with Sharepoint's reason;
  a file shown in the viewer (or in a folder deleted) closes the viewer.
- **Purge** (same module; the bin with Shift held turns into a red flame: Shift + click; Shift + Delete or ⌘ + ⌥ + Backspace in the list, as Explorer and Finder):
  as Delete, but for good: `POST …/items(<id>)/deleteObject()`, not to the recycle bin;
  the question says so plainly (cannot be restored, cannot be undone).
- **Files dragged in** (`/src/zen/drop.ts`): uploaded by Sharepoint itself, not by the userscript.
  While files are dragged over the page (`dataTransfer.types` has `Files`), the Zen list lets the pointer through
  (class `tp-zen-drop`: `pointer-events: none`, dashed outline, a hint),
  so the drag and the drop reach Sharepoint's list beneath (same folder: cf. `showInSharepoint`),
  which uploads as usual (its progress, conflicts, rights).
  The drag ends at the drop, or once no `dragover` came for 300 ms (drags from outside fire no `dragend`).
  Dropped on the Zen list: Sharepoint's list is watched (own eyes ignored);
  once it has changed and settled (1 s), the folder is read anew; watched until quiet for 2 minutes.
- **Bar:** as the viewer's (`/src/ui/bar.ts`): eye, Edit, Cancel, Save, Upload (Save and Cancel: of the mode on; same places as in the viewer), Download, Delete (with Shift: Purge); crumbs (the well); ⋯, ✕.
  Bars one above the other (Zen list over the viewer) get start and end groups of the same width: the wells line up.
  Below it, as the viewer's properties, the folder line: items (folders, files) and the latest change, a note, the selection (or progress);
  (i) in the well switches it on and off, one setting with the viewer's properties (`toggleProps`);
  off, the line shows only while there is something to say (note, selection, progress), without the facts.
  The tab is as long as the Zen list's header (bar and folder line): its curve meets the header's lower edge.
  ⋯ (`/src/zen/menu.ts`): full settings (first), columns (the pane), dark mode (shared with the viewer: `toggleTheme` in `/src/viewer/panel.ts`), reload of the folder, about (last).
  ✕: Zen mode off.
  Narrow (as the viewer's): the crumbs on a second row, full width.
- **Editing:**
  editable are fields of type Text, Note, Number, Currency, Choice, MultiChoice, Boolean, DateTime
  that are not read only and not system fields (`ContentType`, names starting with `_`, …);
  the name (`FileLeafRef`) as a rename (checked against Sharepoint's rules first).
  Values are typed as Sharepoint shows them (dates in the regional format of the site);
  yes / no as `1` / `0`, several choices as `;#a;#b;#`.
  As in write mode of the viewer, Save and Upload are two steps:
  Save keeps the changes in the view (`/src/zen/changes.ts`: per folder, `tp-preview-zen-changes`, at most 50 folders;
  also after another folder, Zen mode off or a page load), nothing is sent;
  Upload applies them: per item one `POST …/items(<id>)/ValidateUpdateListItem` (`bNewDocumentUpdate: false`: a new version),
  with a form digest (`POST _api/contextinfo`, kept until it runs out);
  the reasons of refused values are shown per cell (they stay in the view), the rest is applied; then the folder is read anew.
  Leaving edit mode (edit button, Esc), the folder or Zen mode without saving is allowed: the changes are kept in the view,
  with the note that they take effect only once uploaded (the upload button marked).
  A file in the viewer that was renamed is shown under its new name.
- **Keys:** Ctrl / ⌘ + S saves (edit mode: kept in the view; layout mode: the columns);
  Esc (wherever the focus is) closes a menu, then ends layout mode (asks for unsaved columns), then closes the columns pane,
  then ends edit mode, then closes the viewer.
- **Changes not uploaded** (or columns not saved): Cancel drops them (after asking); leaving the page asks first;
  Zen mode off with columns not saved asks first.
- **Tab:** in Sharepoint's colours while Zen mode is off, in the theme of the Zen list while it is on.
  Flush with the top of the list (the top left corner of Sharepoint's list and of the Zen list made square there),
  with room below the Zen button for the header eye (while Sharepoint's list is scrolled sideways).

## Editing and upload ##

- **Write mode** is available for plain-text files.
  - The whole file is cached first;
    above 16 MB the user is asked.
  - CSV can be edited in the table:
    cells, rows and columns can be inserted, moved and deleted,
    and delimiter and quote style can be changed;
    rows (by their numbers) and columns (by their titles) are moved as the Zen list's columns
    (`/src/view/reorder.ts`: a lifted copy, the target shaded, a bar where it goes).
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

## Settings ##

They are opened via the Tampermonkey menu → "Settings …",
or the viewer's ⋯ → "Full settings …".
There is a form view and a JSON view (with validation),
plus "Reset to defaults";
Ctrl / ⌘ + S saves (as Save).
The Tampermonkey menu → "Edit (v…)" and the version top right (viewer, settings form)
open Tampermonkey's editor of the script (e.g. to upgrade).

The tab "About" (Tampermonkey menu → "About …", or ⋯ → "About …" of the viewer and of the Zen list;
`/src/_core/about.ts`): name and version, installation in brief, the controls hard to discover, links.
The links come from `ABOUT_LINKS` in `/src/_core/config.ts`, the first module of the userscript (at its very top),
one line per link (label: URL, http(s) only); a line commented out drops its link,
none left: no link section at all.
The anonymous build empties it (cf. Artefacts).

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
| `powerbi-confirm-bytes` | 25 MB | Power BI files ask first if their parts to read (data model left out) exceed this; the same for the data model, read for its queries |
| `parquet-rows` | `100` | Table rows shown per step |
| `max-line-chars` | `5000` | Longer lines are cut for display |
| `follow-links` | `true` | Follow `.url` link files (same origin only) |
| `sharepoint-api` | `true` | Allow features that use Sharepoint's REST API (Zen mode, finding files of search results); off: no API request at all |
| `viewer-3d-folder` | *(empty)* | Folder with the 3D files: relative to the site, or from the top with a leading `/` |
| `viewer-3d-max-bytes` | 25 MB | 3D view asks first (each time) above this IFC size |
| `logo` | *(empty)* | `data:image/…` URI shown in the header of the settings form |

Settings that are start values (layout, size, theme, colours, wrap)
are then overridden by the user's last choice in the viewer.
Changing them in the form resets that remembered choice.
