// Diagrams of Markdown (```mermaid): drawn by Mermaid (https://mermaid.js.org) from the viewer files folder
// (mermaid.js, SHA-256 checked, loaded once per page), else simple flowcharts drawn here; source can be copied

// ===========================================================================
// IMPORTS
// ===========================================================================

import { DIAGRAMS_JS_SHA256 } from '../_core/settings.ts';
import { fetchExtra } from '../readers/extras.ts';
import { hasExtra } from '../readers/extras.ts';
import { runScript } from '../readers/extras.ts';
import { drawFlowchart } from './flowchart.ts';
import { parseFlowchart } from './flowchart.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** Mermaid as its file provides it (the part used) */
type Mermaid = {
    initialize: (config: Record<string, unknown>) => void;
    render: (id: string, text: string) => Promise<{ svg: string }>;
};

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const DIAGRAMS_FILE = 'mermaid.js';
let library: Promise<Mermaid> | null = null; // once started
let failure = ''; // why Mermaid is not used (shown under simple drawings)
let count = 0; // ids of rendered diagrams

// ===========================================================================
// METHODS
// ===========================================================================

// Diagrams in an element not drawn yet; returns stop (resize watchers of simple drawings)
export function drawDiagrams(root: HTMLElement): () => void {
    const stops: (() => void)[] = [];
    let stopped = false;
    for (const el of root.querySelectorAll<HTMLElement>('.tp-md-diagram:not([data-drawn])')) {
        el.dataset.drawn = '1';
        const src = el.dataset.src || '';
        addCopy(el, src);
        drawDiagram(el, src, stops, () => stopped);
    }
    return () => {
        stopped = true;
        for (const stop of stops) stop();
    };
}

async function drawDiagram(el: HTMLElement, src: string, stops: (() => void)[], stopped: () => boolean) {
    const body = el.querySelector('.tp-md-diagram-body') as HTMLElement;
    if (hasExtra(DIAGRAMS_JS_SHA256) && !failure) {
        try {
            const mermaid = await loadMermaid((s) => {
                if (!body.querySelector('svg')) body.dataset.status = s;
            });
            if (stopped()) return;
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'strict',
                theme: el.closest('.tp-dark') ? 'dark' : 'neutral',
                fontFamily: getComputedStyle(el).fontFamily,
                look: 'classic', // calm: no shadows, no hand-drawn lines
                themeVariables: { fontSize: '13px' },
                flowchart: { useMaxWidth: false, wrappingWidth: 480, padding: 10 }, // natural size; lines wrap late
            });
            const { svg } = await mermaid.render(`tp-diagram-${++count}`, src);
            body.innerHTML = svg; // sanitised by Mermaid (strict)
            el.classList.add('tp-md-diagram-mermaid');
            return;
        } catch (err) {
            if (!library) failure = (err as Error).message; // file not usable: simple drawings from now on
            el.title = `Mermaid: ${(err as Error).message}`;
        } finally {
            delete body.dataset.status;
        }
    }
    const chart = parseFlowchart(src);
    if (!chart || stopped()) return; // source stays shown
    stops.push(drawFlowchart(body, chart));
    const note = document.createElement('div');
    note.className = 'tp-md-diagram-note';
    note.textContent = `Simple drawing${failure ? ` (Mermaid: ${failure})` : hasExtra(DIAGRAMS_JS_SHA256) ? '' : ' (Mermaid not set up)'}`;
    el.append(note);
}

// Library (once per page; after a failure: simple drawings)
function loadMermaid(onStatus: (s: string) => void): Promise<Mermaid> {
    if (library) return library;
    const loading = (async () => {
        const js = await fetchExtra(DIAGRAMS_FILE, DIAGRAMS_JS_SHA256, onStatus);
        const lib = runScript<Mermaid>(js, 'mermaid');
        if (!lib?.render) throw new Error(`${DIAGRAMS_FILE} did not start`);
        return lib;
    })();
    loading.catch(() => {
        library = null;
    });
    library = loading;
    return loading;
}

function addCopy(el: HTMLElement, src: string) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tp-md-diagram-copy';
    button.textContent = 'Copy';
    button.title = 'Copy the diagram as Mermaid text';
    button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(src);
        button.textContent = 'Copied';
        setTimeout(() => {
            button.textContent = 'Copy';
        }, 1200);
    });
    el.prepend(button);
}
