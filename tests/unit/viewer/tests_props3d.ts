// Property and quantity sets of an IFC element: reader (ifc-lite stood in for), values with units, display
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

import type { Fake } from '../helpers.ts';

// Elements: enough of the DOM for the display
const element = (): Fake => ({
    children: [] as Fake[],
    textContent: '',
    append(...kids: Fake[]) {
        this.children.push(...kids);
    },
    replaceChildren() {
        this.children = [];
        this.textContent = '';
    },
});
Object.assign(globalThis, { document: { createElement: element } });

const { propsReader, origin, propertyText, quantityText, formatValue, showSets } = await load('viewer/props3d.ts');

// Units of a project in millimetres
const units = {
    unitForMeasure: (m: string) =>
        ({ IFCLENGTHMEASURE: { symbol: 'mm' }, LENGTHMEASURE: { symbol: 'mm' }, AREAMEASURE: { symbol: 'm²' } })[m] ??
        null,
};

// ifc-lite stood in for: wall #60 with an own Pset and Qto, its type with a Pset; parses counted
function fakeLib(fail = 0) {
    const calls = { parse: 0 };
    const pset = (name: string, properties: Fake[]) => ({ name, properties });
    const lib = {
        IfcParser: class {
            async parseColumnar() {
                calls.parse++;
                if (calls.parse <= fail) throw new Error('bad file');
                return { source: 'src', entityIndex: 'index' };
            }
        },
        extractProjectUnits: () => units,
        extractPropertiesOnDemand: (_: Fake, id: number) =>
            id === 60 ? [pset('Pset_WallCommon', [{ name: 'IsExternal', type: 3, value: true }])] : [],
        extractQuantitiesOnDemand: (_: Fake, id: number) =>
            id === 60
                ? [{ name: 'Qto_WallBaseQuantities', quantities: [{ name: 'Length', type: 0, value: 5000 }] }]
                : [],
        extractTypePropertiesOnDemand: (_: Fake, id: number) =>
            id === 60
                ? {
                      typeName: 'Brick 200',
                      properties: [
                          pset('Pset_WallCommon', []),
                          pset('Pset_WallTypeCommon', [{ name: 'FireRating', value: 'REI 90' }]),
                      ],
                  }
                : null,
        extractTypeQuantitiesOnDemand: () => null,
        mergeInheritedPropertySets: (own: Fake[], inherited: Fake[]) => [
            ...own,
            ...inherited.filter((s) => !own.some((o) => o.name === s.name)),
        ],
        mergeInheritedQuantitySets: (own: Fake[]) => own,
    };
    return { lib, calls };
}

describe('viewer/props3d', () => {
    it('reader: own sets, then those of the type; parsed once', async () => {
        const { lib, calls } = fakeLib();
        const read = propsReader(lib, new Uint8Array([1, 2, 3]));
        assert.equal(calls.parse, 0); // nothing before the first call
        assert.deepEqual(await read(60), [
            { name: 'Pset_WallCommon', kind: 'Pset', from: '', rows: [['IsExternal', 'true']] },
            { name: 'Pset_WallTypeCommon', kind: 'Pset', from: 'Brick 200', rows: [['FireRating', 'REI 90']] },
            { name: 'Qto_WallBaseQuantities', kind: 'Qto', from: '', rows: [['Length', '5000 mm']] },
        ]);
        assert.deepEqual(await read(70), []);
        assert.equal(calls.parse, 1);
    });

    it('reader: failed parse tried again on the next call', async () => {
        const { lib, calls } = fakeLib(1);
        const read = propsReader(lib, new Uint8Array());
        await assert.rejects(read(60), /bad file/);
        assert.equal((await read(60)).length, 3);
        assert.equal(calls.parse, 2);
    });

    it('origin: own name or the type', () => {
        const from = origin([{ name: 'A' }], 'T');
        assert.equal(from('A'), '');
        assert.equal(from('B'), 'T');
    });

    it('values: numbers with unit (declared or of the project), lists, complex, nothing', () => {
        assert.equal(propertyText({ name: 'w', value: 200, dataType: 'IFCLENGTHMEASURE' }, units), '200 mm');
        assert.equal(propertyText({ name: 'u', value: 0.28, unit: 'W/(m²·K)' }, units), '0.28 W/(m²·K)');
        assert.equal(propertyText({ name: 'n', value: 3, dataType: 'IFCCOUNTMEASURE' }, units), '3');
        assert.equal(propertyText({ name: 'l', value: 'x', dataType: 'IFCLABEL' }, units), 'x');
        assert.equal(
            propertyText(
                {
                    name: 'c',
                    value: null,
                    members: [
                        { name: 'a', value: 1 },
                        { name: 'b', value: false },
                    ],
                },
                units,
            ),
            'a: 1; b: false',
        );
        assert.equal(quantityText({ name: 'A', type: 1, value: 1.44 }, units), '1.44 m²');
        assert.equal(quantityText({ name: 'A', type: 1, value: 2, explicitUnit: 'cm²' }, units), '2 cm²');
        assert.equal(quantityText({ name: 'N', type: 3, value: 1 }, units), '1');
        assert.equal(formatValue(0.1 + 0.2), '0.3');
        assert.equal(formatValue(['a', 2]), 'a, 2');
        assert.equal(formatValue(null), '');
    });

    it('display: one table per set, type marked; none: a note', () => {
        const el = element();
        showSets(el, [{ name: 'Pset_A', kind: 'Pset', from: 'T', rows: [['k', 'v']] }]);
        const [box] = el.children;
        const [head, table] = box.children;
        assert.equal(head.textContent, 'Pset_A');
        assert.equal(head.children[0].textContent, 'type: T');
        assert.deepEqual(
            table.children[0].children.map((td: Fake) => td.textContent),
            ['k', 'v'],
        );
        showSets(el, []);
        assert.equal(el.textContent, 'No property or quantity sets');
    });
});
