// 3D view (IFC / IFCZIP), ifc-lite from VIEWER_3D_FOLDER on first use, SHA-256 checked.
// Model stays in browser.

// ===========================================================================
// IMPORTS
// ===========================================================================

import { MAX_3D_BYTES } from '../_core/settings.ts';
import { VIEWER_3D_FOLDER } from '../_core/settings.ts';
import { VIEWER_3D_JS_SHA256 } from '../_core/settings.ts';
import { VIEWER_3D_WASM_SHA256 } from '../_core/settings.ts';
import { formatBytes } from '../_core/util.ts';
import { encodePath } from '../readers/request.ts';
import { sameOrigin } from '../readers/request.ts';
import { flash } from './edit.ts';
import { tools3d } from './tools3d.ts';
import { updateViews } from './views.ts';

import type { Viewer } from '../_core/types.ts';
import type { GeometryProcessor } from '@ifc-lite/geometry';
import type { Renderer } from '@ifc-lite/renderer';
import type initEngine from '@ifc-lite/wasm';

// ===========================================================================
// TYPES
// ===========================================================================

// ifc-lite as its bundle provides it (cf. /src/@apis/ifc-lite/main.ts); ready: engine started (once per page)
type IfcLite = {
    init: typeof initEngine;
    GeometryProcessor: typeof GeometryProcessor;
    Renderer: typeof Renderer;
    ready?: ReturnType<typeof initEngine>;
};
type Vec3 = { x: number; y: number; z: number };
/** camera of a 3D view */
export type Pose = { position: Vec3; target: Vec3; up: Vec3 };
/** 3D view of a viewer: model shown (handle) once loaded; disposed: closed (also while loading) */
export type View3d = { disposed: boolean; handle: { pose: () => Pose; dispose: () => void } | null };

// ===========================================================================
// CONSTANTS
// ===========================================================================

let ifcLibrary: Promise<{ lib: IfcLite; wasm: Uint8Array }> | null = null; // once started
export let ifcLibraryReady = false; // loaded (then IFC files open in 3D again if it was chosen)
const view3dPoses: Map<string, Pose> = new Map(); // file url -> camera of its last 3D view (while this page is open)

// ===========================================================================
// METHODS
// ===========================================================================

async function sha256(buf: ArrayBuffer): Promise<string> {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Library (once per page)
function loadIfcLibrary(onStatus: (s: string) => void): Promise<{ lib: IfcLite; wasm: Uint8Array }> {
    if (ifcLibrary) return ifcLibrary;
    const loading = (async () => {
        if (!VIEWER_3D_FOLDER) throw new Error('the 3D viewer folder is not set (settings: "3D viewer folder")');
        const file = async (name: string, hash: string) => {
            if (!/^[0-9a-f]{64}$/.test(hash))
                throw new Error('no 3D checksums in this build: use a release userscript');
            const site = (location.pathname.match(/^\/(?:sites|teams|personal)\/[^/]+/i) || [''])[0]; // current site
            const folder = VIEWER_3D_FOLDER.startsWith('/') ? VIEWER_3D_FOLDER : `${site}/${VIEWER_3D_FOLDER}`;
            const url = encodePath(`${folder.replace(/\/$/, '')}/${name}`);
            if (!sameOrigin(url)) throw new Error('the 3D viewer folder must be in this Sharepoint');
            onStatus(`caching ${name} …`);
            const res = await fetch(url, { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`${name}: error ${res.status}`);
            const buf = await res.arrayBuffer();
            if ((await sha256(buf)) !== hash) throw new Error(`${name} does not match its checksum: not used`);
            return buf;
        };
        const [js, wasm] = await Promise.all([
            file('ifc-lite-3d.js', VIEWER_3D_JS_SHA256),
            file('ifc-lite_bg.wasm', VIEWER_3D_WASM_SHA256),
        ]);
        // Read IfcLite back in same function (sandbox may have another global)
        const lib: IfcLite | undefined = new Function(`${new TextDecoder().decode(js)}\n;return globalThis.IfcLite;`)();
        if (!lib) throw new Error('3D library did not start');
        ifcLibraryReady = true;
        return { lib, wasm: new Uint8Array(wasm) };
    })();
    loading.catch(() => {
        ifcLibrary = null; // later click tries again
    });
    ifcLibrary = loading;
    return loading;
}

// IFC bytes in canvas; returns { pose(), dispose() }
async function open3dModel(
    lib: IfcLite,
    wasm: Uint8Array,
    canvas: HTMLCanvasElement,
    ifcBytes: Uint8Array,
    onStatus: (s: string) => void,
    pose?: Pose,
    text: () => string = () => '',
    showLine: (line: number) => void = () => {},
): Promise<{ pose: () => Pose; dispose: () => void }> {
    onStatus('3D engine start …');
    lib.ready ||= lib.init({ module_or_path: wasm }); // once per page
    await lib.ready;
    // Canvas in CSS pixels, width multiple of 64 (WebGPU), set before renderer starts
    const size = (): [number, number] => {
        const r = canvas.getBoundingClientRect();
        return [
            Math.min(8192, Math.max(64, Math.floor(r.width / 64) * 64)),
            Math.min(8192, Math.max(1, Math.floor(r.height))),
        ];
    };
    [canvas.width, canvas.height] = size();
    const renderer = new lib.Renderer(canvas);
    const geometry = new lib.GeometryProcessor();
    // Retry: right after release browser may refuse new GPU device
    const startRenderer = async () => {
        for (let attempt = 1; ; attempt++) {
            try {
                return await renderer.init();
            } catch (err) {
                if (attempt >= 5) throw err;
                await new Promise((r) => setTimeout(r, 200 * attempt));
            }
        }
    };
    await Promise.all([startRenderer(), geometry.init()]);
    onStatus('geometry build …');
    const result = await geometry.process(ifcBytes);
    renderer.loadGeometry(result);
    const camera = renderer.getCamera();
    // Whole model in view (bounds after ifc-lite's shift of far-off coordinates)
    const b = result.coordinateInfo?.shiftedBounds;
    const fit = () => {
        const extent = b && Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
        if (extent > 0 && Number.isFinite(extent)) {
            camera.fitBoundsAdaptive(
                { min: b.min, max: b.max },
                { viewportShortPx: Math.min(canvas.width, canvas.height) },
            );
        } else renderer.fitToView();
        renderer.requestRender();
    };
    fit();
    if (pose) {
        // view this file had when it was last shown
        camera.setPosition(pose.position.x, pose.position.y, pose.position.z);
        camera.setTarget(pose.target.x, pose.target.y, pose.target.z);
        camera.setUp(pose.up.x, pose.up.y, pose.up.z);
        renderer.requestRender();
    }
    onStatus(`${result.meshes.length.toLocaleString()} objects · ${result.totalTriangles.toLocaleString()} triangles`);
    const stage = canvas.parentElement as HTMLElement; // controls laid over the canvas
    const tools = tools3d(stage, { renderer, bounds: b ? { min: b.min, max: b.max } : null, fit, text, showLine });

    // Drag: rotate or move; click (no drag): select
    let drag: { x: number; y: number; pan: boolean; moved: number } | null = null;
    const down = (e: PointerEvent) => {
        drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey, moved: 0 };
        canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (drag.pan) camera.pan(dx, dy);
        else camera.orbit(dx, dy);
        renderer.requestRender();
    };
    const up = (e: PointerEvent) => {
        const click = drag && !drag.pan && drag.moved < 4 && e.type === 'pointerup';
        drag = null;
        if (!click) return;
        const r = canvas.getBoundingClientRect();
        tools.select(e.clientX - r.left, e.clientY - r.top).catch(() => {}); // nothing picked on failure
    };
    const wheel = (e: WheelEvent) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        camera.zoom(e.deltaY, false, e.clientX - r.left, e.clientY - r.top, canvas.width, canvas.height);
        renderer.requestRender();
    };
    const noMenu = (e: Event) => e.preventDefault();
    const resize = new ResizeObserver(() => {
        renderer.resize(...size());
        renderer.requestRender();
    });
    resize.observe(canvas);

    // Draw loop: renders when asked to, and while camera still moves (inertia)
    let last = performance.now();
    let frame = 0;
    const loop = (now: number) => {
        const moving = camera.update(now - last);
        last = now;
        if (renderer.consumeRenderRequest() || moving) renderer.render(tools.options());
        frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // Listeners on the canvas (removed again on dispose)
    const offs: (() => void)[] = [];
    const on = <K extends keyof HTMLElementEventMap>(
        type: K,
        fn: (e: HTMLElementEventMap[K]) => void,
        opts?: AddEventListenerOptions,
    ) => {
        canvas.addEventListener(type, fn, opts);
        offs.push(() => canvas.removeEventListener(type, fn));
    };
    on('pointerdown', down);
    on('pointermove', move);
    on('pointerup', up);
    on('pointercancel', up);
    on('wheel', wheel, { passive: false });
    on('dblclick', fit);
    on('contextmenu', noMenu);
    return {
        pose: () => ({
            position: { ...camera.getPosition() },
            target: { ...camera.getTarget() },
            up: { ...camera.getUp() },
        }),
        dispose() {
            cancelAnimationFrame(frame);
            resize.disconnect();
            for (const off of offs) off();
            tools.dispose();
            renderer.destroy();
        },
    };
}

// Switch 3D view on / off for open IFC file
export async function toggle3d(v: Viewer): Promise<void> {
    if (v.view3d) return close3d(v);
    const src = v.source;
    if (!src || v.previewBtn.disabled) return;
    if (!(navigator as Navigator & { gpu?: unknown }).gpu) {
        alert('3D view needs WebGPU (current Chrome or Edge).');
        return;
    }
    if (v.writeMode && v.dirty) {
        alert('Please save your changes first, then switch the view.');
        return void flash(v.saveBtn);
    }
    if (!src.done && !(await v.loadAll?.())) return; // 3D view needs whole file
    if (!src.done) return;
    const size = src.ifcBytes ? src.ifcBytes.length : src.text.length;
    const question =
        `This IFC file is large (${formatBytes(size)}, above ${formatBytes(MAX_3D_BYTES)}).\n` +
        'The 3D view may be slow or run out of memory. Open it anyway?';
    if (size > MAX_3D_BYTES && !confirm(question)) return;
    const file = v.file;
    if (!file) return;
    const state: View3d = {
        disposed: false,
        handle: null,
    };
    v.view3d = state;
    updateViews(v);
    v.content.style.display = 'none';
    v.editorWrap.style.display = 'none';
    v.loadMoreBtn.style.display = 'none';
    v.stage3d.style.display = 'block';
    const status = (s: string) => {
        v.status3d.textContent = s;
    };
    try {
        const { lib, wasm } = await loadIfcLibrary(status);
        if (state.disposed || v.file !== file) return;
        const bytes = src.ifcBytes || new TextEncoder().encode(v.writeMode ? (v.staged ?? src.text) : src.text);
        const text = () => (v.writeMode ? (v.staged ?? src.text) : src.text); // as the model was built
        // object's line: text view (in write mode the editor, without jumping)
        const showLine = (line: number) => {
            close3d(v);
            if (!v.writeMode) v.goToLine?.(line);
        };
        const handle = await open3dModel(
            lib,
            wasm,
            v.canvas3d,
            bytes,
            status,
            view3dPoses.get(file.url),
            text,
            showLine,
        );
        if (state.disposed) handle.dispose();
        else state.handle = handle;
    } catch (err) {
        if (!state.disposed) status(`3D view failed: ${(err as Error).message}`);
    }
}

export function close3d(v: Viewer): void {
    const state = v.view3d;
    if (!state) return;
    state.disposed = true;
    if (state.handle && v.file) view3dPoses.set(v.file.url, state.handle.pose()); // for next time
    state.handle?.dispose();
    v.view3d = null;
    updateViews(v);
    v.stage3d.style.display = 'none';
    v.status3d.textContent = '';
    if (v.writeMode && !v.tableEditing) v.editorWrap.style.display = '';
    else v.content.style.display = '';
    v.rerender?.();
}
