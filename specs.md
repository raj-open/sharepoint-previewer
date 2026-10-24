# Specs #

## Scope ##

- The project produces one main artefact:
  a Tampermonkey userscript (`/dist/sharepoint-previewer.user.js`).
- Optional 3D files (`/dist/viewer-3d`):
  ifc-lite bundled from `/src/viewer-3d/main.js`,
  the `.wasm` copied unchanged from `@ifc-lite/wasm` (not rebuilt from its Rust source).
- Keep the script a single, dependency-free JavaScript file at runtime.
- Development tooling (lint, format, tests) must not end up in the artefact.

## Conventions ##

- Source: `/src/main.js`.
- Version: `/dist/VERSION` is the single source;
  the build writes it into the userscript's `@version`.
- 3D hashes: the build writes the SHA-256 of the built 3D files into the userscript;
  the values in `/src/main.js` are only those of the last deployed bundle.
- Tests: `node --test`, files named `tests_*.mjs` under `/tests/{unit,behave,integration}`.
- Lint and format: Biome (cf. `/biome.json`).
