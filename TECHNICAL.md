# Basic technical notes #

This document contains information for developers.

## Repository structure ##

| Path | Contents |
| :--- | :------- |
| `/src/main.ts` | entry: imports the modules, then starts up |
| `/src/_core` | Tampermonkey header (`header.ts`), settings, preferences, list view, shared types (`types.ts`) |
| `/src/{readers,text,ui,view,viewer}` | the other modules (TypeScript) |
| `/src/@apis/ifc-lite/main.ts` | entry of the ifc-lite bundle for the optional 3D view |
| `/scripts` | build and demo scripts (`bundle.ts`, `demos.ts`) |
| `/demos` | demos with screenshots (`/demos/img`, written by `just demos`) |
| `/.github/workflows` | qa (automatic, manual) and release (cf. [Workflows](#workflows)) |
| `/tests/{unit,behave,integration}` | tests (`tests_*.ts`, run with `node --test`); unit tests mirror `/src` |
| `/templates` | templates for local files (e.g. `.env`) |
| `/dist/VERSION` | version (single source) |
| `/dist/userscript{,.min}.js` | the userscript, bundled from the modules, and minified (written by `just build-src`; local only; version and 3D hashes as dummies) |
| `/models` | (reserved) schemata |
| `specs.md` | public specs and conventions |

## System requirements ##

- The [Justfile](https://just.systems) tool.
- Node.js (≥ 22.18: runs TypeScript itself) for package dependencies, build and tests.
- Bash (Windows users should install e.g. [Git Bash](https://gitforwindows.org)).

## Taskrunner recipes ##

```bash
just setup              # local files (.env, ...) from /templates
just build              # dependencies (per lock) + all artefacts in /dist
just build-src          # /dist/userscript{,.min}.js from the modules (local only)
just build-dist         # artefacts only (dependencies already installed)
just prettify           # format + lint with fixes (Biome)
just lint-check         # same, dry run
just tests              # all tests (tests-unit, tests-behave, tests-integration)
just tests-explore      # mock Sharepoint with the userscript on localhost (HTTP_PORT in .env)
just demos [case ...]   # screenshots for /demos (/demos/img)
just type-check         # type check (strict): modules, tests, scripts
just qa                 # lint checks + type check + all tests
just tag                # release tag of /dist/VERSION (e.g. v1.1.0-alpha.1 for 1.1.0a1)
just clean              # node_modules + built artefacts (incl. /dist/userscript{,.min}.js)
```

## Artefacts ##

Each build writes one flat release folder `/dist/v<VERSION>`:

| File | Contents |
| :--- | :------- |
| `sharepoint-previewer.js` | userscript to install |
| `sharepoint-previewer.min.js` | the same, minified (whitespace and syntax; names kept) |
| `ifc-lite-3d.js` | ifc-lite bundle (esbuild, versions pinned in `package.json`) |
| `ifc-lite_bg.wasm` | engine binary, copied unchanged from `@ifc-lite/wasm` |
| `NOTES.md` | technical description for IT |

The build writes into the userscript:

- `@version` from `/dist/VERSION`
- the SHA-256 hashes of the two 3D files
  (`/dist/userscript{,.min}.js` have dummies: `0.0.0`, `<sha256>`)

So the userscript and the 3D files of one build are deployed together.

## Dependencies ##

Development only (nothing is loaded at runtime):

- `@biomejs/biome` - lint + format (cf. `/biome.json`)
- `typescript`, `@types/node` - type check (cf. `/tsconfig.json`); the build removes types with Node itself
- `esbuild` - bundles the 3D view
- `@ifc-lite/geometry`, `@ifc-lite/renderer`, `@ifc-lite/wasm` - 3D view (MPL-2.0)

`just build` installs per `package-lock.json`;
the lock is only rewritten when `package.json` has changed.

## Workflows ##

| Workflow | Runs | Does |
| :------- | :--- | :--- |
| `qa-auto` | each push and pull request | `just qa` |
| `qa-manual` | on demand (any branch, tag or commit) | `just qa` |
| `release` | on a release tag (`just tag`) | `just qa`, then `just build-dist`; attaches the files of `/dist/v<VERSION>` to the GitHub release (pre-release for alpha, beta, rc) |
