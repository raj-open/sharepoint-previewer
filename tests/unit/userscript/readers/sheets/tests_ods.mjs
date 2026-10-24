// OpenDocument spreadsheet: typed values, repeated rows and cells, notes, encryption
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixture, load, reader, zip } from '../../../helpers.mjs';

const { readOds } = await load('readers/sheets/ods.js');
const { zipPackage } = await load('readers/sheets/package.js');

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
const book = async (files) => {
  const { bytes } = zip(files);
  return readOds(await zipPackage(reader(bytes).read, bytes.length));
};

describe('readers/sheets/ods', () => {
  it('fixture: all sheets read at once', async () => {
    const bytes = fixture('Data/harvest.ods');
    const b = await readOds(await zipPackage(reader(bytes).read, bytes.length));
    assert.deepEqual(
      b.sheets.map((s) => s.data.rows.length),
      [4, 4, 1],
    );
  });

  it('values, repeats, spaces, notes left out', async () => {
    const b = await book({
      'content.xml': `<office:document-content ${NS}><office:body><office:spreadsheet><table:table table:name="T">
        <table:table-row><table:table-cell office:value-type="percentage" office:value="0.25"><text:p>25 %</text:p></table:table-cell>
          <table:table-cell office:value-type="time" office:time-value="PT01H02M03S"><text:p>01:02</text:p></table:table-cell>
          <table:table-cell office:value-type="string"><text:p>a<text:s text:c="2"/>b</text:p><office:annotation><text:p>note</text:p></office:annotation></table:table-cell></table:table-row>
        <table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2" office:value-type="float" office:value="1"/></table:table-row>
        <table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
      </table:table></office:spreadsheet></office:body></office:document-content>`,
    });
    assert.deepEqual(b.sheets[0].data.rows, [
      ['25%', '01:02:03', 'a  b'],
      ['1', '1'],
      ['1', '1'],
    ]);
  });

  it('encrypted: refused', async () => {
    await assert.rejects(
      book({
        'META-INF/manifest.xml':
          '<manifest:manifest><manifest:file-entry><manifest:encryption-data/></manifest:file-entry></manifest:manifest>',
        'content.xml': 'garbage',
      }),
      /password-protected/,
    );
  });
});
