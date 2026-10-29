// Bar on top of the viewer and of the Zen list, one structure for both:
// [start: toggle, tools] [well: what is shown] [end: info, ⋯, extras, ✕];
// narrow: the well on a second row (full width); narrower still: the info left out

// ===========================================================================
// CONSTANTS
// ===========================================================================

const MIN_WELL = 200; // px left for the well beside the rest, else on a row of its own
const BAR_PAD = 2 * 8; // px: padding of the bar, left and right (cf. `.tp-bar`)
const BAR_GAP = 4; // px between its parts (cf. `.tp-bar`)

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Buttons and menus
// ---------------------------------------------------------------------------

/** @returns square button of a bar (icon, tooltip) */
export function barButton(svg: string, title: string, cls = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tp-mode-btn tp-bar-btn ${cls}`.trim();
    b.innerHTML = svg;
    b.title = title;
    return b;
}

/** @returns close button (red ✕, right end) */
export function closeButton(title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tp-bar-btn tp-bar-close';
    b.textContent = '✕';
    b.title = title;
    return b;
}

/**
 * Menu (shown) below its button, both in the same positioned box: its left edge under the button's,
 * or (`right`) its right edge; kept inside the box
 */
export function placeBelow(menu: HTMLElement, anchor: HTMLElement, right = false): void {
    const width = (anchor.offsetParent as HTMLElement | null)?.clientWidth ?? 0;
    const left = right ? anchor.offsetLeft + anchor.offsetWidth - menu.offsetWidth : anchor.offsetLeft;
    menu.style.top = `${anchor.offsetTop + anchor.offsetHeight + 4}px`;
    menu.style.left = `${Math.max(0, Math.min(left, width - menu.offsetWidth))}px`;
    menu.style.right = '';
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

/**
 * @param parts start (toggle, tools), well, end (info: class `tp-bar-info`; then ⋯, extras, ✕)
 * @param fitted called once the well moved to its own row or back
 * @returns the bar, and a stop for watching its width
 */
export function createBar(
    parts: { start: HTMLElement[]; well: HTMLElement; end: HTMLElement[] },
    fitted?: () => void,
): { bar: HTMLDivElement; stop: () => void } {
    const group = (cls: string, items: HTMLElement[]) => {
        const g = document.createElement('div');
        g.className = cls;
        g.append(...items);
        return g;
    };
    const start = group('tp-bar-start', parts.start);
    const end = group('tp-bar-end', parts.end);
    const bar = group('tp-bar', [start, parts.well, end]) as HTMLDivElement;
    const fit = () => {
        const w = bar.clientWidth;
        if (!w) return; // not shown yet
        bar.classList.remove('tp-bar-tight'); // info measured as well
        const rest = BAR_PAD + start.offsetWidth + end.offsetWidth + 2 * BAR_GAP;
        const narrow = w - rest < MIN_WELL;
        bar.classList.toggle('tp-bar-tight', rest > w);
        if (narrow === bar.classList.contains('tp-bar-narrow')) return;
        bar.classList.toggle('tp-bar-narrow', narrow);
        fitted?.();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(bar);
    return { bar, stop: () => observer.disconnect() };
}
