// Userscript (/src/main.js) as the build stamps it for the fake SharePoint: 3D hashes of this release (if built).

// ================================================================
// IMPORTS
// ================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATH_RELEASE } from './server.mjs';

// ================================================================
// CONSTANTS
// ================================================================

const ROOT = path.resolve(import.meta.dirname, '../..');
const PATH_SCRIPT = path.join(ROOT, 'src/main.js');
const FILES_3D = ['ifc-lite-3d.js', 'ifc-lite_bg.wasm'];

// ================================================================
// METHODS
// ================================================================

/** @param {string} file @returns {string} */
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** @returns {boolean} 3D files of this version are built (`just build`) */
export const has3dRelease = () => FILES_3D.every((name) => fs.existsSync(path.join(PATH_RELEASE, name)));

/** @returns {string} userscript, read afresh (picks up `just build-src`) */
export function userscript() {
    let text = fs.readFileSync(PATH_SCRIPT, 'utf8');
    if (has3dRelease()) {
        const hash = (name) => sha256(path.join(PATH_RELEASE, name));
        text = text
            .replace(/(VIEWER_3D_JS_SHA256\s*=\s*["'])[^"']*/, `$1${hash('ifc-lite-3d.js')}`)
            .replace(/(VIEWER_3D_WASM_SHA256\s*=\s*["'])[^"']*/, `$1${hash('ifc-lite_bg.wasm')}`);
    }
    return text;
}
