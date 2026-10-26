// Linters by language

// ===========================================================================
// IMPORTS
// ===========================================================================

import { lintIfc } from './ifc.ts';
import { lintJson } from './json.ts';
import { lintM } from './m.ts';
import { lintXml } from './xml.ts';
import { lintYaml } from './yaml.ts';

import type { LintResult } from '../../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const LINTERS: Record<string, (text: string) => LintResult> = {
    json: lintJson,
    xml: lintXml,
    yaml: lintYaml,
    ifc: lintIfc,
    m: lintM,
};
