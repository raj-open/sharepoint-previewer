// File types (by extension) that get colours and checks
const LANGS = [
  ['xml', /\.(xml|xsd|xsl|xslt|svg|xaml|config|csproj|vbproj|props|targets|resx|plist|kml|gpx|rss|atom|wsdl|addin)$/i], // .addin: Revit add-in manifest
  ['json', /\.(json|geojson|webmanifest|har)$/i],
  ['yaml', /\.ya?ml$/i],
  ['ifc', /\.ifc(zip)?$/i], // .ifczip: unpacked first
  ['toml', /\.toml$/i],
  ['m', /\.(pq|pqm|m)$/i], // Power Query M
  ['js', /\.(js|mjs|cjs|jsx)$/i], // JavaScript
  ['md', /\.(md|markdown|mdown|mkd)$/i], // Markdown
  ['rst', /\.rst$/i], // reStructuredText
  ['csv', /\.(csv|tsv)$/i], // CSV / TSV
  ['xlf', /\.xlf$/i], // Excel formulas
  ['sql', /\.sql$/i], // SQL
  ['py', /\.(py|pyw|pyi)$/i], // Python
];

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

// Indentation style of text: tabs, 2 / 4 / ... spaces, or mixed (from first 5,000 lines)
/** @param {string} text @returns {string|null} */
export function indentation(text) {
  let tabs = 0;
  let spaces = 0;
  let prev = 0;
  const steps = new Map(); // indent change between lines -> how often
  let count = 0;
  for (const line of text.split('\n', 5000)) {
    if (!line.trim()) continue;
    const lead = line.match(/^[ \t]*/)[0];
    if (lead.includes('\t')) {
      tabs++;
      prev = 0;
      continue;
    }
    if (lead.length) spaces++;
    const step = Math.abs(lead.length - prev);
    if (step) steps.set(step, (steps.get(step) || 0) + 1);
    prev = lead.length;
    count++;
  }
  if (!tabs && !spaces) return count ? 'none' : null;
  if (tabs && spaces > tabs / 4 && tabs > spaces / 4) return 'mixed (tabs and spaces)';
  if (tabs > spaces) return 'tabs';
  let best = 0;
  let most = 0;
  for (const [step, n] of steps) {
    if (step <= 8 && (n > most || (n === most && step < best))) {
      best = step;
      most = n;
    }
  }
  return best ? `${best} spaces` : 'spaces';
}

export const LANG_NAMES = {
  json: 'JSON',
  xml: 'XML',
  yaml: 'YAML',
  ifc: 'IFC (STEP)',
  toml: 'TOML',
  m: 'Power Query M',
  js: 'JavaScript',
  md: 'Markdown',
  rst: 'reStructuredText',
  csv: 'CSV',
  xlf: 'Excel formulas',
  sql: 'SQL',
  py: 'Python',
};

/** @param {string} name @returns {string|null} */
export const langOf = (name) => (LANGS.find(([, re]) => re.test(name)) || [null])[0];
