// Styles: one <style> element with both themes, added to the page by injectStyles (not on load)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { element, load } from '../helpers.mjs';

const added = [];
const head = element();
globalThis.document = {
  createElement: (tag) => Object.assign(element(), { tag }),
  documentElement: { append: (...els) => added.push(...els) },
  head,
};
const styles = await load('ui/styles.js');
const before = added.length;
styles.injectStyles();

describe('ui/styles', () => {
  it('loading adds nothing', () => assert.equal(before, 0));
  it('style element with light and dark theme, own prefix', () => {
    const style = added.find((e) => e.tag === 'style');
    assert.ok(style);
    assert.match(style.textContent, /\.tp-light \{/);
    assert.match(style.textContent, /\.tp-dark \{/);
    assert.match(style.textContent, /\.tp-sheet-select/);
  });
});
