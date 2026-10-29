// Zen mode: files dragged in from outside go through the Zen list to Sharepoint's list beneath (Sharepoint uploads them)

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Drags from outside the page fire no dragend: ended once no dragover came for this long (left the window, Esc)
const DRAG_IDLE = 300; // ms
const DROP_SETTLE = 1000; // ms of quiet in Sharepoint's list (rows of the uploads in) before the folder is read anew
const DROP_WATCH = 120000; // ms: Sharepoint's list watched after a drop, until quiet for this long (uploads under way)
// Own marks in Sharepoint's list (eyes): not changes of Sharepoint's
const MARKS = '.tp-cell, .tp-head';

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns the drag carries files (from outside the page) */
export const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types?.includes('Files');

/**
 * Files dragged over the page: the Zen list lets the pointer through (class `tp-zen-drop`, marked meanwhile),
 * so Sharepoint's list beneath gets the drag and the drop and uploads as usual (its progress, conflicts, rights);
 * dropped on the Zen list: the folder read anew once Sharepoint's list has changed and settled
 * @param el the Zen list
 * @param list Sharepoint's list (watched after a drop)
 * @param reload reads the folder anew
 * @returns stops it
 */
export function wireDrop(el: HTMLElement, list: () => Element | null, reload: () => void): () => void {
    let idle: ReturnType<typeof setTimeout> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let watch: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | null = null;

    const end = () => {
        clearTimeout(idle);
        el.classList.remove('tp-zen-drop');
    };
    const over = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        el.classList.add('tp-zen-drop');
        clearTimeout(idle);
        idle = setTimeout(end, DRAG_IDLE);
    };
    const unwatch = () => {
        observer?.disconnect();
        observer = null;
        clearTimeout(settle);
        clearTimeout(watch);
    };
    const changed = (records: MutationRecord[]) => {
        if (records.every(ownChange)) return;
        clearTimeout(settle);
        settle = setTimeout(reload, DROP_SETTLE);
        clearTimeout(watch);
        watch = setTimeout(unwatch, DROP_WATCH);
    };
    const dropped = (e: DragEvent) => {
        if (!hasFiles(e) || !el.classList.contains('tp-zen-drop')) return;
        setTimeout(end, 0); // after Sharepoint's own handlers (this one: capture phase)
        if (!dropInside(el, e)) return; // elsewhere on the page: not for this folder
        const target = list();
        if (!target) return;
        unwatch();
        observer = new MutationObserver(changed);
        observer.observe(target, { childList: true, subtree: true });
        watch = setTimeout(unwatch, DROP_WATCH);
    };

    const options = { capture: true };
    window.addEventListener('dragenter', over, options);
    window.addEventListener('dragover', over, options);
    window.addEventListener('drop', dropped, options);
    return () => {
        window.removeEventListener('dragenter', over, options);
        window.removeEventListener('dragover', over, options);
        window.removeEventListener('drop', dropped, options);
        end();
        unwatch();
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Point of the drop within the Zen list
function dropInside(el: HTMLElement, e: DragEvent): boolean {
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

// Change of the list by the userscript alone (eyes added or removed)
function ownChange(record: MutationRecord): boolean {
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return nodes.every((n) => (n as Element).closest?.(MARKS));
}
