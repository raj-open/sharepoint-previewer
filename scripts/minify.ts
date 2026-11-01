// Minified userscript (cf. `just _minify`): whitespace, syntax and local names shortened; top-level names kept
// (the bundle's body is minified outside its wrapper, where esbuild leaves them as they are: the lint worker is built
// from the script's own function sources and refers to them by name, cf. /src/text/lint/worker.ts);
// CSS marked `/* css */` before a template literal minified as CSS; the ==UserScript== header kept as is.
// Usage: node scripts/minify.ts <bundle> <out>

import fs from 'node:fs';
import { transformSync } from 'esbuild';

// ----------------------------------------------------------------
// LOCAL CONSTANTS
// ----------------------------------------------------------------

const HEADER_RE = /^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==$/m;
const WRAP_OPEN = '(() => {\n';
const WRAP_CLOSE = '})();';
const CSS_RE = /\/\* css \*\/ `((?:[^`\\$]|\\[\s\S]|\$(?!\{))*)`/g; // template literal without ${…}

// ----------------------------------------------------------------
// METHODS
// ----------------------------------------------------------------

/** @returns minified script: header, then the wrapper with the minified body */
export function minify(bundle: string): string {
    const header = HEADER_RE.exec(bundle)?.[0];
    if (!header) throw new Error('no ==UserScript== header');
    const start = bundle.indexOf(WRAP_OPEN);
    const end = bundle.lastIndexOf(WRAP_CLOSE);
    if (start < 0 || end < start) throw new Error('bundle not wrapped in (() => { … })();');
    const body = minifyCss(bundle.slice(start + WRAP_OPEN.length, end));
    const code = transformSync(body, {
        minify: true,
        charset: 'utf8',
        legalComments: 'none',
        lineLimit: 1000,
        logLevel: 'warning',
    }).code;
    return `${header}\n// @ts-nocheck: built file\n(()=>{${code}})();\n`;
}

/** @returns text with the CSS of template literals marked `/* css *\/` minified (as the same literal) */
export function minifyCss(text: string): string {
    return text.replace(CSS_RE, (_, raw: string) => {
        const css = new Function(`return \`${raw}\`;`)() as string; // the literal's value (escapes applied)
        const min = transformSync(css, { loader: 'css', minify: true, logLevel: 'warning' }).code.trim();
        return `\`${min.replace(/[\\`]/g, '\\$&').replace(/\$\{/g, '\\${')}\``;
    });
}

// ----------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------

if (import.meta.main) {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('usage: node scripts/minify.ts <bundle> <out>');
    fs.writeFileSync(output, minify(fs.readFileSync(input, 'utf8')));
}
