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
- Userscript: `/src/main.js` (bundle, esbuild) and `/src/main.min.js` (minified), both written by `just build-src`
  and committed; never edited by hand.
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
  off `main` as `<VERSION>-beta.<short commit>` (release files only, not `/src/main.js`).
- 3D hashes: the build writes the SHA-256 of the built 3D files into the userscript;
  the values in `/src/main.js` are only those of the last deployed bundle.
- Tests: `node --test`, files named `tests_*.mjs` under `/tests/{unit,behave,integration}`.
  Unit tests: one file per module, same path under `/tests/unit`;
  browser and Tampermonkey stubbed by `/tests/unit/helpers.mjs`.
- Lint and format: Biome (cf. `/biome.json`).

## Quality ##

- `just qa` = lint checks + all tests (unit, behave, integration).
- `just qa` must pass before merging to staging, before versioning up and before merging to main.
- Behavioural tests: `/tests/behave`, Playwright (Chromium) on a fake SharePoint (`/tests/behave/fake-sharepoint`);
  browser installed by `just build-deps`.
