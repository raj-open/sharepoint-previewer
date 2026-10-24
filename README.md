# SharePoint Previewer #

Tampermonkey userscript:
preview (text, table, 3D, spreadsheets) and editor for files in SharePoint Online document libraries.

Technical description for IT (behaviour, network, storage, security, deployment):
see [NOTES.md](NOTES.md).

## Structure ##

| Path | Contents |
| :--- | :------- |
| `/src/main.js` | the userscript |
| `/src/viewer-3d/main.js` | entry of the ifc-lite bundle for the optional 3D view |
| `/tests/{unit,behave,integration}` | tests (`tests_*.mjs`, run with `node --test`) |
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
just build-dist         # artefacts only (dependencies already installed)
just prettify           # format + lint with fixes (Biome)
just lint-check         # same, dry run
just tests              # all tests (tests-unit, tests-behave, tests-integration)
just clean              # node_modules + built artefacts
```

## Artefacts ##

Each build writes one flat release folder `/dist/v<VERSION>`:

| File | Contents |
| :--- | :------- |
| `sharepoint-previewer.js` | userscript to install |
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

## Licence ##

[MPL-2.0](./LICENCE) (Mozilla Public License 2.0):
use, change and pass on freely, also commercially;
the copyright and licence notices stay,
and changed files of this project stay under MPL-2.0 (their source available to whoever receives them).
