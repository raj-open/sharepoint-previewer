// Order of items changed by dragging them with the pointer (Zen list: column titles, columns menu);
// no HTML drag and drop: Sharepoint takes those events for its uploads (drop zone over the list)

// ===========================================================================
// TYPES
// ===========================================================================

export type Reorder = {
    /** items (selector), each with `data-col` */
    item: string;
    /** along which axis the items lie */
    axis: 'x' | 'y';
    /** no drag starting here (selector), e.g. filter buttons, resize handles */
    skip?: string;
    /** @returns whether an item can be moved or dropped onto */
    movable?: (col: string) => boolean;
    /** dropped: `col` before (or after) `target` */
    drop: (col: string, target: string, after: boolean) => void;
};

// ===========================================================================
// CONSTANTS
// ===========================================================================

const DRAG_START = 5; // px moved before it is a drag (else a click)

// ===========================================================================
// METHODS
// ===========================================================================

/** Lets the items of `root` be moved by dragging (marks: .tp-moving on the item, .tp-drop-before / -after on the target) */
export function wireReorder(root: HTMLElement, opts: Reorder): void {
    const movable = opts.movable ?? (() => true);
    const colOf = (el: Element) => (el as HTMLElement).dataset.col ?? '';
    root.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const t = e.target as HTMLElement;
        const el = t.closest?.(opts.item) as HTMLElement | null;
        if (!el || !root.contains(el) || !movable(colOf(el))) return;
        if (opts.skip && t.closest(opts.skip)) return;
        const x0 = e.clientX;
        const y0 = e.clientY;
        let dragging = false;
        let ghost: HTMLElement | null = null;
        let target: { el: HTMLElement; after: boolean } | null = null;
        const unmark = () => {
            for (const m of root.querySelectorAll('.tp-drop-before, .tp-drop-after'))
                m.classList.remove('tp-drop-before', 'tp-drop-after');
        };
        const move = (ev: PointerEvent) => {
            if (!dragging) {
                if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START) return;
                dragging = true;
                ghost = liftCopy(el);
                el.classList.add('tp-moving');
                root.classList.add('tp-reordering');
            }
            ev.preventDefault();
            // the copy follows the pointer along the axis (titles slide along the header, entries up and down)
            if (ghost && opts.axis === 'x') ghost.style.transform = `translateX(${ev.clientX - x0}px)`;
            else if (ghost) ghost.style.transform = `translateY(${ev.clientY - y0}px)`;
            const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(opts.item) as HTMLElement | null;
            unmark();
            target = null;
            if (!under || under === el || !root.contains(under) || !movable(colOf(under))) return;
            const r = under.getBoundingClientRect();
            const after = opts.axis === 'x' ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
            under.classList.add(after ? 'tp-drop-after' : 'tp-drop-before');
            target = { el: under, after };
        };
        const end = (ev: Event) => {
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', end, true);
            window.removeEventListener('pointercancel', end, true);
            if (!dragging) return;
            ghost?.remove();
            unmark();
            el.classList.remove('tp-moving');
            root.classList.remove('tp-reordering');
            // the click after a drag is no click (no sort, no checkbox)
            const swallow = (c: Event) => {
                c.stopPropagation();
                c.preventDefault();
            };
            window.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', swallow, true), 0);
            if (ev.type === 'pointerup' && target) opts.drop(colOf(el), colOf(target.el), target.after);
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
