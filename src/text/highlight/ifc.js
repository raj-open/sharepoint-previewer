import { tokenise } from './tokenise.js';

/** @typedef {import('../../_core/types.js').Token} Token */

const IFC_RE = new RegExp(
  [
    /(\/\*[\s\S]*?\*\/)/.source, // 1 comment
    /('(?:[^']|'')*')/.source, // 2 string
    /(#\d+)/.source, // 3 instance reference
    /(\.[A-Z_][A-Z0-9_]*\.)/.source, // 4 enum / boolean
    /(END-ISO-10303-21|ISO-10303-21|\bHEADER\b|\bDATA\b|\bENDSEC\b)/.source, // 5 keyword
    /\b([A-Z][A-Z0-9_]*)(?=\s*\()/.source, // 6 entity type
    /(-?\b\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?)/.source, // 7 number
    /([$*])/.source, // 8 unset / derived
    /([()=,;])/.source, // 9 punctuation
  ].join('|'),
  'gi',
);

const IFC_CLASSES = ['', 'com', 'str', 'ref', 'enum', 'kw', 'type', 'num', 'lit', 'punct'];
/** @param {string} text @returns {Token[]} */
export const highlightIfc = (text) =>
  tokenise(text, IFC_RE, (m, out) => {
    const i = m.findIndex((g, idx) => idx > 0 && g !== undefined);
    out.push([IFC_CLASSES[i], m[0]]);
  });
