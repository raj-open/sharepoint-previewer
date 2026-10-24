import { zipEntries, zipEntryBytes } from '../zip.js';
import { scanXml, xmlAttrs, xmlString } from './xml.js';

/** @typedef {import('../../types.js').ByteReader} ByteReader */

// --- Packages (ZIP): parts by path, relationships between them ---

/** @param {ByteReader} read @param {number} size @returns {Promise<Object>} */
export async function zipPackage(read, size) {
  const entries = await zipEntries(read, size);
  const byName = new Map(entries.map((e) => [e.name.replace(/\\/g, '/').toLowerCase(), e])); // some writers use \
  const entry = (path) => (path ? byName.get(path.replace(/^\//, '').toLowerCase()) : undefined);
  const bytes = async (path) => {
    const e = entry(path);
    return e ? zipEntryBytes(read, e) : null;
  };
  const text = async (path) => {
    const b = await bytes(path);
    return b ? xmlString(b) : null;
  };
  return { entry, bytes, text };
}

// Path of target, relative to folder of `base` (or from root with leading "/")
/** @param {string} base @param {string} target @returns {string} */
function partPath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

/** @param {string} part @returns {string} "xl/workbook.xml" -> "xl/_rels/workbook.xml.rels" */
const relsPath = (part) => part.replace(/[^/]*$/, (n) => `_rels/${n}.rels`);

// Relationships of a part: id -> { path, type }
/** @param {Object} pkg @param {string} part @returns {Promise<Map<string, { path: string, type: string }>>} */
export async function partRels(pkg, part) {
  const out = new Map();
  const xml = await pkg.text(relsPath(part));
  if (!xml) return out;
  scanXml(
    xml,
    (n, a) => {
      if (n !== 'Relationship') return;
      const at = xmlAttrs(a);
      if (at.TargetMode !== 'External' && at.Target) {
        out.set(at.Id, { path: partPath(part, at.Target), type: at.Type || '' });
      }
    },
    () => {},
  );
  return out;
}
