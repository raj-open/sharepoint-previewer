import { formatKind } from './cells.js';
import { partRels } from './package.js';
import { XLSB_PARTS } from './xlsb.js';
import { XLSX_PARTS } from './xlsx.js';
/** @typedef {import('../../_core/types.js').Book} Book */
/** @typedef {import('../../_core/types.js').Package} Package */

// Excel 2007+ package: workbook part from package relationships (.xlsx: XML, .xlsb: binary)
/** @param {Package} pkg @returns {Promise<Book>} */
export async function readOoxml(pkg) {
  const main = [...(await partRels(pkg, '')).values()].find((r) => r.type.endsWith('/officeDocument'))?.path;
  const wbPath = [main, 'xl/workbook.xml', 'xl/workbook.bin'].find((p) => pkg.entry(p));
  if (!wbPath) throw new Error('no workbook inside (not a spreadsheet?)');
  const binary = /\.bin$/i.test(wbPath);
  const parts = binary ? XLSB_PARTS : XLSX_PARTS;
  const rels = await partRels(pkg, wbPath);
  /** @param {string} type */
  const relOf = (type) => [...rels.values()].find((r) => r.type.endsWith(`/${type}`))?.path;
  const wb = parts.workbook(/** @type {Uint8Array} */ (await pkg.bytes(wbPath))); // found above

  const stringsPath = relOf('sharedStrings');
  const stylesPath = relOf('styles');
  const strings = pkg.entry(stringsPath) ? parts.strings(/** @type {Uint8Array} */ (await pkg.bytes(stringsPath))) : [];
  const kinds = pkg.entry(stylesPath)
    ? parts.styles(/** @type {Uint8Array} */ (await pkg.bytes(stylesPath))).map(formatKind)
    : [];

  const sheets = wb.sheets.map((s, i) => {
    const rel = rels.get(s.id);
    const path = rel?.path || `xl/worksheets/sheet${i + 1}.${binary ? 'bin' : 'xml'}`;
    return {
      name: s.name,
      hidden: s.hidden,
      kind: /chartsheet$/i.test(rel?.type || '') ? 'chart' : 'sheet',
      size: pkg.entry(path)?.packed || 0,
      path,
    };
  });
  return {
    format: `Excel (${binary ? 'XLSB' : 'XLSX'})`,
    sheets,
    active: wb.active,
    date1904: wb.date1904,
    load: async (i) => {
      const s = sheets[i];
      if (s.kind !== 'sheet' || !pkg.entry(s.path)) return null;
      return parts.sheet(/** @type {Uint8Array} */ (await pkg.bytes(s.path)), strings, kinds, wb.date1904); // entry checked above
    },
  };
}
