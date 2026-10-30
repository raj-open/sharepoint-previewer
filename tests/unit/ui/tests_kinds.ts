// Kinds of files by name, and their icons
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { kindIcon, kindOf } = await load('ui/kinds.ts');

describe('ui/kinds', () => {
    it('by name: own extensions first, then the formats of the viewer; unknown: other', () => {
        const cases: [string, string][] = [
            ['BOM-LINE.csv', 'table'],
            ['MockDatenkatalog.xlsx', 'table'],
            ['REPORT_schema.parquet', 'table'],
            ['RealModel1.ifc', 'model'],
            ['model.IFCZIP', 'model'],
            ['sales.pbix', 'report'],
            ['settings.json', 'data'],
            ['data.xml', 'data'],
            ['logo.svg', 'image'],
            ['photo.JPG', 'image'],
            ['main.py', 'code'],
            ['main.ts', 'code'],
            ['debug 2025-11-06 1824.log', 'log'],
            ['README.md', 'text'],
            ['notes.txt', 'text'],
            ['offer.pdf', 'document'],
            ['minutes.docx', 'document'],
            ['backup.zip', 'archive'],
            ['LICENCE', 'other'],
            ['blob.bin', 'other'],
        ];
        for (const [name, kind] of cases) assert.equal(kindOf(name), kind, name);
        assert.equal(kindOf('Reports', true), 'folder');
        assert.equal(kindOf('x.csv', true), 'folder');
    });

    it('icon: one SVG, coloured by the class of its kind', () => {
        for (const kind of ['folder', 'table', 'other']) {
            const svg = kindIcon(kind);
            assert.match(svg, /^<svg [\s\S]*<\/svg>$/);
            assert.ok(svg.includes(`tp-kind-${kind}`));
            assert.match(svg, /currentColor/);
        }
    });
});
