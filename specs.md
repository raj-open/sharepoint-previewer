# Specs #

## Scope ##

- Each build produces one flat release folder `/dist/v<BUILD_VERSION>`,
  named exactly after the `@version` of its userscript (cf. Version below)
  with the Tampermonkey userscript (`sharepoint-previewer.js`, minified: `sharepoint-previewer.min.js`),
  the optional 3D files (unless `BUILD_3D=false`) and `NOTES.md`.
- 3D files:
  ifc-lite bundled from `/src/@apis/ifc-lite/main.ts`,
  the `.wasm` copied unchanged from `@ifc-lite/wasm` (not rebuilt from its Rust source).
- Keep the script a single, dependency-free JavaScript file at runtime.
- Size (rule of thumb): userscript source ≤ 750 KB, minified userscript ≤ 400 KB.
- Development tooling (lint, format, tests) must not end up in the artefact.

## Conventions ##

- Source: TypeScript modules under `/src` (entry `/src/main.ts`, Tampermonkey header `/src/_core/header.ts`);
  third-party code under `/src/@apis`.
- TypeScript: erasable syntax only (no enums, namespaces, parameter properties; cf. `/tsconfig.json`);
  imports with `.ts`, types with `import type`.
  The bundle removes the types per module (Node's `stripTypeScriptTypes`):
  the userscript stays plain JavaScript, laid out as the modules.
- Tests and scripts: TypeScript as well, run by Node itself (≥ 22.18);
  `/tests/explore/tampermonkey.js` stays JavaScript (runs in the browser).
- Userscript: `/dist/userscript.js` (bundle) and `/dist/userscript.min.js` (minified),
  written by `just build-src`; local only (not synchronised), never edited by hand.
  Their `@version` and 3D hashes are dummies (`0.0.0`, `<sha256>`);
  only the release files in `/dist/v<BUILD_VERSION>` carry real values.
  Identifier names are kept (the check worker is built from the script's own function sources).
- Modules: one concern each; a module only writes its own top-level variables
  (shared, changeable state lives in objects, e.g. `view` in `prefs.ts`).
- Module layout: one-line description at the top,
  then sections `IMPORTS`, `TYPES`, `CONSTANTS`, `METHODS` as `// ===` comment blocks (only those needed;
  types shared by modules in `/src/_core/types.ts`),
  categories within as `// ---` comment blocks.
- Imports: one name per line, sorted by path; type imports (`import type`) after the others.
- Indentation: 4 spaces (cf. `/biome.json`).
- Template literals: never nested (no backticks inside `${…}`); build inner parts in variables first
  (editors mismatch the brackets around nested backticks).
- Start-up: modules only define (no listeners, observers, menu or DOM changes on load);
  the entry `/src/main.ts` starts everything explicitly, in order, at the end of the bundle.
- Version: `/dist/VERSION` is the single source;
  `just build-lock` writes it into `/package.json` and `/package-lock.json` (semver form, cf. `just tag`);
  the build writes it into the userscript's `@version` on the commit tagged `v<VERSION>`,
  on any other commit as `<VERSION>-beta.<short commit>` (release files only; `BUILD_VERSION` in `/justfile`).
- 3D hashes: the release build writes the SHA-256 of the built 3D files into the userscript;
  without them (dummies) the 3D view refuses to load.
- Tests: `node --test`, files named `tests_*.ts` under `/tests/{unit,behave,integration}`.
  Unit tests: one file per module, same path under `/tests/unit`;
  browser and Tampermonkey stubbed by `/tests/unit/helpers.ts`.
- Lint and format: Biome (cf. `/biome.json`).
- Type check: strict, `just type-check`
  (`/tsconfig.json` for `/src`, `/tests/tsconfig.json`, `/scripts/tsconfig.json` with Node types).

## Quality ##

- `just qa` = lint checks + all tests (unit, behave, integration).
- `just qa` must pass before merging to staging, before versioning up and before merging to main.
- Behavioural tests: `/tests/behave`, Playwright (Chromium) on a mock Sharepoint (`/tests/mocks/mock-sharepoint`);
  browser: Playwright's Chromium (downloaded by `just build-deps`),
  or one installed already, named in `BROWSER_CHANNEL` (e.g. `chrome`; the workflows use the runner image's Google Chrome: nothing downloaded).
- Explorative tests: `just tests-explore [folder]` serves the mock Sharepoint on `http://localhost:<HTTP_PORT>` (loopback only),
  the userscript injected per page load with a Tampermonkey stand-in (`/tests/explore`);
  the site (`Mock Sharepoint`, at `/sites/MockSharepoint`) has three libraries (URLs without spaces, e.g. `/sites/MockSharepoint/MockLibrary`):
  `Mock Library` (test fixtures, `/tests/mocks/mock-sharepoint/library`),
  `Mock Tools Library` (the 3D files, see below, plus a readme, a text file and an example model: `/tests/mocks/mock-sharepoint/tools`)
  and `Local Library` (own files: `/data`, local only, or `folder` if given);
  behavioural tests and demos use the two mock libraries alone;
  files are read from disk per request (read only);
  search (box in the middle of the suite bar, as in Sharepoint) lists files and folders below the folder open;
  file rows carry no path (as in Sharepoint), so the userscript looks them up by name
  (the site's list and search REST APIs are mocked as well);
  uploads are simulated: kept apart in `/tests/mocks/mock-sharepoint/__uploads__/<session>` (site paths mirrored),
  listed and served over the originals, removed when the server stops (behavioural tests: when their browser closes)
  and by `just clean`; never synchronised;
  the 3D files of the release (`just build`) appear in `Mock Tools Library` as folder `Viewer`,
  empty settings `viewer-3d-folder` (pointing there, from the top: `/sites/MockSharepoint/MockToolsLibrary/Viewer`) and `logo` (a test logo) are filled in on each page load;
  not part of `just qa`.
