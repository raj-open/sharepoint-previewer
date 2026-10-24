// Packages (ZIP): parts by path (case and backslashes tolerated), relationships
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load, reader, zip } from '../../helpers.mjs';

const { zipPackage, partRels } = await load('readers/sheets/package.js');
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

describe('readers/sheets/package', () => {
  const { bytes } = zip({
    'xl\\Workbook.xml': '<workbook/>',
    'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="r1" Type="${R}/worksheet" Target="worksheets/s1.xml"/><Relationship Id="r2" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/><Relationship Id="r3" Type="${R}/styles" Target="/xl/styles.xml"/></Relationships>`,
  });

  it('parts by path', async () => {
    const pkg = await zipPackage(reader(bytes).read, bytes.length);
    assert.ok(pkg.entry('/XL/workbook.xml'));
    assert.equal(await pkg.text('xl/workbook.xml'), '<workbook/>');
    assert.equal(await pkg.bytes('missing.xml'), null);
  });
  it('relationships: relative and absolute targets; external ones left out', async () => {
    const pkg = await zipPackage(reader(bytes).read, bytes.length);
    const rels = await partRels(pkg, 'xl/workbook.xml');
    assert.deepEqual(Object.fromEntries([...rels].map(([id, r]) => [id, r.path])), {
      r1: 'xl/worksheets/s1.xml',
      r3: 'xl/styles.xml',
    });
  });
});
