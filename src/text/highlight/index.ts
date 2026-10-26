// Syntax highlighters by language

// ===========================================================================
// IMPORTS
// ===========================================================================

import { highlightCsv } from './csv.ts';
import { highlightIfc } from './ifc.ts';
import { highlightJs } from './js.ts';
import { highlightJson } from './json.ts';
import { highlightLog } from './log.ts';
import { highlightM } from './m.ts';
import { highlightMd } from './md.ts';
import { highlightPy } from './py.ts';
import { highlightRst } from './rst.ts';
import { highlightSql } from './sql.ts';
import { highlightToml } from './toml.ts';
import { highlightXlf } from './xlf.ts';
import { highlightXml } from './xml.ts';
import { highlightYaml } from './yaml.ts';

/** @typedef {import('../../_core/types.ts').Token} Token */

// ===========================================================================
// CONSTANTS
// ===========================================================================

/** @type {Object<string, (text: string) => Token[]>} */
export const HIGHLIGHTERS = {
    sql: highlightSql,
    py: highlightPy,
    xlf: highlightXlf,
    csv: highlightCsv,
    md: highlightMd,
    rst: highlightRst,
    js: highlightJs,
    m: highlightM,
    json: highlightJson,
    xml: highlightXml,
    yaml: highlightYaml,
    ifc: highlightIfc,
    toml: highlightToml,
    log: highlightLog,
};
