# Sharepoint Previewer #

[![qa (main)](../../actions/workflows/qa-auto.yaml/badge.svg?branch=main)](../../actions/workflows/qa-auto.yaml?query=branch%3Amain)
[![qa (staging)](../../actions/workflows/qa-auto.yaml/badge.svg?branch=staging)](../../actions/workflows/qa-auto.yaml?query=branch%3Astaging)
[![release](../../actions/workflows/release.yaml/badge.svg)](../../actions/workflows/release.yaml)

[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-userscript-00485B?logo=tampermonkey&logoColor=white)](https://www.tampermonkey.net)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Sharepoint Online](https://img.shields.io/badge/Sharepoint-Online-0078D4?logo=microsoftsharepoint&logoColor=white)](https://www.microsoft.com/microsoft-365/sharepoint)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![just](https://img.shields.io/badge/task%20runner-just-C9A227)](https://just.systems)
[![Biome](https://img.shields.io/badge/lint%20%2B%20format-Biome-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev)
[![TypeScript](https://img.shields.io/badge/type%20check-TypeScript%20(JSDoc)-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
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

- [Overview](demos/overview.md): list view, text, syntax checks, Markdown
- [Tables and spreadsheets](demos/tables.md): CSV, Excel tables and sheets, logs
- [3D](demos/3d.md): IFC models

Technical description for IT (behaviour, network, storage, security, deployment):
see [NOTES.md](NOTES.md).

## Motivation ##

### What? ###

This repository produces a [Tampermonkey](https://www.tampermonkey.net) userscript
to preview (text, table, 3D, spreadsheets) and edit files in Sharepoint libraries.

### Why? ###

After further consideration we built further features into this application.
Our tool allows users to

- preview any text file, with syntax colours and checks (JSON, XML, YAML, IFC, ...)
- view CSV, Parquet, Excel and OpenDocument files as sortable, filterable tables
- read Markdown rendered and logs as tables (experimental)
- view IFC models in 3D (optional)
- edit plaintext files and save them back through Sharepoint's own upload

> [!NOTE]
> Our tool involves no API calls or 3rd party usage (beyond an optional IFC-lite viewer).

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
> Ensure you that **user scripts** are enabled on your Tampermonkey extension (see the instructions on <https://www.tampermonkey.net>).

### Setup from releases ###

1. Go to the [releases](./releases) page.

2. Download the release artefacts.

3. Copy the minified `sharepoint-previewer.min.js` into your Tampermonkey extension.

4. (Optional – for IFC-viewer usage) Place the viewer script/artefacts (`ifc-lite-3d.js`, `ifc-lite_bg.wasm`)
   in a designated Sharepoint library of your choice.

5. Ensure the application `Sharepoint Viewer` is activated in the Tampermonkey extension and refresh your browser.

6. Navigate to any sharepoint library:

    1. (only needed onced) click on the `Sharepoint Viewer` application within the Tampermonkey extension menu,
      select settings,
      accept the defaults or adjust as you see fit.
      In particular the (relative!) path to your ifc-lite artefacts should be set (if you wish to use the IFC-viewer),
      and an optional company or private logo can be entered as base64 encoding of an image.

    2. You should see an "eye" logo to the left of all files (but not folders). Click on these to preview any plaintext file
        (as well as a small selection of binaries like `*.xlsx` and `*.parquet` files).

> [!IMPORTANT]
> The ifc-lite artefacts must be within same domain, but can be placed in different libraries and subsharepoints.

### Setup for developers ###

1. Clone or fork this repository.

2. Ensure you have the [Justfile]() tool.

3. Run `just build` to locally build the artefacts in the [/dist](./dist) subfolder.

4. Follow Instructions 3–6 [above](#setup-from-releases).

## Notes ##

- See [TECHNICAL.md](./TECHNICAL.md) for basic technical notes about this repository.
- See [NOTES.md](./NOTES.md) for notes on application logic and design.

## Licence ##

[MPL-2.0](./LICENCE) (Mozilla Public License 2.0):
use, change and pass on freely, also commercially;
the copyright and licence notices stay,
and changed files of this project stay under MPL-2.0 (their source available to whoever receives them).
