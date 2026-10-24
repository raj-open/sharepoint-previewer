# Specs #

## Scope ##

- The project produces one artefact:
  a Tampermonkey userscript (`/dist/sharepoint-previewer.user.js`).
- Keep the script a single, dependency-free JavaScript file at runtime.
- Development tooling (lint, format, tests) must not end up in the artefact.

## Conventions ##

- Source: `/src/main.js`.
- Version: `/dist/VERSION` is the single source;
  the build writes it into the userscript's `@version`.
- Tests: `node --test`, files named `tests_*.mjs` under `/tests/{unit,behave,integration}`.
- Lint and format: Biome (cf. `/biome.json`).
