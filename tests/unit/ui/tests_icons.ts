import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const icons = await load('ui/icons.ts');

describe('ui/icons', () => {
    it('every icon is one SVG, drawn in the current colour', () => {
        assert.ok(Object.keys(icons).length > 20);
        for (const [name, svg] of Object.entries(icons)) {
            assert.match(svg.trim(), /^<svg [\s\S]*<\/svg>$/, name);
            assert.match(svg, /currentColor/, name);
        }
    });
});
