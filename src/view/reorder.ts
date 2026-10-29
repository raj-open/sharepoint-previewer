// Order of items changed by dragging them with the pointer (Zen list: column titles, columns pane;
// viewer's table in write mode: column titles, row numbers); no HTML drag and drop: Sharepoint takes those events
// for its uploads (drop zone over the list). While dragging: a copy of the item lifted under the pointer, the target
// shaded and a bar where the item will go (left / right of a column, above / below a row), across all of it

// ===========================================================================
// TYPES
// ===========================================================================

export type Reorder = {
    /** items (selector) */
    item: string;
    /** along which axis the items lie */
    axis: 'x' | 'y';
    /** @returns key of an item (default: its `data-col`) */
    key?: (el: HTMLElement) => string;
    /** no drag starting here (selector), e.g. filter buttons, resize handles */
    skip?: string;
    /** @returns whether an item can be moved or dropped onto */
    movable?: (key: string) => boolean;
    /** room the bar spans across (default: the root; both: only as far as seen) */
    span?: HTMLElement;
    /** dropped: `key` before (or after) `target` */
    drop: (key: string, target: string, after: boolean) => void;
};

// ===========================================================================
// CONSTANTS
// ===========================================================================

const DRAG_START = 5; // px moved before it is a drag (else a click)
const BAR = 3; // px: thickness of the bar where the item will go
const LIFT = 12; // px: the lifted copy off its axis (below a title, right of an entry)

// ===========================================================================
// METHODS
// ===========================================================================

/** Lets the items of `root` be moved by dragging (marks: .tp-moving on the item, .tp-drop-target on the target) */
export function wireReorder(root: HTMLElement, opts: Reorder): void {
    const movable = opts.movable ?? (() => true);
    const keyOf = opts.key ?? ((el: HTMLElement) => el.dataset.col ?? '');
    root.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const t = e.target as HTMLElement;
        const el = t.closest?.(opts.item) as HTMLElement | null;
        if (!el || !root.contains(el) || !movable(keyOf(el))) return;
        if (opts.skip && t.closest(opts.skip)) return;
        const x0 = e.clientX;
        const y0 = e.clientY;
        let dragging = false;
        let ghost: HTMLElement | null = null;
        let bar: HTMLElement | null = null;
        let target: { el: HTMLElement; after: boolean } | null = null;
        const unmark = () => {
            target?.el.classList.remove('tp-drop-target');
            if (bar) bar.hidden = true;
            target = null;
        };
        const move = (ev: PointerEvent) => {
            if (!dragging) {
                if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START) return;
                dragging = true;
                ghost = liftCopy(el);
                bar = document.createElement('div');
                bar.className = 'tp-drop-bar';
                document.documentElement.append(bar);
                el.classList.add('tp-moving');
                root.classList.add('tp-reordering');
            }
            ev.preventDefault();
            // the copy follows the pointer along the axis (titles slide along the header, entries up and down),
            // a little off it, so the target stays seen
            if (ghost && opts.axis === 'x') ghost.style.transform = `translate(${ev.clientX - x0}px, ${LIFT}px)`;
            else if (ghost) ghost.style.transform = `translate(${LIFT}px, ${ev.clientY - y0}px)`;
            const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(opts.item) as HTMLElement | null;
            unmark();
            if (!under || under === el || !root.contains(under) || !movable(keyOf(under))) return;
            const r = under.getBoundingClientRect();
            const after = opts.axis === 'x' ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
            under.classList.add('tp-drop-target');
            target = { el: under, after };
            if (bar) placeBar(bar, r, after, opts.axis, opts.span ?? root);
        };
        const end = (ev: Event) => {
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', end, true);
            window.removeEventListener('pointercancel', end, true);
            if (!dragging) return;
            const dropped = target;
            unmark();
            ghost?.remove();
            bar?.remove();
            el.classList.remove('tp-moving');
            root.classList.remove('tp-reordering');
            // the click after a drag is no click (no sort, no checkbox)
            const swallow = (c: Event) => {
                c.stopPropagation();
                c.preventDefault();
            };
            window.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', swallow, true), 0);
            if (ev.type === 'pointerup' && dropped) opts.drop(keyOf(el), keyOf(dropped.el), dropped.after);
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Bar where the item will go: at the target's edge (before: left / top; after: right / bottom),
// across the room seen of `span` (a column: the whole height of the list; a row or entry: the whole width)
function placeBar(bar: HTMLElement, r: DOMRect, after: boolean, axis: 'x' | 'y', span: HTMLElement): void {
    const s = span.getBoundingClientRect();
    const top = Math.max(0, s.top);
    const left = Math.max(0, s.left);
    const bottom = Math.min(window.innerHeight, s.bottom);
    const right = Math.min(window.innerWidth, s.right);
    const at = (axis === 'x' ? (after ? r.right : r.left) : after ? r.bottom : r.top) - BAR / 2;
    Object.assign(bar.style, {
        left: `${axis === 'x' ? at : left}px`,
        top: `${axis === 'x' ? top : at}px`,
        width: `${axis === 'x' ? BAR : right - left}px`,
        height: `${axis === 'x' ? bottom - top : BAR}px`,
    });
    bar.hidden = false;
}

// Copy of the item, lifted where it is (its size, font, colours), moved with the pointer while dragged;
// the pointer goes through it (the target below is still found)
function liftCopy(el: HTMLElement): HTMLElement {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const plain = cs.backgroundImage === 'none' && cs.backgroundColor === 'rgba(0, 0, 0, 0)';
    const behind = el.closest('.tp-zen, .tp-viewer') ?? document.body;
    const g = document.createElement('div');
    g.className = 'tp-lifted';
    g.textContent = el.textContent?.trim() ?? '';
    Object.assign(g.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        padding: cs.padding,
        font: cs.font,
        color: cs.color,
        background: plain ? getComputedStyle(behind).backgroundColor : cs.background,
    });
    document.documentElement.append(g);
    return g;
}
