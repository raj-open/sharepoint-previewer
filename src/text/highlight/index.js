import { highlightCsv } from './csv.js';
import { highlightIfc } from './ifc.js';
import { highlightJs } from './js.js';
import { highlightJson } from './json.js';
import { highlightM } from './m.js';
import { highlightMd } from './md.js';
import { highlightPy } from './py.js';
import { highlightRst } from './rst.js';
import { highlightSql } from './sql.js';
import { highlightToml } from './toml.js';
import { highlightXlf } from './xlf.js';
import { highlightXml } from './xml.js';
import { highlightYaml } from './yaml.js';
/** @typedef {import('../../_core/types.js').Token} Token */

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
};
