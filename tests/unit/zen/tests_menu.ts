// Zen list menus: closed by a pointer down outside them and their button
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import type { Fake } from '../helpers.ts';
import { load } from '../helpers.ts';

const { closeOutside } = await load('zen/menu.ts');

/** @returns element that contains itself only, removed once */
const node = (): Fake => {
    const n: Fake = { removed: 0 };
    n.contains = (t: unknown) => t === n;
    n.remove = () => n.removed++;
    return n;
};

describe('zen/menu', () => {
    it('pointer down inside the menu or on its button: stays; outside: removed, listener gone', () => {
        const listeners = new Set<(e: Fake) => void>();
        Object.assign(globalThis, {
            document: {
                addEventListener: (_: string, fn: (e: Fake) => void) => listeners.add(fn),
                removeEventListener: (_: string, fn: (e: Fake) => void) => listeners.delete(fn),
            },
        });
        const menu = node();
        const button = node();
        closeOutside(menu, button);
        const press = (target: unknown) => {
            for (const fn of [...listeners]) fn({ target });
        };
        press(menu);
        press(button);
        assert.equal(menu.removed, 0);
        press({});
        assert.equal(menu.removed, 1);
        assert.equal(listeners.size, 0);
    });
});
