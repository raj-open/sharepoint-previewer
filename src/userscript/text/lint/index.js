import { lintIfc } from './ifc.js';
import { lintJson } from './json.js';
import { lintM } from './m.js';
import { lintXml } from './xml.js';
import { lintYaml } from './yaml.js';

export const LINTERS = { json: lintJson, xml: lintXml, yaml: lintYaml, ifc: lintIfc, m: lintM };
