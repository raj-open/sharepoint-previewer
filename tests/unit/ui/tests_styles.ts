// Styles: one <style> element with both themes, added to the page by injectStyles (not on load)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import type { Fake } from '../helpers.ts';
import { element } from '../helpers.ts';
import { load } from '../helpers.ts';

const added: Fake[] = [];
const head = element();
Object.assign(globalThis, {
    document: {
        createElement: (tag: string) => Object.assign(element(), { tag }),
        documentElement: { append: (...els: Fake[]) => added.push(...els) },
        head,
    },
});
const styles = await load('ui/styles.ts');
const before = added.length;
styles.injectStyles();

describe('ui/styles', () => {
    it('loading adds nothing', () => assert.equal(before, 0));
    it('style element with light and dark theme, own prefix', () => {
        const style = added.find((e) => e.tag === 'style');
        assert.ok(style);
        assert.match(style.textContent, /\.tp-light \{/);
        assert.match(style.textContent, /\.tp-dark \{/);
        assert.match(style.textContent, /\.tp-picker-menu/);
    });
});
