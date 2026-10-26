// Checks in Web Worker (XML on page: needs DOMParser); fallback: page

// ===========================================================================
// IMPORTS
// ===========================================================================

import { MAX_PROBLEMS } from '../../_core/settings.ts';
import { nextFrame } from '../../_core/util.ts';
import { YAML_KEY_RE } from '../highlight/yaml.ts';
import { collector } from './core.ts';
import { lineAt } from './core.ts';
import { lintIfc } from './ifc.ts';
import { LINTERS } from './index.ts';
import { lintJson } from './json.ts';
import { lintM } from './m.ts';
import { lintYaml } from './yaml.ts';
import { stripYamlComment } from './yaml.ts';

/** @typedef {import('../../_core/types.ts').LintResult} LintResult */
/** @typedef {import('../../_core/types.ts').Viewer} Viewer */

// ===========================================================================
// CONSTANTS
// ===========================================================================

/** @type {string|null} */
let lintWorkerUrl = null;
let workersBlocked = false;

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {Viewer} v @param {string} lang @param {string} text @returns {Promise<LintResult>|null} */
function startLintWorker(v, lang, text) {
    if (workersBlocked || !['json', 'yaml', 'ifc', 'm'].includes(lang)) return null;
    try {
        if (!lintWorkerUrl) {
            const src = `
        const MAX_PROBLEMS = ${MAX_PROBLEMS};
        const YAML_KEY_RE = ${YAML_KEY_RE};
        const lineAt = ${lineAt};
        ${stripYamlComment}
        ${collector}
        ${lintJson}
        ${lintYaml}
        ${lintIfc}
        ${lintM}
        const LINTERS = { json: lintJson, yaml: lintYaml, ifc: lintIfc, m: lintM };
        onmessage = (e) => {
          try {
            postMessage({ ok: true, result: LINTERS[e.data.lang](e.data.text) });
          } catch (err) {
            postMessage({ ok: false, error: /** @type {Error} */ (err).message });
          }
        };
      `;
            lintWorkerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        }
        const worker = new Worker(lintWorkerUrl);
        v.lintWorker = worker;
        return new Promise((resolve, reject) => {
            worker.onmessage = (e) => {
                worker.terminate();
                if (e.data.ok) resolve(e.data.result);
                else reject(new Error(e.data.error));
            };
            worker.onerror = (e) => {
                e.preventDefault();
                worker.terminate();
                workersBlocked = true;
                reject(Object.assign(new Error('worker unavailable'), { fallback: true }));
            };
            worker.postMessage({ lang, text });
        });
    } catch {
        workersBlocked = true;
        return null;
    }
}

/** @param {Viewer} v @param {string} lang @param {string} text @returns {Promise<LintResult>} */
export async function lintFile(v, lang, text) {
    const linter = LINTERS[lang];

    /** @returns {LintResult} */
    const onPage = () => {
        try {
            return linter(text);
        } catch (err) {
            return {
                problems: [
                    { line: 1, msg: `Check failed: ${/** @type {Error} */ (err).message}`, severity: 'warning' },
                ],
            };
        }
    };
    const job = startLintWorker(v, lang, text);
    if (!job) {
        await nextFrame(); // let text appear before page is busy with check
        return onPage();
    }
    try {
        return await job;
    } catch (err) {
        if (/** @type {Error & { fallback?: boolean }} */ (err).fallback) return onPage();
        return {
            problems: [{ line: 1, msg: `Check failed: ${/** @type {Error} */ (err).message}`, severity: 'warning' }],
        };
    }
}
