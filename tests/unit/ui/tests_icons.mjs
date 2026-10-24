import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../helpers.mjs';

const icons = await load('ui/icons.js');

describe('ui/icons', () => {
  it('every icon is one SVG, drawn in the current colour', () => {
    assert.ok(Object.keys(icons).length > 20);
    for (const [name, svg] of Object.entries(icons)) {
      assert.match(svg.trim(), /^<svg [\s\S]*<\/svg>$/, name);
      assert.match(svg, /currentColor/, name);
    }
  });
});
