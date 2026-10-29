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
users should, _at the very least_, be able to preview plain-text files – whatever their file extension.

Our answer is a **previewer** that adds to Sharepoint just what is needed to fix this.

![The previewer on a mock Sharepoint: Parquet, Power BI, IFC in 3D with properties, logs, checks, editing, Zen mode with properties edited in place, clean links, dark mode](demos/img/hero.webp)

## Demonstration ##

See the [demos](demos/README.md) for screenshots and an explanation of each part (list view, layouts, Zen mode, title bar, text, tables, 3D, editing, caching, settings).

If you are reviewing the script (permissions, network, storage, security, deployment), see [NOTES.md](NOTES.md).

## Motivation ##

### What? ###

This repository builds a userscript that previews files in Sharepoint libraries – as text, tables, spreadsheets or 3D models – and lets you edit them.
It runs in the browser extension [Tampermonkey](https://www.tampermonkey.net) (see [Credits and licences](#credits-and-licences)).

### Why? ###

Once the previewer worked, we added further features. With it you can

- preview any text file, with syntax highlighting and checks (JSON, XML, YAML, IFC, …)

- view CSV, Parquet, Excel and OpenDocument files as tables you can sort and filter

- look inside Power BI files (their parts, Power Query scripts and parameters)

- read Markdown rendered, and logs as tables (experimental)

- view IFC models in 3D (optional)

- edit plain-text files or create new ones, and save them through Sharepoint's own upload (also under a different name)

- work in **Zen mode**, the previewer's own list of the folder, shown beside the viewer:

  - sorting and filters, with file names and column headers that stay in view while scrolling

  - a layout mode to show, hide and reorder columns (column widths can be changed at any time)

  - files and folders selected to download (several at once as a ZIP file) or delete (to the recycle bin, or permanently; always after confirmation)

  - files dragged in from your computer, uploaded by Sharepoint itself

  - an edit mode to change properties and names directly in the list

> [!NOTE]
> The tool contains no third-party code, apart from the optional 3D view, which is built on [IFClite](https://ifclite.dev).
> Only Zen mode and the lookup of search results use Sharepoint's own REST API (on the same site, with your session); the setting `sharepoint-api` turns off all use of the API.

### For whom? ###

It is designed for anyone who uses Sharepoint in a browser, for example

- engineers checking models and exports

- data and BI people looking into tables

- developers and admins reading logs and configuration files

- IT teams who want all this without rolling out another app

## Installation and usage ##

Quick start:

1. Install the browser extension [Tampermonkey](https://www.tampermonkey.net) (with user scripts allowed).

2. Add `sharepoint-previewer.min.js` from the [releases](../../releases) to Tampermonkey.

3. Open a Sharepoint library and click the eye next to a file.

For details (requirements, the optional 3D view, settings, setup for developers), see [INSTALL.md](INSTALL.md).
Controls that are hard to discover are listed in the script itself, under "About …" in the Tampermonkey menu or in the ⋯ menu.

## Notes ##

- [INSTALL.md](./INSTALL.md): installation and first steps.

- [NOTES.md](./NOTES.md): for reviewing the script (permissions, network, storage, security, deployment).

- [TECHNICAL.md](./TECHNICAL.md): for development (the repository, build and tests, and how the script works inside: formats, caching, editing, settings).

## Credits and licences ##

- **This script:** written for this project, apart from the XPress9 decoder below. Licence: [MPL-2.0](./LICENCE) (Mozilla Public License 2.0). You may use, change and pass it on freely, also commercially; the copyright and licence notices must stay, and changed files of this project remain under MPL-2.0 (with their source available to whoever receives them).

- **XPress9** by Microsoft Corporation, **MIT**: the decompression of Power BI data models ([/src/readers/codecs/xpress9.ts](./src/readers/codecs/xpress9.ts)) is ported from Microsoft's XPress9 sources (decoder only), as published with [xpress9-python](https://github.com/Hugoberry/xpress9-python). Its copyright and licence notice is kept at the top of that file.

- **[Tampermonkey](https://www.tampermonkey.net)** by Jan Biniok: the browser extension that runs the userscript. Each user installs it themselves; it is neither part of this repository nor distributed with it.

- **[IFClite](https://ifclite.dev)** by Louis Trümpler & contributors (LTplus AG), **MPL-2.0**: the engine of the optional 3D viewer.

  - The release bundles `@ifc-lite/geometry`, `@ifc-lite/renderer` and `@ifc-lite/parser` (with their dependencies) into `ifc-lite-3d.js` and ships the engine binary of `@ifc-lite/wasm` unchanged as `ifc-lite_bg.wasm`; the versions are pinned in [package.json](./package.json).

  - IFClite is used unchanged; its source code is available at <https://github.com/LTplus-AG/ifc-lite>. Modified IFClite source files would have to remain under MPL-2.0.

- **Development only** (not part of the userscript): [TypeScript](https://www.typescriptlang.org), [Biome](https://biomejs.dev), [esbuild](https://esbuild.github.io), [Playwright](https://playwright.dev) and [just](https://just.systems); the test file `Data/model.pbix` comes from the samples of [PBIXRay](https://github.com/Hugoberry/pbixray) (MIT).

Microsoft, Sharepoint, Tampermonkey and other names are trademarks of their respective owners; this project is not affiliated with or endorsed by them.
