# Specs #

## Scope ##

- Each build produces one flat release folder `/dist/v<VERSION>`
  with the Tampermonkey userscript (`sharepoint-previewer.js`, minified: `sharepoint-previewer.min.js`),
  the optional 3D files and `NOTES.md`.
- 3D files:
  ifc-lite bundled from `/src/@apis/ifc-lite/main.js`,
  the `.wasm` copied unchanged from `@ifc-lite/wasm` (not rebuilt from its Rust source).
- Keep the script a single, dependency-free JavaScript file at runtime.
- Size (rule of thumb): userscript source ≤ 500 KB, minified userscript ≤ 300 KB.
- Development tooling (lint, format, tests) must not end up in the artefact.

## Conventions ##

- Source: ES modules under `/src` (entry `/src/_core/main.js`, Tampermonkey header `/src/_core/header.js`);
  third-party code under `/src/@apis`.
- Userscript: `/dist/userscript.js` (bundle), written by `just build-src`
  and committed (to follow how the whole script changes between versions); never edited by hand.
  The minified userscript is written only into the release folder `/dist/v<VERSION>`.
  Identifier names are kept (the check worker is built from the script's own function sources).
- Modules: one concern each; a module only writes its own top-level variables
  (shared, changeable state lives in objects, e.g. `view` in `prefs.js`).
- Module layout: one-line description at the top,
  then sections `IMPORTS`, `CONSTANTS`, `METHODS` as `// ===` comment blocks,
  categories within as `// ---` comment blocks.
- Imports: one name per line, sorted by path.
- Indentation: 4 spaces (cf. `/biome.json`).
- Template literals: never nested (no backticks inside `${…}`); build inner parts in variables first
  (editors mismatch the brackets around nested backticks).
- Start-up: modules only define (no listeners, observers, menu or DOM changes on load);
  the entry `/src/_core/main.js` starts everything explicitly, in order, at the end of the bundle.
- Version: `/dist/VERSION` is the single source;
  the build writes it into the userscript's `@version`,
  except on the commit tagged `v<VERSION>` as `<VERSION>-beta.<short commit>` (release files only, not `/dist/userscript.js`).
- 3D hashes: the build writes the SHA-256 of the built 3D files into the userscript;
  the values in `/dist/userscript.js` are only those of the last deployed bundle.
- Tests: `node --test`, files named `tests_*.mjs` under `/tests/{unit,behave,integration}`.
  Unit tests: one file per module, same path under `/tests/unit`;
  browser and Tampermonkey stubbed by `/tests/unit/helpers.mjs`.
- Lint and format: Biome (cf. `/biome.json`).

## Quality ##

- `just qa` = lint checks + all tests (unit, behave, integration).
- `just qa` must pass before merging to staging, before versioning up and before merging to main.
- Behavioural tests: `/tests/behave`, Playwright (Chromium) on a mock SharePoint (`/tests/mocks/mock-sharepoint`);
  browser installed by `just build-deps`.
- Explorative tests: `just tests-explore [folder]` serves the mock SharePoint on `http://localhost:<HTTP_PORT>` (loopback only),
  the userscript injected per page load with a Tampermonkey stand-in (`/tests/explore`);
  the library shows folders `Mock Data` (`/tests/mocks/mock-sharepoint/library`) and `Data` (`/data`, local only),
  or only `folder` if given; files are read from disk per request (read only);
  the 3D files of the release (`just build`) appear in the library as folder `previewer`,
  empty settings `viewer-3d-folder` (pointing there) and `logo` (a test logo) are filled in on each page load;
  not part of `just qa`.
