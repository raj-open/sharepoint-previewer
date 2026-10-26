// Movable windows (settings, popup): position kept in localStorage, inside screen

// ===========================================================================
// IMPORTS
// ===========================================================================

import { loadPref } from '../_core/prefs.ts';
import { savePref } from '../_core/prefs.ts';

// ===========================================================================
// METHODS
// ===========================================================================

function loadOffset(key: string): { x: number; y: number } {
    try {
        const o = JSON.parse(loadPref(key, 'null'));
        if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return o;
    } catch {}
    return { x: 0, y: 0 };
}

// Offset clamped so top edge and 80 px of window stay on screen
function clampOffset(o: { x: number; y: number }, base: DOMRect): { x: number; y: number } {
    return {
        x: Math.round(Math.min(innerWidth - 80 - base.left, Math.max(80 - base.left - base.width, o.x))),
        y: Math.round(Math.min(innerHeight - 40 - base.top, Math.max(-base.top, o.y))),
    };
}

// Apply remembered offset to `target` (CSS translate)
export function placeMoved(target: HTMLElement, key: string): void {
    target.style.translate = '0 0';
    if (!target.isConnected) return void requestAnimationFrame(() => target.isConnected && placeMoved(target, key));
    const base = target.getBoundingClientRect();
    const o = clampOffset(loadOffset(key), base);
    target.style.translate = `${o.x}px ${o.y}px`;
}

// Drag `target` from pointerdown on its handle
export function startMove(e: PointerEvent, target: HTMLElement, key: string): void {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement; // the element the listener is on
    handle.setPointerCapture(e.pointerId);
    const now = target.getBoundingClientRect();
    const o = loadOffset(key);
    // current offset ("10px 20px"; browser shortens "10px 0px" to "10px")
    const [tx = 0, ty = 0] = (target.style.translate || '').split(' ').map((v) => parseFloat(v) || 0);
    const base = new DOMRect(now.left - tx, now.top - ty, now.width, now.height);
    const start = { x: e.clientX - tx, y: e.clientY - ty };
    let last = { x: tx, y: ty };
    const move = (ev: PointerEvent) => {
        last = clampOffset({ x: ev.clientX - start.x, y: ev.clientY - start.y }, base);
        target.style.translate = `${last.x}px ${last.y}px`;
    };
    const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (last.x !== o.x || last.y !== o.y) savePref(key, JSON.stringify(last));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
}
