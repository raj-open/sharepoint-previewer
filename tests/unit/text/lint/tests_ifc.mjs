import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../../helpers.mjs';
import { load } from '../../helpers.mjs';

const { lintIfc } = await load('text/lint/ifc.js');
const text = (f) => new TextDecoder().decode(fixture(f));

describe('text/lint/ifc', () => {
    it('wall.ifc: no problems', () => assert.deepEqual(lintIfc(text('Models/wall.ifc')).problems, []));
    it('broken.ifc: errors with lines', () => {
        const errors = lintIfc(text('Models/broken.ifc')).problems.filter((p) => p.severity === 'error');
        assert.ok(errors.length > 0);
        assert.ok(errors.every((p) => p.line >= 1));
    });
});
