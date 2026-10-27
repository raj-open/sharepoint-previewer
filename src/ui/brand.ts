// Logo (setting `logo`) and version of the script, top right in the viewer and in the settings form

// ===========================================================================
// IMPORTS
// ===========================================================================

import { LOGO } from '../_core/settings.ts';
import { esc } from '../_core/util.ts';

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns version of the running script ('' outside Tampermonkey) */
export function scriptVersion(): string {
    // NOTE: not `!== 'undefined'`: minified to `GM_info<"u"`, which editors read as type arguments (brackets then mismatch)
    return typeof GM_info === 'object' ? GM_info.script.version : '';
}

/** @returns HTML of the logo (base64 images only) and the version, each only if there is one */
export function brandHtml(): string {
    const logo = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(LOGO) ? LOGO.replace(/\s+/g, '') : '';
    const version = scriptVersion();
    const logoHtml = logo ? `<img src="${logo}" alt="" style="height:18px; width:auto; display:block">` : '';
    const versionHtml = version ? `<span>v${esc(version)}</span>` : '';
    return logoHtml + versionHtml;
}

/** @returns tooltip: name and version */
export function brandTitle(): string {
    const version = scriptVersion();
    return version ? `Sharepoint Previewer v${version}` : 'Sharepoint Previewer';
}
