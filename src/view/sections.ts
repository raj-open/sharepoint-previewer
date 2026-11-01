// Markdown with a navigator: sections (level 2) listed on the left, grouped by their level 1 heading, one shown
// at a time; search (all words, title and text), ↑ / ↓ / Home / End, previous / next; choice kept while the page is open;
// sections with warnings (`> [!WARNING]`, `> [!CAUTION]`): marked with their number of points, and a filter for them;
// a dot on each section with hints, in the colour of its highest level (caution: red, warning: amber, else blue),
// not on the text before the first section

// ===========================================================================
// IMPORTS
// ===========================================================================

import { drawDiagrams } from './diagram.ts';

import type { LineView } from '../_core/types.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** section: title, group (level 1 above it), first line (if short), its elements, text for the search,
 * points in its warnings */
type Section = {
    title: string;
    group: string;
    hint: string;
    nodes: Node[];
    text: string;
    errors: number;
    warnings: number;
    notes: number;
};

// ===========================================================================
// CONSTANTS
// ===========================================================================

const MAX_HINT = 60; // first line of a section shown under its title if not longer
const kept = new Map<string, { index: number; query: string; warned: boolean }>(); // per document: shown, search, filter

// ===========================================================================
// METHODS
// ===========================================================================

// Navigator over a rendered Markdown document (its elements are moved into the sections)
export function mountSections(content: HTMLElement, doc: HTMLElement): LineView {
    const sections = splitSections(doc);
    const key = sections.map((s) => s.title).join('\n');
    const state = kept.get(key) || { index: 0, query: '', warned: false };
    kept.set(key, state);
    const stops: (() => void)[] = [];

    const nav = document.createElement('div');
    nav.className = 'tp-nav';
    const side = document.createElement('div');
    side.className = 'tp-nav-side';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'tp-nav-search';
    search.placeholder = 'Search …';
    search.value = state.query;
    search.title = 'All words, in titles and text; ↑ / ↓ choose, Enter shows';
    const counter = document.createElement('div');
    counter.className = 'tp-nav-count';
    const list = document.createElement('div');
    list.className = 'tp-nav-list';
    list.tabIndex = 0;
    list.setAttribute('role', 'listbox');
    const warned = sections.filter((s) => s.errors + s.warnings).length;
    const only = document.createElement('button');
    only.type = 'button';
    only.className = 'tp-nav-only';
    only.textContent = `⚠ Only errors and warnings (${warned})`;
    only.title = 'Show only the sections with errors or warnings';
    only.hidden = !warned;
    only.addEventListener('click', () => {
        state.warned = !state.warned;
        filter();
    });
    side.append(search, only, counter, list);
    const main = document.createElement('div');
    main.className = 'tp-md tp-nav-main';
    nav.append(side, main);

    // List: groups and items (hidden by the search)
    const items = sections.map((s, i) => {
        const item = document.createElement('div');
        item.className = 'tp-nav-item';
        item.setAttribute('role', 'option');
        const title = document.createElement('div');
        title.textContent = s.title;
        if (s.errors + s.warnings) {
            const mark = document.createElement('span');
            mark.className = `tp-nav-warn${s.errors ? ' tp-nav-error' : ''}`;
            mark.textContent = `⚠ ${s.errors + s.warnings}`;
            title.append(' ', mark);
        }
        item.append(title);
        if (s.errors || s.warnings || s.notes) {
            item.dataset.mark = s.errors ? 'error' : s.warnings ? 'warning' : 'info'; // highest level
            const n = (k: number, one: string, many: string) => (k ? [`${k} ${k === 1 ? one : many}`] : []);
            const all = [
                ...n(s.errors, 'error', 'errors'),
                ...n(s.warnings, 'warning', 'warnings'),
                ...n(s.notes, 'note', 'notes'),
            ];
            item.title = all.join(', ');
        }
        if (s.hint) {
            const hint = document.createElement('div');
            hint.className = 'tp-nav-hint';
            hint.textContent = s.hint;
            item.append(hint);
        }
        item.addEventListener('click', () => show(i));
        return item;
    });
    const groups = new Map<string, HTMLElement>();
    sections.forEach((s, i) => {
        if (s.group && !groups.has(s.group)) {
            const head = document.createElement('div');
            head.className = 'tp-nav-group';
            head.textContent = s.group;
            groups.set(s.group, head);
            list.append(head);
        }
        list.append(items[i]);
    });

    const visible = (): number[] => sections.flatMap((_, i) => (items[i].hidden ? [] : [i]));

    const filter = () => {
        state.query = search.value;
        const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
        only.classList.toggle('tp-nav-only-on', state.warned);
        only.setAttribute('aria-pressed', String(state.warned));
        sections.forEach((s, i) => {
            items[i].hidden = !words.every((w) => s.text.includes(w)) || (state.warned && !(s.errors + s.warnings));
        });
        for (const [group, head] of groups)
            head.hidden = sections.every((s, i) => s.group !== group || items[i].hidden);
        const shown = visible();
        const filtered = words.length || state.warned;
        counter.textContent = filtered ? `${shown.length} of ${sections.length}` : `${sections.length} sections`;
        if (shown.length && !shown.includes(state.index)) show(shown[0]);
    };

    const show = (i: number) => {
        state.index = Math.max(0, Math.min(i, sections.length - 1));
        items.forEach((item, k) => {
            item.classList.toggle('tp-nav-current', k === state.index);
            item.setAttribute('aria-selected', String(k === state.index));
        });
        items[state.index]?.scrollIntoView({ block: 'nearest' });
        const s = sections[state.index];
        main.replaceChildren(...(s ? s.nodes : []), pager());
        main.scrollTop = 0;
        stops.push(drawDiagrams(main));
    };

    // Previous / next (of those found)
    const pager = (): HTMLElement => {
        const bar = document.createElement('div');
        bar.className = 'tp-nav-pager';
        const shown = visible();
        const at = shown.indexOf(state.index);
        const link = (to: number | undefined, label: string) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tp-nav-step';
            b.disabled = to === undefined;
            b.textContent = to === undefined ? label : `${label} ${sections[to].title}`;
            if (to !== undefined) b.addEventListener('click', () => show(to));
            return b;
        };
        bar.append(link(at > 0 ? shown[at - 1] : undefined, '‹'), link(at >= 0 ? shown[at + 1] : undefined, '›'));
        return bar;
    };

    const step = (e: KeyboardEvent) => {
        const shown = visible();
        const at = shown.indexOf(state.index);
        const to = { ArrowDown: shown[at + 1], ArrowUp: shown[at - 1], Home: shown[0], End: shown[shown.length - 1] }[
            e.key
        ];
        if (!(e.key in { ArrowDown: 1, ArrowUp: 1, Home: 1, End: 1 })) return false;
        if (e.target === search && (e.key === 'Home' || e.key === 'End')) return false; // within the text
        e.preventDefault();
        if (to !== undefined) show(to);
        return true;
    };
    search.addEventListener('input', filter);
    search.addEventListener('keydown', (e) => {
        if (step(e)) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            list.focus();
        } else if (e.key === 'Escape' && search.value) {
            e.stopPropagation(); // clears the search, does not close the viewer
            search.value = '';
            filter();
        }
    });
    list.addEventListener('keydown', (e) => {
        if (step(e)) return;
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) search.focus(); // typing searches
    });
    // Links to headings: their section
    main.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest('a[href^="#"]');
        if (!a) return;
        e.preventDefault();
        const name = decodeURIComponent((a.getAttribute('href') || '').slice(1)).toLowerCase();
        const i = sections.findIndex((s) =>
            s.nodes.some((n) => n instanceof HTMLElement && n.matches(`[data-anchor="${CSS.escape(name)}"]`)),
        );
        if (i >= 0) show(i);
    });

    content.replaceChildren(nav);
    filter();
    show(state.index);
    return {
        stop: () => {
            for (const stop of stops) stop();
        },
        show: () => {},
    };
}

// Sections of a document: text before any heading ("Overview"), then one per level 2 heading;
// text under a level 1 heading before its first level 2 heading: a section named after the group
function splitSections(doc: HTMLElement): Section[] {
    const out: Section[] = [];
    let group = '';
    let current: Section | null = null;
    const open = (title: string, heading: Node | null) => {
        current = {
            title,
            group,
            hint: '',
            nodes: heading ? [heading] : [],
            text: '',
            errors: 0,
            warnings: 0,
            notes: 0,
        };
        out.push(current);
    };
    for (const node of [...doc.childNodes]) {
        const tag = node instanceof HTMLElement ? node.tagName : '';
        if (tag === 'H1') {
            group = node.textContent || '';
            current = null;
        } else if (tag === 'H2') {
            open(node.textContent || '', node);
        } else {
            if (!current) {
                if (!node.textContent?.trim()) continue;
                open(group || 'Overview', null);
            }
            const s = current as unknown as Section;
            s.nodes.push(node);
            if (!s.hint && node instanceof HTMLParagraphElement) {
                const line = (node.textContent || '').trim();
                s.hint = line.length <= MAX_HINT ? line : '';
            }
        }
    }
    // points in the alerts of a kind (list items, else 1 per alert); the text before the first section: none
    const points = (s: Section, kinds: string) =>
        s.nodes[0] instanceof HTMLHeadingElement
            ? s.nodes.reduce((n, node) => {
                  if (!(node instanceof HTMLElement) || !node.matches(kinds)) return n;
                  return n + Math.max(1, node.querySelectorAll(':scope > ul > li, :scope > ol > li').length);
              }, 0)
            : 0;
    for (const s of out) {
        s.errors = points(s, '.tp-md-caution');
        s.warnings = points(s, '.tp-md-warning');
        s.notes = points(s, '.tp-md-note, .tp-md-tip, .tp-md-important');
    }
    for (const s of out)
        s.text = `${s.group}\n${s.title}\n${s.nodes.map((n) => n.textContent || '').join('\n')}`.toLowerCase();
    return out;
}
