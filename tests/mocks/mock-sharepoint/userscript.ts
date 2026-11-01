// Userscript (/dist/userscript.js) as the build stamps it for the mock Sharepoint: hashes of the optional files
// of this release (3D, diagrams; if built).

// ================================================================
// IMPORTS
// ================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { has3dRelease } from './server.ts';
import { hasDiagramsRelease } from './server.ts';
import { PATH_RELEASE } from './server.ts';

// ================================================================
// CONSTANTS
// ================================================================

const ROOT = path.resolve(import.meta.dirname, '../../..');
const PATH_SCRIPT = path.join(ROOT, 'dist/userscript.js');

// ================================================================
// METHODS
// ================================================================

const sha256 = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** @returns userscript, read afresh (picks up `just build-src`) */
export function userscript(): string {
    let text = fs.readFileSync(PATH_SCRIPT, 'utf8');
    const hash = (name: string) => sha256(path.join(PATH_RELEASE, name));
    if (hasDiagramsRelease()) text = text.replace(/(DIAGRAMS_JS_SHA256\s*=\s*["'])[^"']*/, `$1${hash('mermaid.js')}`);
    if (has3dRelease()) {
        text = text
            .replace(/(VIEWER_3D_JS_SHA256\s*=\s*["'])[^"']*/, `$1${hash('ifc-lite-3d.js')}`)
            .replace(/(VIEWER_3D_WASM_SHA256\s*=\s*["'])[^"']*/, `$1${hash('ifc-lite_bg.wasm')}`);
    }
    return text;
}
