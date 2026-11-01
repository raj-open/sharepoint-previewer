// Simple flowcharts drawn without Mermaid (its file not set up, or not loaded): the plain part of its syntax
// (`flowchart LR|RL|TD|TB|BT`, nodes `id["text"]` in the shapes [ ], ( ), ([ ]), { }, edges -->, ---, -->|text|);
// anything else (subgraphs, styles, other diagram kinds): null, the source stays shown

// ===========================================================================
// TYPES
// ===========================================================================

type FlowNode = { id: string; text: string; shape: string };
type FlowEdge = { from: string; to: string; text: string; arrow: boolean };
export type Flowchart = { dir: string; nodes: Map<string, FlowNode>; edges: FlowEdge[] };

// ===========================================================================
// CONSTANTS
// ===========================================================================

const HEAD_RE = /^(?:flowchart|graph)\s+(LR|RL|TD|TB|BT)\s*;?$/i;
const ARROW_RE = /\s*(-->|---|==>|-\.->)\s*(?:\|([^|]*)\|\s*)?/;
const NODE_RE = /^([\w-]+)\s*(?:(\(\[|\(\(|\[\[|\[|\(|\{)\s*(?:"([^"]*)"|([^"]*?))\s*(\]\)|\)\)|\]\]|\]|\)|\}))?\s*;?$/;
const SKIP_RE = /^(?:%%|$)/;
const SVG_NS = 'http://www.w3.org/2000/svg';

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

// Flowchart of Mermaid's plain syntax; null: something else
export function parseFlowchart(src: string): Flowchart | null {
    const lines = src.split('\n').map((l) => l.trim());
    const head = HEAD_RE.exec(lines.shift() || '');
    if (!head) return null;
    const chart: Flowchart = { dir: head[1].toUpperCase().replace('TB', 'TD'), nodes: new Map(), edges: [] };
    const node = (part: string): string | null => {
        const m = NODE_RE.exec(part);
        if (!m) return null;
        const [, id, open, quoted, bare] = m;
        const old = chart.nodes.get(id);
        if (open || !old)
            chart.nodes.set(id, {
                id,
                text: open ? labelText(quoted ?? bare ?? '') : old?.text || id,
                shape: open || '[',
            });
        return id;
    };
    for (const line of lines) {
        if (SKIP_RE.test(line)) continue;
        const parts = line.split(new RegExp(ARROW_RE.source, 'g'));
        // parts: node, arrow, text, node, arrow, text, node …
        let from = node(parts[0]);
        if (!from) return null;
        for (let i = 1; i + 2 < parts.length; i += 3) {
            const to = node(parts[i + 2]);
            if (!to) return null;
            chart.edges.push({ from, to, text: labelText(parts[i + 1] || ''), arrow: parts[i] !== '---' });
            from = to;
        }
    }
    return chart.nodes.size ? chart : null;
}

// Text of a label: Mermaid's entities (#quot; #35; …), breaks as new lines, other tags left out
function labelText(s: string): string {
    const named: Record<string, string> = { quot: '"', lt: '<', gt: '>', amp: '&', apos: "'", nbsp: ' ' };
    return s
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/#(\d+|\w+);/g, (m, e: string) =>
            /^\d+$/.test(e) ? String.fromCodePoint(Number(e)) : (named[e] ?? m),
        );
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// Nodes in ranks (longest path from a start), boxes laid out by CSS, arrows drawn over them (again on resize)
export function drawFlowchart(host: HTMLElement, chart: Flowchart): () => void {
    const rank = ranks(chart);
    const across = chart.dir === 'LR' || chart.dir === 'RL';
    const wrap = document.createElement('div');
    wrap.className = `tp-flow ${across ? 'tp-flow-across' : 'tp-flow-down'}`;
    const columns = document.createElement('div');
    columns.className = 'tp-flow-ranks';
    if (chart.dir === 'RL' || chart.dir === 'BT')
        columns.style.flexDirection = across ? 'row-reverse' : 'column-reverse';
    const boxes = new Map<string, HTMLElement>();
    const count = Math.max(0, ...rank.values()) + 1;
    for (let r = 0; r < count; r++) {
        const column = document.createElement('div');
        column.className = 'tp-flow-rank';
        for (const n of chart.nodes.values()) {
            if (rank.get(n.id) !== r) continue;
            const box = document.createElement('div');
            box.className = `tp-flow-node tp-flow-${{ '(': 'round', '([': 'round', '((': 'round', '{': 'choice' }[n.shape] || 'box'}`;
            const [title, ...rest] = n.text.split('\n');
            const strong = document.createElement('div');
            strong.className = 'tp-flow-title';
            strong.textContent = title;
            box.append(strong);
            for (const line of rest) {
                const div = document.createElement('div');
                div.textContent = line;
                box.append(div);
            }
            boxes.set(n.id, box);
            column.append(box);
        }
        columns.append(column);
    }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('tp-flow-edges');
    wrap.append(columns, svg);
    host.replaceChildren(wrap);
    const redraw = () => drawEdges(wrap, svg, chart, boxes, across);
    const resize = new ResizeObserver(redraw);
    resize.observe(wrap);
    redraw();
    return () => resize.disconnect();
}

// Rank: longest path from a node without incoming edges (cycles: cut after as many rounds as nodes)
function ranks(chart: Flowchart): Map<string, number> {
    const rank = new Map([...chart.nodes.keys()].map((id) => [id, 0]));
    for (let round = 0; round < chart.nodes.size; round++) {
        let changed = false;
        for (const e of chart.edges) {
            if (e.from === e.to) continue;
            const r = (rank.get(e.from) as number) + 1;
            if (r > (rank.get(e.to) as number)) {
                rank.set(e.to, r);
                changed = true;
            }
        }
        if (!changed) break;
    }
    return rank;
}

function drawEdges(
    wrap: HTMLElement,
    svg: SVGSVGElement,
    chart: Flowchart,
    boxes: Map<string, HTMLElement>,
    across: boolean,
) {
    const base = wrap.getBoundingClientRect();
    const parts: string[] = [
        '<defs><marker id="tp-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">',
        '<path d="M0 0L10 5L0 10z" class="tp-flow-head"/></marker></defs>',
    ];
    const box = (id: string) => (boxes.get(id) as HTMLElement).getBoundingClientRect();
    for (const e of chart.edges) {
        const a = box(e.from);
        const b = box(e.to);
        const forward = across ? b.left >= a.right : b.top >= a.bottom;
        const sign = forward ? 1 : -1;
        // from the side facing the other box, to the middle of the side of the other box
        const [x1, y1, x2, y2] = across
            ? [forward ? a.right : a.left, a.top + a.height / 2, forward ? b.left : b.right, b.top + b.height / 2]
            : [a.left + a.width / 2, forward ? a.bottom : a.top, b.left + b.width / 2, forward ? b.top : b.bottom];
        const [sx, sy, ex, ey] = [x1 - base.left, y1 - base.top, x2 - base.left, y2 - base.top];
        const bend = Math.max(24, (across ? Math.abs(ex - sx) : Math.abs(ey - sy)) / 2) * sign;
        const c = across ? `${sx + bend} ${sy}, ${ex - bend} ${ey}` : `${sx} ${sy + bend}, ${ex} ${ey - bend}`;
        const head = e.arrow ? ' marker-end="url(#tp-flow-arrow)"' : '';
        parts.push(`<path class="tp-flow-line" d="M${sx} ${sy} C${c}, ${ex} ${ey}"${head}/>`);
        if (e.text) {
            const t = e.text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
            parts.push(
                `<text class="tp-flow-label" x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 4}" text-anchor="middle">${t}</text>`,
            );
        }
    }
    svg.innerHTML = parts.join('');
}
