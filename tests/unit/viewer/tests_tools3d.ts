// Controls of the 3D view (DOM and renderer stood in for): views, selection with its IFC line and properties, hide / isolate, section
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../helpers.ts';
import { load } from '../helpers.ts';

import type { Fake } from '../helpers.ts';

// Elements: enough of the DOM for the controls
const element = (): Fake => ({
    children: [] as Fake[],
    hidden: false,
    textContent: '',
    value: '',
    append(...kids: Fake[]) {
        this.children.push(...kids);
    },
    add(kid: Fake) {
        this.children.push(kid);
    },
    remove() {
        this.removed = true;
    },
    replaceChildren() {
        this.children = [];
        this.textContent = '';
    },
    setAttribute(k: string, v: string) {
        this[k] = v;
    },
});
Object.assign(globalThis, {
    document: { createElement: element },
    Option: function (this: Fake, text: string, value: string) {
        Object.assign(this, { text, value });
    },
});

const { tools3d, describe: describeEntity } = await load('viewer/tools3d.ts');
const wall = new TextDecoder().decode(fixture('Models/wall.ifc'));

function setup(picked: number | null = 60, sets?: (id: number) => Promise<unknown[]>) {
    const calls: string[] = [];
    const camera = {
        mode: 'perspective',
        setPresetView: (v: string) => calls.push(`view ${v}`),
        setPresetDirection: () => calls.push('view 3d'),
        toggleProjectionMode() {
            this.mode = this.mode === 'perspective' ? 'orthographic' : 'perspective';
        },
        getProjectionMode() {
            return this.mode;
        },
    };
    const renderer = {
        getCamera: () => camera,
        pick: async () => (picked === null ? null : { expressId: picked }),
        requestRender: () => calls.push('render'),
    };
    const lines: number[] = [];
    const stage = element();
    const tools = tools3d(stage, {
        renderer,
        bounds: null,
        fit: () => calls.push('fit'),
        text: () => wall,
        showLine: (n: number) => lines.push(n),
        sets,
    });
    const [bar, side] = stage.children;
    const [info, props] = side.children;
    const find = (row: Fake, text: string) => row.children.find((c: Fake) => c.textContent === text);
    const click = (row: Fake, text: string) => find(row, text).onclick({ stopPropagation() {} });
    return { tools, bar, side, info, props, calls, lines, find, click };
}

describe('viewer/tools3d', () => {
    it('start: nothing selected, hidden or cut; selection row hidden', () => {
        const { tools, info } = setup();
        assert.deepEqual(tools.options(), {
            selectedId: null,
            hiddenIds: new Set(),
            isolatedIds: null,
            sectionPlane: undefined,
        });
        assert.equal(info.hidden, true);
    });

    it('views and projection', () => {
        const { bar, calls, click, find } = setup();
        click(bar, 'Fit');
        click(bar, 'Top');
        click(bar, 'Side');
        click(bar, '3D');
        assert.deepEqual(
            calls.filter((c) => c !== 'render'),
            ['fit', 'view top', 'view right', 'view 3d'],
        );
        click(bar, 'Perspective');
        assert.ok(find(bar, 'Orthographic'));
    });

    it('click: object selected, named from its IFC line; "In text" goes to that line', async () => {
        const { tools, info, lines, click } = setup();
        await tools.select(10, 10);
        assert.equal(tools.options().selectedId, 60);
        assert.equal(info.hidden, false);
        assert.equal(info.children[0].textContent, 'IFCWALL "Wall" · #60');
        click(info, 'In text');
        assert.deepEqual(lines, [27]);
    });

    it('click on nothing: selection cleared', async () => {
        const { tools } = setup(null);
        await tools.select(10, 10);
        assert.equal(tools.options().selectedId, null);
    });

    it('hide, isolate, show all', async () => {
        const { tools, info, click, find } = setup();
        await tools.select(1, 1);
        click(info, 'Hide');
        assert.deepEqual([...tools.options().hiddenIds], [60]);
        assert.equal(tools.options().selectedId, null);
        assert.equal(find(info, 'Show all').hidden, false);
        await tools.select(1, 1);
        click(info, 'Isolate');
        assert.deepEqual([...tools.options().isolatedIds], [60]);
        assert.deepEqual([...tools.options().hiddenIds], []);
        click(info, 'Show all');
        assert.equal(tools.options().isolatedIds, null);
        assert.equal(find(info, 'Show all').hidden, true);
    });

    it('section: axis chosen, slider moves the plane; off again', () => {
        const { tools, bar } = setup();
        const [select, slider] = bar.children.slice(-2);
        assert.equal(slider.hidden, true);
        select.value = 'down';
        select.onchange();
        assert.deepEqual(tools.options().sectionPlane, { axis: 'down', position: 50, enabled: true, showGizmo: false });
        slider.value = '20';
        slider.oninput();
        assert.equal(tools.options().sectionPlane.position, 20);
        select.value = '';
        select.onchange();
        assert.equal(tools.options().sectionPlane, undefined);
        assert.equal(slider.hidden, true);
    });

    it('unknown id: number only; dispose removes the controls', async () => {
        assert.equal(describeEntity({ id: 7, type: '', name: '' }), '#7');
        const { tools, bar, side, info } = setup(424242);
        await tools.select(1, 1);
        assert.equal(info.children[0].textContent, '#424242');
        tools.dispose();
        assert.ok(bar.removed && side.removed);
    });

    it('properties: button only with a reader; read when opened, kept open for the next selection', async () => {
        const asked: number[] = [];
        const sets = async (id: number) => {
            asked.push(id);
            return [{ name: `Pset_${id}`, kind: 'Pset', from: '', rows: [] }];
        };
        const plain = setup();
        await plain.tools.select(1, 1);
        assert.equal(plain.find(plain.info, 'Properties').hidden, true); // no reader: no button
        const { tools, info, props, click, find } = setup(60, sets);
        await tools.select(1, 1);
        assert.equal(find(info, 'Properties').hidden, false);
        assert.equal(props.hidden, true);
        assert.deepEqual(asked, []); // nothing read before asked
        click(info, 'Properties');
        await new Promise((r) => setTimeout(r));
        assert.equal(props.hidden, false);
        assert.equal(props.children[0].children[0].textContent, 'Pset_60');
        await tools.select(1, 1); // same object: not read again
        assert.deepEqual(asked, [60]);
        click(info, 'Properties'); // closed: kept closed for the next 3D view
        assert.equal(props.hidden, true);
    });

    it('properties: read failure shown', async () => {
        const { tools, info, props, click } = setup(60, async () => {
            throw new Error('bad file');
        });
        await tools.select(1, 1);
        click(info, 'Properties');
        await new Promise((r) => setTimeout(r));
        assert.equal(props.textContent, 'Properties not read: bad file');
        click(info, 'Properties');
    });
});
