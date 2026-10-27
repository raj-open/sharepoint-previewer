// Controls of the 3D view: views, projection, selection (with its IFC line and its properties), hide / isolate, section plane

// ===========================================================================
// IMPORTS
// ===========================================================================

import { ifcEntity } from '../text/ifc.ts';
import { showSets } from './props3d.ts';

import type { IfcEntity } from '../text/ifc.ts';
import type { PropsReader } from './props3d.ts';
import type { Renderer } from '@ifc-lite/renderer';
import type { RenderOptions } from '@ifc-lite/renderer';
import type { SectionPlaneAxis } from '@ifc-lite/renderer';

// ===========================================================================
// TYPES
// ===========================================================================

type Vec3 = { x: number; y: number; z: number };
type Bounds = { min: Vec3; max: Vec3 };

/** what the controls act on */
export type Tools3dTarget = {
    renderer: Renderer;
    bounds: Bounds | null; // of the model (after ifc-lite's shift of far-off coordinates)
    fit: () => void;
    text: () => string; // IFC text of the model
    showLine: (line: number) => void; // text view at this line
    sets?: PropsReader; // property and quantity sets of an object
};

/** controls of one 3D view */
export type Tools3d = {
    options: () => RenderOptions; // for each frame
    select: (x: number, y: number) => Promise<void>; // CSS pixels in the canvas
    dispose: () => void;
};

// ===========================================================================
// CONSTANTS
// ===========================================================================

const SECTIONS: [SectionPlaneAxis | '', string][] = [
    ['', 'No section'],
    ['down', 'Section: horizontal'],
    ['front', 'Section: front'],
    ['side', 'Section: side'],
];

let propsOpen = false; // properties of the selection shown (kept for the next 3D view while the page is open)

// ===========================================================================
// METHODS
// ===========================================================================

/** @param stage element around the canvas (controls are laid over it) */
export function tools3d(stage: HTMLElement, target: Tools3dTarget): Tools3d {
    const { renderer } = target;
    const camera = renderer.getCamera();
    const bounds = target.bounds ?? undefined;

    // State shown in each frame
    let selected: IfcEntity | { id: number; type: ''; name: ''; line: 0 } | null = null;
    const hidden = new Set<number>();
    let isolated: Set<number> | null = null;
    let axis: SectionPlaneAxis | '' = '';
    let position = 50; // % of the model along the axis

    // ---------------------------------------------------------------
    // Elements
    // ---------------------------------------------------------------

    const bar = row('tp-3d-bar');
    const side = row('tp-3d-side'); // below the bar: selection, then its properties
    const info = row('tp-3d-info');
    info.hidden = true;
    const props = row('tp-3d-props');
    props.hidden = true;
    side.append(info, props);
    stage.append(bar, side);

    const view = (label: string, title: string, fn: () => void) =>
        bar.append(
            button(label, title, () => {
                fn();
                renderer.requestRender();
            }),
        );
    view('Fit', 'Whole model in view (also: double-click)', () => target.fit());
    view('Top', 'From above (again: turned by 90°)', () => camera.setPresetView('top', bounds));
    view('Front', 'From the front (again: turned by 90°)', () => camera.setPresetView('front', bounds));
    view('Side', 'From the right (again: turned by 90°)', () => camera.setPresetView('right', bounds));
    view('3D', 'From above at an angle', () => camera.setPresetDirection({ x: 1, y: 1, z: 1 }, bounds));
    const projection = button('', 'Perspective or orthographic (parallel) projection', () => {
        camera.toggleProjectionMode();
        showProjection();
        renderer.requestRender();
    });
    const showProjection = () => {
        projection.textContent = camera.getProjectionMode() === 'perspective' ? 'Perspective' : 'Orthographic';
    };
    showProjection();
    bar.append(projection);

    const section = document.createElement('select');
    section.className = 'tp-3d-btn';
    section.title = 'Cut the model by a plane';
    for (const [value, label] of SECTIONS) section.add(new Option(label, value));
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(position);
    slider.className = 'tp-3d-slider';
    slider.title = 'Position of the section plane';
    slider.hidden = true;
    section.onchange = () => {
        axis = section.value as SectionPlaneAxis | '';
        slider.hidden = !axis;
        renderer.requestRender();
    };
    slider.oninput = () => {
        position = Number(slider.value);
        renderer.requestRender();
    };
    bar.append(section, slider);

    // Selection: what it is, its line in the text; hide, isolate, show all
    const label = document.createElement('span');
    label.className = 'tp-3d-label';
    const toText = button('In text', 'Show its line in the text view', () => {
        if (selected?.line) target.showLine(selected.line);
    });
    const hide = button('Hide', 'Hide this object', () => {
        if (!selected) return;
        hidden.add(selected.id);
        isolated?.delete(selected.id);
        setSelected(null);
    });
    const isolate = button('Isolate', 'Show this object only', () => {
        if (!selected) return;
        isolated = new Set([selected.id]);
        hidden.delete(selected.id);
        update();
    });
    const showAll = button('Show all', 'Show hidden objects again', () => {
        hidden.clear();
        isolated = null;
        update();
    });
    const propsBtn = button('Properties', 'Show or hide its property and quantity sets', () => {
        propsOpen = !propsOpen;
        update();
    });
    info.append(label, propsBtn, toText, hide, isolate, showAll);

    // ---------------------------------------------------------------
    // State
    // ---------------------------------------------------------------

    const update = () => {
        const some = hidden.size > 0 || isolated !== null;
        info.hidden = !selected && !some;
        label.textContent = selected ? describe(selected) : 'Nothing selected';
        label.title = selected?.line ? `Line ${selected.line} of the text` : '';
        toText.hidden = !selected?.line;
        hide.hidden = !selected;
        isolate.hidden = !selected;
        showAll.hidden = !some;
        propsBtn.hidden = !selected || !target.sets;
        propsBtn.setAttribute('aria-pressed', String(propsOpen));
        props.hidden = propsBtn.hidden || !propsOpen;
        if (!props.hidden) showProps();
        renderer.requestRender();
    };

    // Properties of the selection: read once per object shown (the first read parses the model)
    let propsOf: number | null = null;
    const showProps = () => {
        const id = selected?.id ?? null;
        if (id === null || id === propsOf || !target.sets) return;
        propsOf = id;
        props.textContent = 'reading properties …';
        target
            .sets(id)
            .then((sets) => {
                if (propsOf === id) showSets(props, sets);
            })
            .catch((err: Error) => {
                if (propsOf !== id) return;
                propsOf = null; // try again on the next selection
                props.textContent = `Properties not read: ${err.message}`;
            });
    };

    const setSelected = (id: number | null) => {
        selected = id === null ? null : ifcEntity(target.text(), id) || { id, type: '', name: '', line: 0 };
        update();
    };

    return {
        options: () => ({
            selectedId: selected?.id ?? null,
            hiddenIds: hidden,
            isolatedIds: isolated,
            sectionPlane: axis ? { axis, position, enabled: true, showGizmo: false } : undefined,
        }),
        async select(x, y) {
            const hit = await renderer.pick(x, y);
            setSelected(hit ? hit.expressId : null);
        },
        dispose() {
            bar.remove();
            side.remove();
        },
    };
}

/** @returns e.g. IFCWALL "Wall" · #60 */
export function describe(e: { id: number; type: string; name: string }): string {
    const name = e.name ? ` "${e.name}"` : '';
    return e.type ? `${e.type}${name} · #${e.id}` : `#${e.id}`;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function row(className: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = className;
    return el;
}

function button(text: string, title: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tp-3d-btn';
    b.textContent = text;
    b.title = title;
    b.onclick = (e) => {
        e.stopPropagation();
        fn();
    };
    return b;
}
