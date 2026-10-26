// Drop-down with several lists side by side (e.g. sheets and tables of a workbook):
// ← → (or the tabs) switch the list shown, ↑ ↓ move, Enter picks, Esc closes

// ===========================================================================
// IMPORTS
// ===========================================================================

import { esc } from '../_core/util.ts';

import type { PickerList } from '../_core/types.ts';
import type { Picker } from '../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

// Button (shows the entry chosen) and its menu; the menu opens above the button, inside `host`
/** @param host positioned element the menu is placed in */
export function createPicker(host: HTMLElement, onPick: (list: number, item: number) => void): Picker {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tp-picker';
    button.hidden = true;
    button.setAttribute('aria-haspopup', 'listbox');
    const menu = document.createElement('div');
    menu.className = 'tp-picker-menu';
    menu.hidden = true;
    menu.tabIndex = -1;
    host.append(menu);

    let lists: PickerList[] = [];
    let chosen = { list: 0, item: 0 };
    let shown = 0; // list shown in the menu
    let active = 0; // entry marked for the keyboard

    const show = (list: number) => {
        shown = (list + lists.length) % lists.length;
        active = shown === chosen.list && chosen.item >= 0 ? chosen.item : lists[shown].start;
        draw();
    };

    const draw = () => {
        const tabs = lists
            .map((l, i) => {
                const count = l.items.length.toLocaleString();
                return `<button type="button" class="tp-picker-tab" data-list="${i}" aria-pressed="${i === shown}">${esc(l.label)} <span>${count}</span></button>`;
            })
            .join('');
        const { items, empty } = lists[shown];
        const rows = items.map((x, i) => {
            const marks = [i === active && 'tp-active', shown === chosen.list && i === chosen.item && 'tp-chosen'];
            const cls = marks.filter(Boolean).join(' ');
            const title = x.title ? ` title="${esc(x.title)}"` : '';
            return `<button type="button" class="tp-picker-item ${cls}" role="option" data-item="${i}"${title}>${esc(x.text)}</button>`;
        });
        const body = rows.length ? rows.join('') : `<div class="tp-picker-empty">${esc(empty)}</div>`;
        const head = `<button type="button" class="tp-picker-step" data-step="-1" title="Previous list (←)">‹</button>${tabs}<button type="button" class="tp-picker-step" data-step="1" title="Next list (→)">›</button>`;
        menu.innerHTML = `<div class="tp-picker-head">${head}</div><div class="tp-picker-list" role="listbox">${body}</div>`;
        menu.querySelector('.tp-active')?.scrollIntoView({ block: 'nearest' });
    };

    const close = () => {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', outside, true);
    };
    const outside = (e: Event) => {
        const t = e.target as Node;
        if (!menu.contains(t) && !button.contains(t)) close();
    };
    const open = () => {
        // above the button, right edges aligned; not higher than the viewer (else the page covers it): list scrolls
        const b = button.getBoundingClientRect();
        const h = host.getBoundingClientRect();
        const top = host.parentElement?.getBoundingClientRect().top ?? 0;
        menu.style.right = `${Math.round(h.right - b.right)}px`;
        menu.style.bottom = `${Math.round(h.bottom - b.top + 4)}px`;
        menu.style.maxHeight = `min(60vh, 340px, ${Math.max(120, Math.round(b.top - top - 8))}px)`;
        menu.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        show(chosen.list);
        menu.focus();
        document.addEventListener('pointerdown', outside, true);
    };
    const pick = (list: number, item: number) => {
        close();
        button.focus();
        if (list !== chosen.list || item !== chosen.item) onPick(list, item);
    };

    button.onclick = () => (menu.hidden ? open() : close());
    menu.onclick = (e) => {
        const t = (e.target as HTMLElement).closest('[data-list], [data-step], [data-item]');
        if (!(t instanceof HTMLElement)) return;
        if (t.dataset.list) show(Number(t.dataset.list));
        else if (t.dataset.step) show(shown + Number(t.dataset.step));
        else pick(shown, Number(t.dataset.item));
        if (!menu.hidden) menu.focus();
    };
    menu.onkeydown = (e) => {
        const n = lists[shown].items.length;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') show(shown + (e.key === 'ArrowLeft' ? -1 : 1));
        else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && n) {
            active = (active + (e.key === 'ArrowUp' ? -1 : 1) + n) % n;
            draw();
        } else if (e.key === 'Home' && n) {
            active = 0;
            draw();
        } else if (e.key === 'End' && n) {
            active = n - 1;
            draw();
        } else if (e.key === 'Enter' && n) pick(shown, active);
        else if (e.key === 'Escape' || e.key === 'Tab') {
            close();
            button.focus();
        } else return;
        e.preventDefault();
    };
    button.onkeydown = (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        open();
    };

    return {
        button,
        menu,
        // New lists and the entry chosen (item -1: none yet); label: text of the button
        set(next, choice, label, title) {
            lists = next;
            chosen = choice;
            button.textContent = `${label} ▾`;
            button.title = title;
            if (!menu.hidden) show(shown);
        },
        close,
    };
}
