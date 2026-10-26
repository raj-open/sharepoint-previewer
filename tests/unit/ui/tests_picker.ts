// Drop-down with lists side by side: tabs and ← → switch lists, ↑ ↓ Enter pick, Esc closes
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { element } from '../helpers.ts';
import { load } from '../helpers.ts';

const { createPicker } = await load('ui/picker.ts');

// elements as the picker uses them: placed, focusable, containing nothing else
const node = () =>
    Object.assign(element(), {
        append() {},
        focus() {},
        contains: () => false,
        getBoundingClientRect: () => ({ top: 500, right: 400, bottom: 530 }),
        querySelector: () => null,
    });
Object.assign(globalThis, { document: { createElement: node, addEventListener() {}, removeEventListener() {} } });

const LISTS = [
    { label: 'Sheets', items: [{ text: '● Prices' }, { text: '○ Notes' }], empty: 'No sheets', start: 0 },
    { label: 'Tables', items: [], empty: 'No tables in this file', start: 0 },
];
const key = (p, k) => p.menu.onkeydown({ key: k, preventDefault() {} });

describe('ui/picker', () => {
    it('button shows the entry chosen; menu opens on the list chosen', () => {
        const p = createPicker(node(), () => {});
        p.set(LISTS, { list: 0, item: 1 }, 'Notes', 'Sheet 2 of 2');
        assert.equal(p.button.textContent, 'Notes ▾');
        assert.equal(p.menu.hidden, true);
        p.button.onclick();
        assert.equal(p.menu.hidden, false);
        assert.match(p.menu.innerHTML, /data-list="0" aria-pressed="true">Sheets <span>2<\/span>/);
        assert.match(p.menu.innerHTML, /tp-active tp-chosen" role="option" data-item="1">○ Notes/);
    });

    it('nothing chosen yet (item -1): menu marks the list start, any entry is a pick', () => {
        const picks: [number, number][] = [];
        const p = createPicker(node(), (list, item) => picks.push([list, item]));
        p.set(LISTS, { list: 0, item: -1 }, 'Select', '');
        p.button.onclick();
        assert.match(p.menu.innerHTML, /tp-picker-item tp-active" role="option" data-item="0">● Prices/);
        key(p, 'Enter');
        assert.deepEqual(picks, [[0, 0]]);
    });

    it('menu not higher than the room above the button inside the viewer', () => {
        const host = Object.assign(node(), { parentElement: { getBoundingClientRect: () => ({ top: 300 }) } });
        const p = createPicker(host, () => {});
        p.set(LISTS, { list: 0, item: 0 }, 'Prices', '');
        p.button.onclick();
        assert.equal(p.menu.style.maxHeight, 'min(60vh, 340px, 192px)'); // button top 500 − viewer top 300 − 8
    });

    it('← → switch lists (round), an empty list says why', () => {
        const p = createPicker(node(), () => {});
        p.set(LISTS, { list: 0, item: 0 }, 'Prices', '');
        p.button.onclick();
        key(p, 'ArrowRight');
        assert.match(p.menu.innerHTML, /data-list="1" aria-pressed="true"/);
        assert.match(p.menu.innerHTML, /No tables in this file/);
        key(p, 'ArrowRight');
        assert.match(p.menu.innerHTML, /data-list="0" aria-pressed="true"/);
    });

    it('↑ ↓ Enter pick an entry of the list shown; Esc closes without a pick', () => {
        const picks: number[][] = [];
        const p = createPicker(node(), (list, item) => picks.push([list, item]));
        p.set(LISTS, { list: 0, item: 0 }, 'Prices', '');
        p.button.onclick();
        key(p, 'ArrowDown');
        key(p, 'Enter');
        assert.deepEqual(picks, [[0, 1]]);
        assert.equal(p.menu.hidden, true);
        p.button.onclick();
        key(p, 'Escape');
        assert.equal(p.menu.hidden, true);
        assert.deepEqual(picks, [[0, 1]]);
    });
});
