// Link button: copies the clean URL of what it stands for (shown on hover); a tick for a moment once copied

// ===========================================================================
// IMPORTS
// ===========================================================================

import { CHECK_SVG } from './icons.ts';
import { LINK_SVG } from './icons.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const LINK_TICK = 2000; // ms: tick shown after copying

// ===========================================================================
// METHODS
// ===========================================================================

/** Wires a link button: its URL in the tooltip on hover, copied to the clipboard on click */
export function wireLink(btn: HTMLElement, urlOf: () => string): void {
    btn.onmouseenter = btn.onfocus = () => {
        btn.title = `Copy the link:\n${urlOf()}`;
    };
    btn.onclick = async () => {
        const url = urlOf();
        try {
            await navigator.clipboard.writeText(url);
            btn.innerHTML = CHECK_SVG;
            btn.title = `Copied:\n${url}`;
        } catch (_err) {
            btn.title = `Copy failed:\n${url}`;
        }
        setTimeout(() => {
            btn.innerHTML = LINK_SVG;
        }, LINK_TICK);
    };
}
