// Logo (setting `logo`) and version of the script, top right in the viewer and in the settings form;
// the version links to Tampermonkey's editor of the script

// ===========================================================================
// IMPORTS
// ===========================================================================

import { openEditor } from '../_core/script.ts';
import { scriptVersion } from '../_core/script.ts';
import { LOGO } from '../_core/settings.ts';
import { esc } from '../_core/util.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const EDIT_TITLE = 'Edit this script in Tampermonkey (e.g. to upgrade)';

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns HTML of the logo (base64 images only) and the version (link to the editor), each only if there is one */
export function brandHtml(): string {
    const logo = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(LOGO) ? LOGO.replace(/\s+/g, '') : '';
    const version = scriptVersion();
    const logoHtml = logo ? `<img src="${logo}" alt="" style="height:18px; width:auto; display:block">` : '';
    const versionHtml = version
        ? `<a href="#" data-edit title="${EDIT_TITLE}" style="color:inherit; text-decoration:none">v${esc(version)}</a>`
        : '';
    return logoHtml + versionHtml;
}

/** @returns tooltip: name and version */
export function brandTitle(): string {
    const version = scriptVersion();
    return version ? `Sharepoint Previewer v${version}` : 'Sharepoint Previewer';
}

/** Version link (of `brandHtml`) inside `root`: opens Tampermonkey's editor. */
export function bindBrand(root: ParentNode): void {
    const link = root.querySelector('[data-edit]');
    if (!link) return;
    link.onclick = (e) => {
        e.preventDefault();
        openEditor();
    };
}
