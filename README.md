# Sharepoint Previewer #

[![qa (main)](../../actions/workflows/qa-manual.yaml/badge.svg?branch=main)](../../actions/workflows/qa-manual.yaml?query=branch%3Amain)
[![qa (staging)](../../actions/workflows/qa-auto.yaml/badge.svg?branch=staging)](../../actions/workflows/qa-auto.yaml?query=branch%3Astaging)
[![release](../../actions/workflows/release.yaml/badge.svg)](../../actions/workflows/release.yaml)

[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-userscript-00485B?logo=tampermonkey&logoColor=white)](https://www.tampermonkey.net)
[![TypeScript](https://img.shields.io/badge/TypeScript-modules-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Sharepoint Online](https://img.shields.io/badge/Sharepoint-Online-0078D4?logo=microsoftsharepoint&logoColor=white)](https://www.microsoft.com/microsoft-365/sharepoint)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022.18-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![just](https://img.shields.io/badge/task%20runner-just-C9A227)](https://just.systems)
[![Biome](https://img.shields.io/badge/lint%20%2B%20format-Biome-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev)
[![type check](https://img.shields.io/badge/type%20check-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/tsconfig#strict)
[![node:test](https://img.shields.io/badge/tests-node%3Atest-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/api/test.html)
[![Playwright](https://img.shields.io/badge/behave-Playwright-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)
[![licence](https://img.shields.io/badge/licence-MPL--2.0-orange)](LICENCE)
[![runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-none-brightgreen)](NOTES.md)

It goes without saying: _Microsoft Sharepoint is frustrating_.
So we set out to solve one very simple problem:
users should _at bare minimum_ be able to preview plaintext files – regardless of their file extensions!

We built a **previewer** that simply augments the Sharepoint experience to overcome just this issue.

## Demonstration ##

See

- [List view and search](demos/list.md): eyes on files and folders, search results
- [Layouts and dark mode](demos/layouts.md): below or right of the list, pop-up, narrow viewer, dark mode
- [Title bar](demos/title-bar.md): properties, link, another name
- [Text, checks and Markdown](demos/text.md): syntax colours, syntax checks, rendered Markdown
- [Tables and spreadsheets](demos/tables.md): CSV (colours, editing), Excel tables and sheets, logs
- [Editing](demos/editing.md): edit, save, upload, cancel (with the logic)
- [Caching](demos/caching.md): partly and fully cached files (with the logic)
- [Settings](demos/settings.md): form and JSON
- [3D](demos/3d.md): IFC models

Technical descriptions (behaviour, network, storage, security, deployment):
see [NOTES.md](NOTES.md).

## Motivation ##

### What? ###

This repository produces a userscript
to preview (text, table, 3D, spreadsheets) and edit files in Sharepoint libraries.
It runs in the browser extension [Tampermonkey](https://www.tampermonkey.net)
(cf. [Credits and licences](#credits-and-licences)).

### Why? ###

After further consideration we built further features into this application.
Our tool allows users to

- preview any text file, with syntax colours and checks (JSON, XML, YAML, IFC, ...)
- view CSV, Parquet, Excel and OpenDocument files as sortable, filterable tables
- read Markdown rendered and logs as tables (experimental)
- view IFC models in 3D (optional)
- edit plaintext files, or create new ones, and save them back through Sharepoint's own upload (also under another name)

> [!NOTE]
> Our tool involves no API calls and no third-party code,
> except the optional 3D view built on [IFClite](https://ifclite.dev).

### For whom? ###

This application is design for people who use Sharepoint in a browser.
e.g. engineers checking models and exports,
data and BI people looking into tables,
developers and admins reading logs and configs,
and IT teams who want all this without another app to roll out.

## Usage ##

### System requirements ###

- Supported by most browsers (e.g. Chrome, Edge).

- Requires the [Tampermonkey](https://www.tampermonkey.net) extension.

- Write access to any Sharepoint library in your domain.

> [!IMPORTANT]
> Ensure that **user scripts** are enabled for your Tampermonkey extension (see the instructions on <https://www.tampermonkey.net>).

### Setup from releases ###

1. Go to the [releases](./releases) page.

2. Download the release artefacts.

3. Copy the minified `sharepoint-previewer.min.js` into your Tampermonkey extension.

4. (Optional – for the 3D view) Place the [IFClite](https://ifclite.dev) artefacts
   (`ifc-lite-3d.js`, `ifc-lite_bg.wasm`)
   in a designated Sharepoint library of your choice.

5. Ensure the userscript `Sharepoint Previewer` is activated in the Tampermonkey extension and refresh your browser.

6. Navigate to any sharepoint library:

    1. (only needed once) click on the `Sharepoint Previewer` userscript within the Tampermonkey extension menu,
      select settings,
      accept the defaults or adjust as you see fit.
      In particular the (relative!) path to your ifc-lite artefacts should be set (if you wish to use the IFC-viewer),
      and an optional company or private logo can be entered as base64 encoding of an image.

    2. You should see an "eye" logo to the left of all files and folders. Click on these to preview any plaintext file
        (as well as a small selection of binaries like `*.xlsx` and `*.parquet` files).

> [!IMPORTANT]
> The ifc-lite artefacts must be within same domain, but can be placed in different libraries and subsharepoints.

### Setup for developers ###

1. Clone or fork this repository.

2. Ensure you have the [Justfile](https://just.systems) tool.

3. Run `just build` to locally build the artefacts in the [/dist](./dist) subfolder.

4. Follow Instructions 3–6 [above](#setup-from-releases).

## Notes ##

- See [TECHNICAL.md](./TECHNICAL.md) for basic technical notes about this repository.
- See [NOTES.md](./NOTES.md) for notes on application logic and design.

## Credits and licences ##

- **This script:**
  written for this purpose, contains no third-party code;
  licence: [MPL-2.0](./LICENCE) (Mozilla Public License 2.0):
  use, change and pass on freely, also commercially;
  the copyright and licence notices stay,
  and changed files of this project stay under MPL-2.0 (their source available to whoever receives them).

- **[Tampermonkey](https://www.tampermonkey.net)** by Jan Biniok:
  the browser extension that runs the userscript.
  Each user installs it separately;
  it is neither part of nor distributed with this repository.

- **[IFClite](https://ifclite.dev)** by Louis Trümpler & contributors (LTplus AG), **MPL-2.0**:
  the engine of the optional 3D model-viewer.
  - The release bundles `@ifc-lite/geometry` and `@ifc-lite/renderer` (with their dependencies) into `ifc-lite-3d.js`
    and ships the engine binary of `@ifc-lite/wasm` unchanged as `ifc-lite_bg.wasm`;
    versions pinned in [package.json](./package.json).
  - Used unchanged; its source code is available at <https://github.com/LTplus-AG/ifc-lite>.
    Modified IFClite source files would have to stay under MPL-2.0.

- **Development only** (not part of the userscript):
  [TypeScript](https://www.typescriptlang.org),
  [Biome](https://biomejs.dev),
  [esbuild](https://esbuild.github.io),
  [Playwright](https://playwright.dev),
  [just](https://just.systems).

Microsoft, Sharepoint, Tampermonkey and other names are trademarks of their respective owners;
this project is not affiliated with or endorsed by them.
