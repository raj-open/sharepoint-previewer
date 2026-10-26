// Page layout: viewer beside or below the list, size, drag

// ===========================================================================
// IMPORTS
// ===========================================================================

import { loadPref } from '../_core/prefs.ts';
import { savePref } from '../_core/prefs.ts';
import { view } from '../_core/prefs.ts';
import { POPUP_POS_KEY } from '../_core/settings-form.ts';
import { POPUP_SIZE_KEY } from '../_core/settings-form.ts';
import { DEFAULT_PREVIEW_SIZE } from '../_core/settings.ts';
import { SPLIT_GAP } from '../_core/settings.ts';
import { POPUP_SVG } from '../ui/icons.ts';
import { SPLIT_H_SVG } from '../ui/icons.ts';
import { SPLIT_V_SVG } from '../ui/icons.ts';
import { placeMoved } from '../ui/move.ts';
import { placeSized } from '../ui/move.ts';
import { viewer } from './open.ts';

import type { Layout } from '../_core/types.ts';
import type { Viewer } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Card look, like Sharepoint's own list card: grey border, round corners, soft shadow
const CARD_CSS = `
  border: 1px solid var(--tp-edge);
  border-radius: 8px;
`;

const BOX_CSS = {
    popup: `
    position: fixed;
    left: 10vw;
    top: 10vh;
    width: 80vw;
    height: 80vh;
    min-width: 360px;
    min-height: 240px;
    max-width: 100vw;
    max-height: 100vh;
    resize: both; /* corner bottom right; size kept (cf. keepSize) */
    ${CARD_CSS}
    box-shadow: 0 8px 32px rgba(0,0,0,.35);
  `,
    vertical: `
    position: fixed;
    left: 50vw;
    right: 0;
    top: 0;
    bottom: 0;
    ${CARD_CSS}
    box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.11);
  `,
    horizontal: `
    position: fixed;
    left: 0;
    right: 0;
    top: 50vh;
    bottom: 0;
    ${CARD_CSS}
    box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.11);
  `,
};

// ===========================================================================
// METHODS
// ===========================================================================

const restoreStyle = (el: HTMLElement, original?: string | null): void => {
    if (original == null) el.removeAttribute('style');
    else el.setAttribute('style', original);
};

// List's card: scroll area plus its frame and scrollbars, no command bar
/** @returns card around the list, and the element that scrolls it */
export function listRegion(): { card: HTMLElement; scroller: HTMLElement } | null {
    const grid = document.querySelector('[role="grid"], [role="treegrid"]');
    let scroller = grid;
    for (let el = grid; el && el !== document.body; el = el.parentElement) {
        const { overflowY } = getComputedStyle(el);
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.clientHeight > 100) {
            scroller = el;
            break;
        }
    }
    if (!scroller) return null;

    // Go up while parent only adds thin frame
    const SLACK = 24;
    const s = scroller.getBoundingClientRect();
    let card = scroller;
    for (let el = scroller.parentElement; el && el !== document.body; el = el.parentElement) {
        const r = el.getBoundingClientRect();
        const thin =
            r.top >= s.top - SLACK &&
            r.left >= s.left - SLACK &&
            r.right <= s.right + SLACK &&
            r.bottom <= s.bottom + SLACK;
        if (!thin) break;
        card = el;
    }
    return { card, scroller };
}

// Visible right / bottom edge of list, incl. scrollbars drawn just outside it
function listEdges(card: HTMLElement, scroller: HTMLElement): { right: number; bottom: number } {
    const c = scroller.getBoundingClientRect();
    const REACH = 30;
    let right = c.right;
    let bottom = c.bottom;
    const root = card.parentElement || card;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (n) => (n === scroller ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const n = node as HTMLElement; // elements only (SHOW_ELEMENT)
        if (n.contains(scroller) || n.closest('.tp-cell, .tp-head')) continue; // frames around list don't count
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const besideRight = r.top < c.bottom && r.bottom > c.top && r.left < c.right && r.right > c.right;
        const besideBelow = r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.bottom;
        if (besideRight && r.right <= c.right + REACH) right = Math.max(right, r.right);
        if (besideBelow && r.bottom <= c.bottom + REACH) bottom = Math.max(bottom, r.bottom);
    }
    return { right, bottom };
}

export function restorePage(v: Viewer): void {
    v.regionObserver?.disconnect();
    v.regionObserver = null;
    v.containerObserver?.disconnect();
    v.containerObserver = null;
    restoreStyle(document.body, v.originalBodyStyle);
    if (v.region) {
        restoreStyle(v.region, v.regionStyle);
        v.region = null;
    }
    if (v.dock) {
        restoreStyle(v.dock, v.dockStyle);
        v.dock = null;
    }
    if (v.anchor) {
        v.anchor = null;
        document.documentElement.append(v.box); // back out of Sharepoint's container
    }
    if (v.anchorParent) {
        restoreStyle(v.anchorParent, v.anchorParentStyle);
        v.anchorParent = null;
    }
}

// List share of space (splitter); remembered, setting is start value
const splitFraction = (() => {
    const start: Record<string, number> = { vertical: 1 - DEFAULT_PREVIEW_SIZE, horizontal: 1 - DEFAULT_PREVIEW_SIZE };
    try {
        const kept = JSON.parse(loadPref('tp-preview-split', 'null'));
        for (const m of ['vertical', 'horizontal']) if (kept?.[m] >= 0.1 && kept[m] <= 0.9) start[m] = kept[m];
    } catch {}
    return start;
})();

// Element that really scrolls list vertically (prefers one that overflows)
function verticalScroller(grid: Element): HTMLElement | null {
    let bounded = null;
    for (let el = grid.parentElement; el && el !== document.body; el = el.parentElement) {
        const { overflowY } = getComputedStyle(el);
        if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
        if (el.clientHeight < 100 || el.getBoundingClientRect().height > window.innerHeight + 1) continue;
        if (el.scrollHeight > el.clientHeight + 1) return el;
        bounded = bounded || el;
    }
    return bounded;
}

// Sharepoint's wrapper around file list: <div role="" style="display: contents;">
function listWrapper(grid: Element): HTMLElement | null {
    for (let el = grid.parentElement; el && el !== document.body; el = el.parentElement) {
        if (el.getAttribute('role') === '' && el.style.display === 'contents') return el;
    }
    return null;
}

// Space for horizontal split: scroller's visible area before it was shrunk (d: its bounds then)
function dockArea(d: DOMRect): { top: number; bottom: number; left: number; right: number } {
    return {
        top: Math.max(0, d.top),
        bottom: Math.min(window.innerHeight, d.bottom),
        left: d.left,
        right: d.right,
    };
}

const px = (n: number): string => `${Math.max(0, Math.round(n))}px`;

// Keep split panel next to (vertical) or below (horizontal) shrunk list
export function syncPanel(): void {
    const v = viewer;
    if (!v || v.mode === 'popup') return;
    const s = v.box.style;
    const { anchor, anchorParent: p, region, scroller, base, dock, dockBase, grid } = v;

    if (v.mode === 'horizontal' && anchor && p && region && scroller && v.anchorSpace !== undefined) {
        // In page after list wrapper, below shortened list
        if (v.box.previousElementSibling !== anchor) anchor.after(v.box);
        const sr = scroller.getBoundingClientRect();
        const edge = listEdges(region, scroller);
        const pr = p.getBoundingClientRect();
        s.left = `${Math.round(sr.left - pr.left - p.clientLeft + p.scrollLeft)}px`;
        s.top = `${Math.round(edge.bottom + SPLIT_GAP - pr.top - p.clientTop + p.scrollTop)}px`;
        s.width = px(edge.right - sr.left);
        s.height = px(v.anchorSpace * (1 - splitFraction.horizontal) - 2 * SPLIT_GAP);
        return;
    }

    if (v.mode === 'horizontal' && dock && dockBase && grid) {
        // Fill space below shrunk scroller
        const area = dockArea(dockBase);
        const d = dock.getBoundingClientRect();
        const g = grid.getBoundingClientRect();
        const edge = listEdges(dock, dock);
        s.left = px(Math.max(g.left, d.left));
        s.right = px(window.innerWidth - Math.min(g.right, edge.right, d.right));
        s.top = px(d.bottom + SPLIT_GAP);
        s.bottom = px(window.innerHeight - area.bottom + SPLIT_GAP);
        return;
    }

    if (v.mode === 'vertical' && region && scroller && base) {
        // Align with visible list (scroll area + its scrollbars), not card frame around it
        const sr = scroller.getBoundingClientRect();
        const edge = listEdges(region, scroller);

        if (anchor && p) {
            // In page after list wrapper: moves with list
            if (v.box.previousElementSibling !== anchor) anchor.after(v.box);
            const pr = p.getBoundingClientRect();
            s.left = `${Math.round(edge.right + SPLIT_GAP - pr.left - p.clientLeft + p.scrollLeft)}px`;
            s.top = `${Math.round(sr.top - pr.top - p.clientTop + p.scrollTop)}px`;
            s.width = px(base.right - edge.right - SPLIT_GAP);
            s.height = px(edge.bottom - sr.top);
            return;
        }

        s.left = px(edge.right + SPLIT_GAP);
        s.right = px(window.innerWidth - base.right);
        s.top = px(sr.top);
        s.bottom = px(window.innerHeight - edge.bottom);
        return;
    }

    // Fallback (list not found): whole page was shrunk
    const f = splitFraction[v.mode];
    s.left = v.mode === 'vertical' ? `calc(${f * 100}vw + ${SPLIT_GAP}px)` : `${SPLIT_GAP}px`;
    s.top = v.mode === 'horizontal' ? `calc(${f * 100}vh + ${SPLIT_GAP}px)` : `${SPLIT_GAP}px`;
    s.right = `${SPLIT_GAP}px`;
    s.bottom = `${SPLIT_GAP}px`;
}

function applySplit(v: Viewer): void {
    const f = splitFraction[v.mode];
    const vertical = v.mode === 'vertical';
    const { region, base, anchorSpace, dock, dockBase } = v;
    if (vertical && region && base) {
        const size = `${Math.round(base.width * f)}px`;
        const st = region.style;
        st.width = size;
        st.maxWidth = size;
        st.minWidth = '0';
        st.flex = 'none';
    } else if (v.mode === 'horizontal' && v.anchor && region && anchorSpace !== undefined) {
        // List (card) gets shorter; panel goes into freed space below it
        const height = `${Math.round(anchorSpace * f)}px`;
        const st = region.style;
        st.height = height;
        st.maxHeight = height;
        st.minHeight = '0';
        st.flex = 'none';
    } else if (v.mode === 'horizontal' && dock && dockBase) {
        const area = dockArea(dockBase);
        const height = `${Math.round((area.bottom - area.top) * f)}px`;
        const st = dock.style;
        st.height = height;
        st.maxHeight = height;
        st.minHeight = '0';
        st.flex = 'none';
    } else {
        // Fallback (no list): shrink whole page (transform: <body> holds fixed parts)
        const st = document.body.style;
        st.position = 'fixed';
        st.left = '0';
        st.top = '0';
        st.width = vertical ? `${f * 100}vw` : '100vw';
        st.height = vertical ? '100vh' : `${f * 100}vh`;
        st.overflow = 'hidden';
        st.transform = 'translateZ(0)';
    }
    syncPanel();
}

// Let Sharepoint re-measure its lists (ignored by our own resize handler)
function notifyResize(v: Viewer): void {
    v.selfResize = true;
    window.dispatchEvent(new Event('resize'));
    v.selfResize = false;
    // List can also move (not just resize) while Sharepoint re-flows
    requestAnimationFrame(syncPanel);
    setTimeout(syncPanel, 300);
}

// Make room for split panel (top bar, command bar, navigation untouched)
export function layoutPage(v: Viewer, mode: Layout): void {
    restorePage(v);

    if (mode !== 'popup') {
        const list = listRegion();
        const region = list?.card ?? null;
        const scroller = list?.scroller ?? null;
        v.grid = document.querySelector('[role="grid"], [role="treegrid"]');

        if (mode === 'vertical' && region) {
            v.region = region;
            v.regionStyle = region.getAttribute('style');
            v.base = region.getBoundingClientRect(); // natural size, before it gets smaller
            v.scroller = scroller;
            v.regionObserver = new ResizeObserver(syncPanel);
            v.regionObserver.observe(region);

            // Preferred: after list wrapper (<div role="" style="display: contents;">)
            const anchor = v.grid && listWrapper(v.grid);
            if (anchor) {
                const parent = anchor.parentElement as HTMLElement; // wrapper inside the page
                v.anchor = anchor;
                v.anchorParent = parent;
                v.anchorParentStyle = parent.getAttribute('style');
                if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
                const st = v.box.style;
                st.position = 'absolute';
                st.right = st.bottom = '';
                st.margin = '0';
                anchor.after(v.box);
            }
        } else if (mode === 'horizontal' && v.grid) {
            // Preferred: after list wrapper; its container sizes list
            const anchor = region && listWrapper(v.grid);
            const dock = anchor ? null : verticalScroller(v.grid);
            if (anchor) {
                v.region = region;
                v.regionStyle = region.getAttribute('style');
                v.base = region.getBoundingClientRect(); // natural size, before it gets shorter
                v.scroller = scroller;
                // Space to share: list's visible height (list may be taller than window)
                v.anchorSpace = Math.min(v.base.height, window.innerHeight - Math.max(0, v.base.top));
                v.regionObserver = new ResizeObserver(syncPanel);
                v.regionObserver.observe(region);

                const parent = anchor.parentElement as HTMLElement; // wrapper inside the page
                v.anchor = anchor;
                v.anchorParent = parent;
                v.anchorParentStyle = parent.getAttribute('style');
                if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
                const st = v.box.style;
                st.position = 'absolute';
                st.right = st.bottom = '';
                st.margin = '0';
                anchor.after(v.box);
            } else if (dock) {
                v.dock = dock;
                v.dockStyle = dock.getAttribute('style');
                v.dockBase = dock.getBoundingClientRect(); // before it gets smaller
                v.regionObserver = new ResizeObserver(syncPanel);
                v.regionObserver.observe(dock);
            }
        }
        applySplit(v);
        watchContainer(v);
    }
    notifyResize(v);
}

// Sharepoint's side panels change width without window resize: lay out anew
function watchContainer(v: Viewer): void {
    const el = v.anchorParent || v.region?.parentElement || v.dock?.parentElement;
    if (!el) return;
    let width = Math.round(el.getBoundingClientRect().width);
    let queued = false;
    v.containerObserver = new ResizeObserver(() => {
        const now = Math.round(el.getBoundingClientRect().width);
        if (Math.abs(now - width) < 2 || queued) return; // only width: heights change with split itself
        width = now;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            if (viewer === v && v.mode !== 'popup') layoutPage(v, v.mode);
        });
    });
    v.containerObserver.observe(el);
}

// Splitter drag (left edge in vertical mode, top edge in horizontal mode)
export function startDrag(e: PointerEvent): void {
    const v = viewer;
    if (!v || v.mode === 'popup') return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement; // the splitter
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('tp-drag');
    const vertical = v.mode === 'vertical';

    let queued = false;

    const onMove = (ev: PointerEvent) => {
        let f: number;
        const { region, base, anchorSpace, dockBase } = v;
        if (vertical && region && base) {
            f = (ev.clientX - region.getBoundingClientRect().left) / base.width;
        } else if (!vertical && v.anchor && region && anchorSpace !== undefined) {
            f = (ev.clientY - region.getBoundingClientRect().top) / anchorSpace;
        } else if (!vertical && v.dock && dockBase) {
            const area = dockArea(dockBase);
            f = (ev.clientY - area.top) / (area.bottom - area.top);
        } else {
            f = vertical ? ev.clientX / window.innerWidth : ev.clientY / window.innerHeight;
        }
        splitFraction[v.mode] = Math.min(0.9, Math.max(0.1, f));
        savePref('tp-preview-split', JSON.stringify(splitFraction));
        if (!queued) {
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                if (viewer === v) applySplit(v);
            });
        }
    };

    const onUp = () => {
        handle.classList.remove('tp-drag');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        if (viewer === v) notifyResize(v);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
}

export function setMode(mode: Layout): void {
    const v = viewer;
    if (!v) return;
    v.mode = mode;
    view.mode = mode;
    savePref('tp-preview-mode', mode);

    v.box.style.cssText = `
    ${BOX_CSS[mode]}
    z-index: ${mode === 'popup' ? 2147483001 : 10}; /* popup: above Sharepoint's panels; split: just above the page, below Sharepoint menus */
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  `;
    v.backdrop.style.display = mode === 'popup' ? 'block' : 'none';
    v.header.style.cursor = mode === 'popup' ? 'move' : ''; // popup: drag header to move it
    if (mode === 'popup') {
        placeSized(v.box, POPUP_SIZE_KEY); // before the position: it keeps the window on screen
        placeMoved(v.box, POPUP_POS_KEY);
    }
    v.splitter.className = `tp-splitter tp-splitter-${mode}`;
    v.backdrop.classList.toggle('tp-overlay', mode === 'popup');

    v.layoutBtn.innerHTML = { horizontal: SPLIT_H_SVG, vertical: SPLIT_V_SVG, popup: POPUP_SVG }[mode];
    for (const [btn, m] of [
        [v.hBtn, 'horizontal'],
        [v.vBtn, 'vertical'],
        [v.pBtn, 'popup'],
    ] as const) {
        const active = mode === m;
        btn.setAttribute('aria-pressed', String(active));
    }

    layoutPage(v, mode);
}
