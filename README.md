# SharePoint Previewer #

[![qa (main)](../../actions/workflows/qa-auto.yaml/badge.svg?branch=main)](../../actions/workflows/qa-auto.yaml?query=branch%3Amain)
[![qa (staging)](../../actions/workflows/qa-auto.yaml/badge.svg?branch=staging)](../../actions/workflows/qa-auto.yaml?query=branch%3Astaging)
[![release](../../actions/workflows/release.yaml/badge.svg)](../../actions/workflows/release.yaml)

[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-userscript-00485B?logo=tampermonkey&logoColor=white)](https://www.tampermonkey.net)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)
[![SharePoint Online](https://img.shields.io/badge/SharePoint-Online-0078D4?logo=microsoftsharepoint&logoColor=white)](https://www.microsoft.com/microsoft-365/sharepoint)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![just](https://img.shields.io/badge/task%20runner-just-C9A227)](https://just.systems)
[![Biome](https://img.shields.io/badge/lint%20%2B%20format-Biome-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev)
[![TypeScript](https://img.shields.io/badge/type%20check-TypeScript%20(JSDoc)-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
[![node:test](https://img.shields.io/badge/tests-node%3Atest-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/api/test.html)
[![Playwright](https://img.shields.io/badge/behave-Playwright-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)
[![licence](https://img.shields.io/badge/licence-MPL--2.0-orange)](LICENCE)
[![runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-none-brightgreen)](NOTES.md)

Tampermonkey userscript:
preview (text, table, 3D, spreadsheets) and editor for files in SharePoint Online document libraries.

## Why ##

**Look into any file in SharePoint, right where it is.**

SharePoint previews Office documents and PDFs.
Most other files only offer a download:
CSV and Parquet data, logs, JSON, XML and YAML configs, Markdown notes, IFC building models.
So people download, open a local tool, look for ten seconds
and leave a copy behind in their Downloads folder.

This userscript adds an eye to every file in a document library.
One click shows the file next to the list:

- text with syntax colours and checks (JSON, XML, YAML, IFC, ...)
- CSV, Parquet, Excel and OpenDocument as sortable, filterable tables
- Markdown rendered, logs as tables (experimental)
- IFC models in 3D (optional)
- a small editor for plain-text files, saved back through SharePoint's own upload

Large files load in chunks (byte ranges): the first lines show before the whole file has arrived.
Nothing leaves the browser:
no third parties, no CDN, no Graph API, no tokens,
only the signed-in user's own SharePoint session.
So it fits where installing software is not an option.

**Who can use it:**
anyone with a browser, Tampermonkey and files in SharePoint Online,
e.g. engineers checking models and exports,
data and BI people looking into tables,
developers and admins reading logs and configs,
and IT teams who want all this without another app to roll out.

## Demos ##

- [Overview](demos/overview.md): list view, text, syntax checks, Markdown
- [Tables and spreadsheets](demos/tables.md): CSV, Excel tables and sheets, logs
- [3D](demos/3d.md): IFC models

Technical description for IT (behaviour, network, storage, security, deployment):
see [NOTES.md](NOTES.md).

## Structure ##

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

## Requirements ##

- [just](https://just.systems)
- Node.js (≥ 22)
- bash (on Windows e.g. Git Bash)

## Tasks ##

```bash
just setup              # local files (.env, ...) from /templates
just build              # dependencies (per lock) + all artefacts in /dist
just build-src          # /src/main.js + /src/main.min.js from the modules
just build-dist         # artefacts only (dependencies already installed)
just prettify           # format + lint with fixes (Biome)
just lint-check         # same, dry run
just tests              # all tests (tests-unit, tests-behave, tests-integration)
just tests-explore      # mock SharePoint with the userscript on localhost (HTTP_PORT in .env)
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

All three share `/.github/workflows/_qa.yaml`.

## Licence ##

[MPL-2.0](./LICENCE) (Mozilla Public License 2.0):
use, change and pass on freely, also commercially;
the copyright and licence notices stay,
and changed files of this project stay under MPL-2.0 (their source available to whoever receives them).
