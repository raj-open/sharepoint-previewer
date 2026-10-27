# Installation and Usage #

## System requirements ##

- Supported by most browsers (e.g. Chrome, Edge).

- Requires the [Tampermonkey](https://www.tampermonkey.net) extension.

- Write access to any Sharepoint library in your domain.

> [!IMPORTANT]
> Ensure that **user scripts** are enabled for your Tampermonkey extension (see the instructions on <https://www.tampermonkey.net>).

## Setup from releases ##

1. Go to the [releases](../../releases) page.

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

## Setup for developers ##

1. Clone or fork this repository.

2. Ensure you have the [Justfile](https://just.systems) tool.

3. Run `just build` to locally build the artefacts in the [/dist](./dist) subfolder.

4. Follow steps 3–6 [above](#setup-from-releases).

[Back to the README](README.md)
