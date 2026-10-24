// Linters by language

// ===========================================================================
// IMPORTS
// ===========================================================================

import { lintIfc } from './ifc.js';
import { lintJson } from './json.js';
import { lintM } from './m.js';
import { lintXml } from './xml.js';
import { lintYaml } from './yaml.js';

/** @typedef {import('../../_core/types.js').LintResult} LintResult */

// ===========================================================================
// CONSTANTS
// ===========================================================================

/** @type {Object<string, (text: string) => LintResult>} */
export const LINTERS = { json: lintJson, xml: lintXml, yaml: lintYaml, ifc: lintIfc, m: lintM };
