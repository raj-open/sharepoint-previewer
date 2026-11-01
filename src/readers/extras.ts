// Optional files of a release (3D engine, diagrams) from the folder of the setting "viewer-3d-folder":
// same Sharepoint only, revalidated, checked against the SHA-256 stamped into the release userscript

// ===========================================================================
// IMPORTS
// ===========================================================================

import { VIEWER_3D_FOLDER } from '../_core/settings.ts';
import { encodePath } from './request.ts';
import { sameOrigin } from './request.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const NOT_FOUND = 'optional-file-not-found'; // cause of the error when the folder has no such file
const SHA256_RE = /^[0-9a-f]{64}$/;

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns the file's checksum is stamped in (a release userscript) and the folder is set */
export const hasExtra = (hash: string): boolean => !!VIEWER_3D_FOLDER && SHA256_RE.test(hash);

// Bytes of an optional file; throws (readable message) if not set up, not found or not matching its checksum
export async function fetchExtra(name: string, hash: string, onStatus: (s: string) => void): Promise<ArrayBuffer> {
    if (!VIEWER_3D_FOLDER) throw new Error('the viewer files folder is not set (settings: "Viewer files folder")');
    if (!SHA256_RE.test(hash)) throw new Error('no checksums of viewer files in this build: use a release userscript');
    const site = (location.pathname.match(/^\/(?:sites|teams|personal)\/[^/]+/i) || [''])[0]; // current site
    const folder = VIEWER_3D_FOLDER.startsWith('/') ? VIEWER_3D_FOLDER : `${site}/${VIEWER_3D_FOLDER}`;
    const url = encodePath(`${folder.replace(/\/$/, '')}/${name}`);
    if (!sameOrigin(url)) throw new Error('the viewer files folder must be in this Sharepoint');
    onStatus(`caching ${name} …`);
    // revalidated: a cached file of an earlier release would fail its checksum
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
    if (res.status === 404) {
        const message = `${name} not found in "${folder}": is the setting "Viewer files folder" right?`;
        throw new Error(message, { cause: NOT_FOUND });
    }
    if (!res.ok) throw new Error(`${name}: error ${res.status}`);
    const buf = await res.arrayBuffer();
    if ((await sha256(buf)) !== hash) throw new Error(`${name} does not match its checksum: not used`);
    return buf;
}

// Script of an optional file run here; returns the global it sets (read back in the same function:
// the userscript's sandbox may have another global object)
export function runExtra<T>(js: ArrayBuffer, global: string): T | undefined {
    return new Function(`${new TextDecoder().decode(js)}\n;return globalThis[${JSON.stringify(global)}];`)();
}

// Script of an optional file run as a classic <script> would run it (its top-level `var`s global: e.g. bundles
// that read themselves back through globalThis): indirect eval, at top level; a leading "use strict" left out
// (strict eval would keep the `var`s to itself); returns the global it sets
export function runScript<T>(js: ArrayBuffer, global: string): T | undefined {
    const code = new TextDecoder().decode(js).replace(/^\s*(["'])use strict\1;?/, '');
    // biome-ignore lint/security/noGlobalEval: the file's checksum was checked (cf. fetchExtra)
    return globalThis.eval(`${code}\n;globalThis[${JSON.stringify(global)}];`); // indirect: at top level
}

async function sha256(buf: ArrayBuffer): Promise<string> {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
