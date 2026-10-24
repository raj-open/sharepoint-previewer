// Bundles the userscript's ES modules into one readable classic script (no dependencies):
// modules in load order (imports first, depth first, as ES modules run), entry (start-up) last, each one's text as written,
// without its import lines and `export` keywords, inside one IIFE in strict mode.
// Usage: node scripts/bundle.mjs <entry> <header> <types> <out>
// NOTE: needs unique top-level names across modules and plain named imports (checked here).

import fs from 'node:fs';
import path from 'node:path';

// ----------------------------------------------------------------
// LOCAL CONSTANTS
// ----------------------------------------------------------------

const IMPORT_RE = /^import\s*(?:\{([^}]*)\}\s*from\s*)?'([^']+)';[ \t]*\n/gm;
const EXPORT_RE = /^export (?=(?:async function|function|const|let|class)\b)/gm;
const TYPE_IMPORT_RE = /^\/\*\* @typedef \{import\('[^']*types\.js'\)\.\w+\} \w+ \*\/\n/gm;
const DECL_RE = /^(?:export )?(?:async function|function|const|let|class)\s+(\{[^}]*\}|\w+)/gm;
const INDENT = '  ';

// ----------------------------------------------------------------
// METHODS
// ----------------------------------------------------------------

/** @param {string} entry @returns {string[]} module files in load order */
function loadOrder(entry) {
    const order = [];
    const seen = new Set();
    const visit = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(IMPORT_RE)) {
            if (m[1] && /\bas\b|\*/.test(m[1])) throw new Error(`${file}: only plain named imports are supported`);
            visit(path.resolve(path.dirname(file), m[2]));
        }
        order.push(file);
    };
    visit(path.resolve(entry));
    return order;
}

/** @param {string} file @param {string} root @returns {string} module text for the bundle */
function moduleText(file, root) {
    let text = fs.readFileSync(file, 'utf8');
    if (/^export (default|\{|\*)/m.test(text)) throw new Error(`${file}: only exported declarations are supported`);
    text = text
        .replace(IMPORT_RE, '')
        .replace(TYPE_IMPORT_RE, '')
        .replace(EXPORT_RE, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!text) return '';
    return `// Module: ${path.relative(root, file)}\n\n${text}`;
}

/** @param {string} code @returns {string} */
const indent = (code) =>
    code
        .split('\n')
        .map((l) => (l ? INDENT + l : l))
        .join('\n');

// Top-level names must be unique: in one scope, a second declaration would replace or break the first
/** @param {string[]} files @returns {void} */
function checkNames(files) {
    const owner = new Map();
    for (const file of files) {
        for (const m of fs.readFileSync(file, 'utf8').matchAll(DECL_RE)) {
            const names = m[1].startsWith('{')
                ? m[1]
                      .slice(1, -1)
                      .split(',')
                      .map((s) => s.split(':').pop().trim())
                : [m[1]];
            for (const name of names.filter(Boolean)) {
                if (owner.has(name) && owner.get(name) !== file)
                    throw new Error(`"${name}" in ${owner.get(name)} and ${file}`);
                owner.set(name, file);
            }
        }
    }
}

// ----------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------

const [entry, header, types, out] = process.argv.slice(2);
const root = path.dirname(path.dirname(path.resolve(entry))); // /src: module labels relative to it
const files = loadOrder(entry);
checkNames(files);
const typedefs = fs
    .readFileSync(types, 'utf8')
    .replace(/^export \{\};\n?/m, '')
    .trim();
const body = [typedefs, ...files.map((f) => moduleText(f, root))].filter(Boolean).join('\n\n');
const script =
    `${fs.readFileSync(header, 'utf8').trim()}\n\n` +
    '// Built from the modules in /src (just build-src): do not edit by hand.\n' +
    '// @ts-nocheck: the modules are type-checked (just type-check), not this file\n' +
    '(() => {\n' +
    `${INDENT}// biome-ignore lint/suspicious/noRedundantUseStrict: userscripts run as classic scripts, not as modules\n` +
    `${INDENT}'use strict';\n\n` +
    `${indent(body)}\n` +
    '})();\n';
fs.writeFileSync(out, script);
console.log(`bundled ${files.length} modules into ${out}`);
