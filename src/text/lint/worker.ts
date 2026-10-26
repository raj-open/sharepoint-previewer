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

import type { LintResult } from '../../_core/types.ts';
import type { Viewer } from '../../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

let lintWorkerUrl: string | null = null;
let workersBlocked = false;

// ===========================================================================
// METHODS
// ===========================================================================

function startLintWorker(v: Viewer, lang: string, text: string): Promise<LintResult> | null {
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

export async function lintFile(v: Viewer, lang: string, text: string): Promise<LintResult> {
    const linter = LINTERS[lang];

    const onPage = (): LintResult => {
        try {
            return linter(text);
        } catch (err) {
            return {
                problems: [{ line: 1, msg: `Check failed: ${(err as Error).message}`, severity: 'warning' }],
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
        if ((err as Error & { fallback?: boolean }).fallback) return onPage();
        return {
            problems: [{ line: 1, msg: `Check failed: ${(err as Error).message}`, severity: 'warning' }],
        };
    }
}
