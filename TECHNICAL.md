# Basic technical notes #

This document contains information for developers.

## Repository structure ##

| Path | Contents |
| :--- | :------- |
| `/src/_core` | entry (`main.js`), Tampermonkey header (`header.js`), settings, preferences, list view, shared types |
| `/src/{readers,text,ui,view,viewer}` | the other modules (ES modules) |
| `/src/main.js` | the userscript, bundled from the modules (written by `just build-src`) |
| `/src/main.min.js` | the same, minified (written by `just build-src`) |
| `/src/@apis/ifc-lite/main.js` | entry of the ifc-lite bundle for the optional 3D view |
| `/scripts` | build and demo scripts (`bundle.mjs`, `demos.mjs`) |
| `/demos` | demos with screenshots (`/demos/img`, written by `just demos`) |
| `/.github/workflows` | qa (automatic, manual) and release (cf. [Workflows](#workflows)) |
| `/tests/{unit,behave,integration}` | tests (`tests_*.mjs`, run with `node --test`); unit tests mirror `/src` |
| `/templates` | templates for local files (e.g. `.env`) |
| `/dist/VERSION` | version (single source) |
| `/models` | (reserved) schemata |
| `specs.md` | public specs and conventions |

## System requirements ##

- The [Justfile](https://just.systems) tool.
- Node.js (≥ 22) for package dependencies.
- Bash (Windows users should install e.g. [Git Bash](https://gitforwindows.org)).

## Taskrunner recipes ##

```bash
just setup              # local files (.env, ...) from /templates
just build              # dependencies (per lock) + all artefacts in /dist
just build-src          # /src/main.js + /src/main.min.js from the modules
just build-dist         # artefacts only (dependencies already installed)
just prettify           # format + lint with fixes (Biome)
just lint-check         # same, dry run
just tests              # all tests (tests-unit, tests-behave, tests-integration)
just tests-explore      # mock Sharepoint with the userscript on localhost (HTTP_PORT in .env)
just demos [case ...]   # screenshots for /demos (/demos/img)
just qa                 # lint checks + type check + all tests
just tag                # release tag of /dist/VERSION (e.g. v1.1.0-alpha.1 for 1.1.0a1)
just clean              # node_modules + built artefacts
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
  (the values in `/src/main.js` are those of the last deployed bundle)

So the userscript and the 3D files of one build are deployed together.

## Dependencies ##

Development only (nothing is loaded at runtime):

- `@biomejs/biome` - lint + format (cf. `/biome.json`)
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

All three share common definitions from [_common.yaml](.github/workflows/_common.yaml).
