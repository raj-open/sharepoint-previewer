// Anonymous bundle: the userscript without what is marked "anon" (cf. `just build-anon`, which makes the release from it):
// - regions `// #region anon` … `// #endregion anon` left out, marker lines included (other regions may nest inside),
// - the value of ABOUT_LINKS emptied (`{}`: the tab "About" shows no links).
// Usage: node scripts/anon.ts [<bundle> [<out>]]   (default: /dist/userscript.js -> /dist/userscript-anon.js)
// NOTE: anything that is to be left out of the anonymous build is simply marked the same way (cf. /TECHNICAL.md);
// the ordinary release keeps it, without the marker lines (`just _release`).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ----------------------------------------------------------------
// LOCAL CONSTANTS
// ----------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'dist/userscript.js');
const OUT = path.join(ROOT, 'dist/userscript-anon.js');
const ANON_RE = /^[ \t]*\/\/[ \t]*#region[ \t]+anon(?:[ \t].*)?$/;
const REGION_RE = /^[ \t]*\/\/[ \t]*#region\b/;
const END_RE = /^[ \t]*\/\/[ \t]*#endregion\b/;
// declaration of ABOUT_LINKS, up to the `;` that ends it (one line or several); not when commented out
const LINKS_RE = /^([ \t]*(?:export[ \t]+)?const[ \t]+ABOUT_LINKS\b[^=\n]*=)[\s\S]*?;[ \t]*$/m;

// ----------------------------------------------------------------
// METHODS
// ----------------------------------------------------------------

/** @returns text without the regions marked "anon" and with ABOUT_LINKS emptied */
export function anonymise(text: string): string {
    const out: string[] = [];
    let depth = 0; // regions open inside a region "anon" (0: outside of one)
    for (const line of text.split('\n')) {
        if (depth) {
            if (REGION_RE.test(line)) depth++;
            else if (END_RE.test(line)) depth--;
            continue;
        }
        if (ANON_RE.test(line)) {
            depth = 1;
            continue;
        }
        out.push(line);
    }
    if (depth) throw new Error('region "anon" not closed (// #endregion anon)');
    return out.join('\n').replace(LINKS_RE, '$1 {};');
}

/** Writes the anonymous bundle, checked by Node (broken: refused with Node's message) */
export function writeAnon(bundle: string, out: string): void {
    fs.writeFileSync(out, anonymise(fs.readFileSync(bundle, 'utf8')));
    try {
        execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });
    } catch (e) {
        const message = String((e as { stderr?: Buffer }).stderr ?? e).trim();
        throw new Error(`${out}: not valid JavaScript\n${message}`);
    }
}

// ----------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [bundle = BUNDLE, out = OUT] = process.argv.slice(2);
    writeAnon(bundle, out);
    console.log(
        `anonymous bundle ${path.relative(ROOT, path.resolve(out))} (regions "anon" left out, ABOUT_LINKS empty)`,
    );
}
