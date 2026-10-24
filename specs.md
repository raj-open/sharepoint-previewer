# Specs #

## Scope ##

- Each build produces one flat release folder `/dist/v<VERSION>`
  with the Tampermonkey userscript (`sharepoint-previewer.js`, minified: `sharepoint-previewer.min.js`),
  the optional 3D files and `NOTES.md`.
- 3D files:
  ifc-lite bundled from `/src/viewer-3d/main.js`,
  the `.wasm` copied unchanged from `@ifc-lite/wasm` (not rebuilt from its Rust source).
- Keep the script a single, dependency-free JavaScript file at runtime.
- Development tooling (lint, format, tests) must not end up in the artefact.

## Conventions ##

- Source: `/src/main.js`.
- Minified userscript: `/src/main.min.js`, written by the build (from the release's userscript) and committed;
  identifier names are kept (the check worker is built from the script's own function sources).
- Version: `/dist/VERSION` is the single source;
  the build writes it into the userscript's `@version`.
- 3D hashes: the build writes the SHA-256 of the built 3D files into the userscript;
  the values in `/src/main.js` are only those of the last deployed bundle.
- Tests: `node --test`, files named `tests_*.mjs` under `/tests/{unit,behave,integration}`.
- Lint and format: Biome (cf. `/biome.json`).

## Quality ##

- `just qa` = lint checks + all tests (unit, behave, integration).
- `just qa` must pass before merging to staging, before versioning up and before merging to main.
- Behavioural tests: `/tests/behave`, Playwright (Chromium) on a fake SharePoint (`/tests/behave/fake-sharepoint`);
  browser installed by `just build-deps`.
