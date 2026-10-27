// IFC (STEP) text: entity by id (type, name, line), STEP strings
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../helpers.ts';
import { load } from '../helpers.ts';

const { ifcEntity, stepString } = await load('text/ifc.ts');
const wall = new TextDecoder().decode(fixture('Models/wall.ifc'));

describe('text/ifc', () => {
    it('entity of a fixture: type, name, line', () => {
        assert.deepEqual(ifcEntity(wall, 60), { id: 60, type: 'IFCWALL', name: 'Wall', line: 27 });
        assert.deepEqual(ifcEntity(wall, 1), { id: 1, type: 'IFCPROJECT', name: 'Test project', line: 8 });
    });

    it('not there: null; #6 is not #60', () => {
        assert.equal(ifcEntity(wall, 999999), null);
        assert.equal(ifcEntity('#60=IFCWALL($,$,$);', 6), null);
    });

    it('arguments: quotes, commas and brackets inside, no name', () => {
        const text = "ISO-10303-21;\n#5= IFCSLAB('a,b',(#1,#2),'It''s (big)',$);\n#6=IFCCARTESIANPOINT((0.,0.,0.));\n";
        assert.deepEqual(ifcEntity(text, 5), { id: 5, type: 'IFCSLAB', name: "It's (big)", line: 2 });
        assert.equal(ifcEntity(text, 6)?.name, '');
    });

    it('STEP strings: quotes, \\X2\\ and \\X\\ encodings; not a string: empty', () => {
        assert.equal(stepString("'Wand \\X2\\00E4\\X0\\u'"), 'Wand äu');
        assert.equal(stepString("'caf\\X\\E9'"), 'café');
        assert.equal(stepString("'a''b'"), "a'b");
        assert.equal(stepString('$'), '');
    });
});
