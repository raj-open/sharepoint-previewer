// Property and quantity sets read by ifc-lite's parser itself (as bundled for the 3D view) from the corner model
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { IfcParser } from '@ifc-lite/parser';
import { extractProjectUnits } from '@ifc-lite/parser';
import { extractPropertiesOnDemand } from '@ifc-lite/parser';
import { extractQuantitiesOnDemand } from '@ifc-lite/parser';
import { extractTypePropertiesOnDemand } from '@ifc-lite/parser';
import { extractTypeQuantitiesOnDemand } from '@ifc-lite/parser';
import { mergeInheritedPropertySets } from '@ifc-lite/parser';
import { mergeInheritedQuantitySets } from '@ifc-lite/parser';
import { fixture } from '../../unit/helpers.ts';
import { load } from '../../unit/helpers.ts';

const { propsReader } = await load('viewer/props3d.ts');
const lib = {
    IfcParser,
    extractProjectUnits,
    extractPropertiesOnDemand,
    extractQuantitiesOnDemand,
    extractTypePropertiesOnDemand,
    extractTypeQuantitiesOnDemand,
    mergeInheritedPropertySets,
    mergeInheritedQuantitySets,
};

describe('viewer/props3d with ifc-lite', () => {
    const read = propsReader(lib, fixture('Models/corner.ifc'));

    it('wall: own Pset, Pset of its type, Qto in project units', async () => {
        assert.deepEqual(await read(60), [
            {
                name: 'Pset_WallCommon',
                kind: 'Pset',
                from: '',
                rows: [
                    ['IsExternal', 'true'],
                    ['LoadBearing', 'false'],
                    ['Reference', 'W-01'],
                    ['ThermalTransmittance', '0.28 W/(m²·K)'],
                ],
            },
            { name: 'Pset_WallTypeCommon', kind: 'Pset', from: 'Brick 200', rows: [['FireRating', 'REI 90']] },
            {
                name: 'Qto_WallBaseQuantities',
                kind: 'Qto',
                from: '',
                rows: [
                    ['Length', '5 m'],
                    ['Width', '0.2 m'],
                    ['Height', '3 m'],
                    ['GrossSideArea', '15 m²'],
                    ['NetVolume', '2.712 m³'],
                ],
            },
        ]);
    });

    it('window: enumerated value, count without unit; opening: nothing', async () => {
        const sets = await read(90);
        assert.deepEqual(
            sets.map((s: { name: string }) => s.name),
            ['Pset_WindowCommon', 'Qto_WindowBaseQuantities'],
        );
        assert.deepEqual(sets[0].rows[1], ['GlazingType', 'Double']);
        assert.deepEqual(sets[1].rows.at(-1), ['Panes', '1']);
        assert.deepEqual(await read(80), []);
    });
});
