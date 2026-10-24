# SharePoint Previewer - Technical Notes #

A userscript (Tampermonkey)
that adds a preview column to SharePoint Online document libraries.
It shows text-like files directly in the browser,
including files SharePoint itself cannot preview.
It displays CSV and Parquet as sortable tables
and IFC building models in 3D,
and offers a simple editor for plain-text files.

This document is written for IT staff
who need to decide whether the script can be used permanently within the company's SharePoint.
It describes what the script does,
what it does **not** do,
which network requests it makes
and where it stores data.

---

## 1. Summary for decision makers ##

| Topic | Behaviour |
| :---- | :-------- |
| Form | One JavaScript file (userscript, ~7,000 lines), runs in the user's browser via Tampermonkey |
| Scope | Only on `https://*.sharepoint.com/*/*/*`, and only inside a library's file list |
| APIs | **No** SharePoint REST / Graph API calls. It reads the page's HTML and fetches the file itself, like opening its URL |
| Third parties | **None.** No CDN, no analytics, no external servers. All requests go to the same SharePoint origin |
| External libraries | None in the script itself. Optional 3D view: two files (ifc-lite, MPL-2.0) that **you** host in your own SharePoint |
| Permissions | Those of the signed-in user, through the browser's normal session. No extra rights, no tokens |
| Data leaving the browser | Only when the user explicitly uploads an edited file, through SharePoint's own upload (as if done by hand) |
| Storage | Settings in Tampermonkey's script storage. View choices and window positions in the browser's `localStorage` for the SharePoint origin. File contents only in memory, gone on reload |
| Cookies | Not used |
| Tampermonkey grants | `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand` (settings only) |

---

## 2. What the user sees ##

- **Eye column** at the far left of every file row in a document library:
  - closed eye = not cached
  - half-open eye = partly cached
  - open eye = fully cached
  - the eye in the column header opens the viewer without a file,
    e.g. to change settings
- **Viewer** in three layouts:
  - below the list
  - right of the list
  - as a movable pop-up
- **Header:**
  - layout, edit, cache whole file, stop / cancel, save, upload
  - file name
  - ⋯ menu: full settings, dark mode, syntax colours, line wrap, properties, reload, clear cache
- **Properties line:**
  modified date (from the file's own HTTP response),
  size, format, encoding, indentation,
  CSV delimiter and table shape,
  Parquet details.
- **Status bar:**
  - left: cache progress
    (blue while caching, neutral when idle or complete),
    with a "click to fully cache" hint
  - right: view switch **Text | Table | 3D**

The script never changes SharePoint's own UI,
apart from adding the eye column and making room for the viewer.
It ignores lists inside dialogues and pop-ups (e.g. "Copy to"),
and it does not depend on the UI language.

---

## 3. Architecture ##

```text
SharePoint page (DOM)
 └─ userscript (Tampermonkey, @grant GM_getValue/GM_setValue/GM_registerMenuCommand)
     ├─ MutationObserver: finds file rows → adds eye cells (HTML only)
     ├─ Viewer (own DOM elements, own CSS, prefix "tp-")
     │   ├─ text view: syntax colours, whitespace markers, virtualised rendering
     │   ├─ table view: CSV / Parquet, sort, filter, column widths, CSV editing
     │   └─ 3D view: ifc-lite (optional, loaded from your SharePoint on first use)
     ├─ Sources: same-origin fetch with HTTP Range (chunks), in-memory cache (LRU)
     ├─ Decoders built in: Parquet (Thrift, RLE/bit-packing, dictionary, v1/v2 pages),
     │   Snappy, LZ4_RAW, ZSTD (RFC 8878); GZIP / ZIP via the browser's DecompressionStream
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
and are **refused by the script if the target is not the current SharePoint origin**.

| Request | When | Purpose |
| :------ | :--- | :------ |
| `GET <file>` with `Range: bytes=…` | Opening a file; "Cache next"; "Cache all" | Read the file in chunks (default 512 KB). If SharePoint ignores ranges, one transfer is kept paused between chunks |
| `GET <file>` `Range: bytes=0-3` | Opening a Parquet file | File size; then footer and needed column chunks by range |
| `GET <file>` (whole) | Opening an `.ifczip` (after confirmation if > chunk size) | ZIP archive, unpacked in the browser |
| `GET <target>` | Opening a `.url` link file | Follows the link, same origin only, max. 5 hops |
| `HEAD <file>` | After an upload | Checks that the file really changed (ETag / Last-Modified / size) |
| `GET <VIEWER_3D_FOLDER>/ifc-lite-3d.js`, `…/ifc-lite_bg.wasm` | First use of the 3D view only | 3D library from **your** SharePoint; checked against fixed SHA-256 hashes before use |

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
| View choices (layout, split size, theme, colours, wrap, table on/off, 3D on/off, properties lines, CSV format) and window positions | `localStorage` of the SharePoint origin, keys `tp-preview-*` | Until the user clears site data |
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
| CSV / TSV (delimiter detected) | ✓ (per column) | | ✓ (sort, filter, edit cells, rows, columns) | | ✓ |
| Parquet (Snappy, GZIP, ZSTD, LZ4_RAW, uncompressed) | ✓ | | ✓ (read only) | | |
| IFC / IFCZIP | ✓ | ✓ | | ✓ (up to 8 MB, setting) | IFC only |
| Any other text file | – | | | | ✓ |

Binary files (PDF, Office, images, archives, …)
are detected from their first bytes and not shown.

---

## 7. Caching logic ##

- **Opening a file** fetches the first chunk (default 512 KB).
  "Cache next" fetches the next chunk,
  and "Cache all" fetches the rest.
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
- **Save** keeps the edits in the browser (staged).
  **Upload** is a separate step.
- **Upload uses no API.**
  The script hands the file to SharePoint the way a user would:
  1. a simulated drop onto the file list, or
  2. SharePoint's own file-upload input.

  SharePoint then performs the upload as the signed-in user,
  including its usual "replace?" prompt.
  A `HEAD` request then confirms the change.
- **If SharePoint does not accept it,**
  the user is offered a local save of the edited file to upload by hand.
- **Unsaved or not-yet-uploaded changes** trigger warnings:
  when switching files,
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
| `colours-text` / `colours-table` | `true` / `false` | Syntax colours per view |
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

**What reduces risk**

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
  except through a user-initiated upload to the same SharePoint.
- **HTML escaping:**
  file contents are always escaped before they are put into the page.

**What to be aware of**

- **Userscripts run with access to the page.**
  Any userscript manager can, in principle, read what the user sees.
  Trust therefore depends on reviewing this file and controlling its distribution
  (pin the version, disable auto-update from untrusted URLs).
- **3D view:**
  - It runs the ifc-lite bundle with `new Function(...)` and compiles WebAssembly.
  - SharePoint's Content Security Policy (CSP) could block this in future.
    The script then shows "3D view failed"
    and everything else keeps working.
  - It needs WebGPU (current Chrome / Edge).
- **Checks run in a Web Worker**
  created from a `blob:` URL, built from the script's own code.
  If workers are blocked, checks run on the page instead.
- **Upload simulation depends on SharePoint's UI** (drop target / file input).
  Changes by Microsoft may break it;
  the script then offers a local save instead.
- **DOM dependence:**
  the eye column relies on SharePoint's ARIA roles
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
     into a SharePoint library readable by the users.
   - Set `viewer-3d-folder`.
   - The script contains the expected SHA-256 hashes;
     files that don't match are refused.
   - Source of the bundle:
     `@ifc-lite/geometry` 7.8.1,
     `@ifc-lite/renderer` 6.4.0,
     `@ifc-lite/wasm` 10.4.0,
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
  SharePoint Online (modern library view); Chrome and Edge.
  The 3D view needs WebGPU.
- **Not supported:**
  - binary Office formats
  - Parquet nested types beyond simple lists
  - ZIP archives other than IFCZIP
- **Dates:**
  the modified date comes from the HTTP response of the file.
  SharePoint may report the time the file was served
  rather than when it was last changed.
- **Testing:**
  - Decoders (Parquet, Snappy, LZ4, ZSTD), linters and highlighters
    are covered by automated tests outside the browser.
  - The UI was tested in Chromium against a mock of SharePoint's markup
    and by hand in SharePoint Online.
  - Upload and 3D rendering were tested by hand only.

---

## 13. Licences ##

- **The script:**
  written for this purpose and contains no third-party code;
  licence: MPL-2.0, see `LICENCE` in the repository
  (also named in the script's header: `@copyright`, `@license`).
- **Optional 3D bundle:**
  ifc-lite, **MPL-2.0** (<https://github.com/LTplus-AG/ifc-lite>).
  Using it unchanged, as here, is permitted;
  modified ifc-lite source files would have to stay under MPL-2.0.
