// Zen list: files dragged in go through to Sharepoint's list beneath; after a drop the folder is read anew
import assert from 'node:assert/strict';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { mock } from 'node:test';
import type { Fake } from '../helpers.ts';
import { load } from '../helpers.ts';

const { hasFiles, wireDrop } = await load('zen/drop.ts');

// ----------------------------------------------------------------
// Stubs: window (listeners), the Zen list, MutationObserver
// ----------------------------------------------------------------

const listeners = new Map<string, (e: Fake) => void>();
const observers: Fake[] = [];

/** @returns Zen list at (0, 0) – (100, 100), its classes */
function zenEl(): Fake {
    const classes = new Set<string>();
    return {
        classes,
        classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
            contains: (c: string) => classes.has(c),
        },
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    };
}

/** @returns drag event with files (or text) at a point */
const drag = (files = true, x = 50, y = 50): Fake => ({
    dataTransfer: { types: files ? ['Files'] : ['text/plain'] },
    clientX: x,
    clientY: y,
});

beforeEach(() => {
    listeners.clear();
    observers.length = 0;
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout'] });
    Object.assign(globalThis, {
        window: {
            addEventListener: (type: string, fn: (e: Fake) => void) => listeners.set(type, fn),
            removeEventListener: (type: string) => listeners.delete(type),
        },
        MutationObserver: class {
            fn: (records: Fake[]) => void;
            observed: unknown = null;
            constructor(fn: (records: Fake[]) => void) {
                this.fn = fn;
                observers.push(this);
            }
            observe(target: unknown) {
                this.observed = target;
            }
            disconnect() {
                this.observed = null;
            }
        },
    });
});

const fire = (type: string, e: Fake) => listeners.get(type)?.(e);

/** @returns record of a row added by Sharepoint (or an eye of the userscript) */
const added = (own = false): Fake => ({
    addedNodes: [{ closest: (sel: string) => (own && sel.includes('.tp-cell') ? {} : null) }],
    removedNodes: [],
});

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('zen/drop', () => {
    it('files only: not text or elements dragged', () => {
        assert.equal(hasFiles(drag()), true);
        assert.equal(hasFiles(drag(false)), false);
        assert.equal(hasFiles({}), false);
    });

    it('files dragged over: pointer let through until no dragover comes; others: nothing', () => {
        const el = zenEl();
        wireDrop(
            el,
            () => null,
            () => {},
        );
        fire('dragover', drag(false));
        assert.equal(el.classes.has('tp-zen-drop'), false);
        fire('dragenter', drag());
        assert.equal(el.classes.has('tp-zen-drop'), true);
        mock.timers.tick(200);
        fire('dragover', drag());
        mock.timers.tick(200);
        assert.equal(el.classes.has('tp-zen-drop'), true);
        mock.timers.tick(200);
        assert.equal(el.classes.has('tp-zen-drop'), false);
    });

    it("dropped on the list: Sharepoint's changes awaited, then the folder anew (own eyes ignored)", () => {
        const el = zenEl();
        const list = {};
        let reloads = 0;
        wireDrop(
            el,
            () => list,
            () => reloads++,
        );
        fire('dragover', drag());
        fire('drop', drag());
        mock.timers.tick(0);
        assert.equal(el.classes.has('tp-zen-drop'), false);
        const [o] = observers;
        assert.equal(o.observed, list);
        o.fn([added(true)]);
        mock.timers.tick(2000);
        assert.equal(reloads, 0);
        o.fn([added()]);
        mock.timers.tick(500);
        o.fn([added()]); // more rows: waits on
        mock.timers.tick(999);
        assert.equal(reloads, 0);
        mock.timers.tick(1);
        assert.equal(reloads, 1);
        mock.timers.tick(120000);
        assert.equal(o.observed, null); // quiet long enough: no longer watched
    });

    it('dropped elsewhere on the page, or not dragged over first: no watching', () => {
        const el = zenEl();
        wireDrop(
            el,
            () => ({}),
            () => {},
        );
        fire('drop', drag());
        fire('dragover', drag());
        fire('drop', drag(true, 500, 50));
        assert.equal(observers.length, 0);
    });

    it('stopped: listeners gone, mark and watching ended', () => {
        const el = zenEl();
        const stop = wireDrop(
            el,
            () => ({}),
            () => {},
        );
        fire('dragover', drag());
        fire('drop', drag());
        stop();
        assert.equal(listeners.size, 0);
        assert.equal(el.classes.has('tp-zen-drop'), false);
        assert.equal(observers[0].observed, null);
    });
});
