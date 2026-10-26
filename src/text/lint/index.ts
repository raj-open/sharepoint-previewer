// Linters by language

// ===========================================================================
// IMPORTS
// ===========================================================================

import { lintIfc } from './ifc.ts';
import { lintJson } from './json.ts';
import { lintM } from './m.ts';
import { lintXml } from './xml.ts';
import { lintYaml } from './yaml.ts';

/** @typedef {import('../../_core/types.ts').LintResult} LintResult */

// ===========================================================================
// CONSTANTS
// ===========================================================================

/** @type {Object<string, (text: string) => LintResult>} */
export const LINTERS = { json: lintJson, xml: lintXml, yaml: lintYaml, ifc: lintIfc, m: lintM };
