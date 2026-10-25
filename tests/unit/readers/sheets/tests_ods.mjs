// OpenDocument spreadsheet: typed values, repeated rows and cells, notes, encryption, database ranges
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../../helpers.mjs';
import { load } from '../../helpers.mjs';
import { reader } from '../../helpers.mjs';
import { zip } from '../../helpers.mjs';

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

    it('named database ranges as tables (LibreOffice: Excel tables saved as ODS)', async () => {
        const bytes = fixture('Data/orders.ods');
        const b = await readOds(await zipPackage(reader(bytes).read, bytes.length));
        assert.deepEqual(b.tables.map((t) => [t.name, t.sheet, t.header, t.totals]).sort(), [
            ['Orders', 1, 1, 1],
            ['Payments', 1, 1, 0],
            ['PriceList', 5, 1, 0],
            ['Regions', 1, 1, 0],
            ['Stock', 2, 1, 0],
            ['Suppliers', 3, 1, 0],
        ]);
        assert.deepEqual(b.tables.find((t) => t.name === 'Stock').range, { r0: 2, c0: 1, r1: 6, c1: 3 });
    });

    it('database ranges: quoted sheet names, "$", no header; anonymous and unknown ones left out', async () => {
        const range = (name, address, extra = '') =>
            `<table:database-range table:name="${name}" table:target-range-address="${address}"${extra}/>`;
        const b = await book({
            'content.xml': `<office:document-content ${NS}><office:body><office:spreadsheet>
                <table:table table:name="It's here"/><table:table table:name="B"/>
                <table:database-ranges>
                ${range('Quoted', "'It''s here'.$A$1:.$C$4")}
                ${range('Plain', 'B.B2:B.B9', ' table:contains-header="false"')}
                ${range('__Anonymous_Sheet_DB__0', 'B.A1:B.A2')}
                ${range('Elsewhere', 'Nowhere.A1:Nowhere.B2')}
                </table:database-ranges></office:spreadsheet></office:body></office:document-content>`,
        });
        assert.deepEqual(
            b.tables.map((t) => [t.name, t.sheet, t.header, t.range]),
            [
                ['Quoted', 0, 1, { r0: 0, c0: 0, r1: 3, c1: 2 }],
                ['Plain', 1, 0, { r0: 1, c0: 1, r1: 8, c1: 1 }],
            ],
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
