// 3D view (IFC / IFCZIP), ifc-lite from VIEWER_3D_FOLDER on first use, SHA-256 checked.
// Model stays in browser.

// ===========================================================================
// IMPORTS
// ===========================================================================

import { MAX_3D_BYTES } from '../_core/settings.js';
import { VIEWER_3D_FOLDER } from '../_core/settings.js';
import { VIEWER_3D_JS_SHA256 } from '../_core/settings.js';
import { VIEWER_3D_WASM_SHA256 } from '../_core/settings.js';
import { formatBytes } from '../_core/util.js';
import { sameOrigin } from '../readers/request.js';
import { flash } from './edit.js';
import { updateViews } from './views.js';

/** @typedef {import('../_core/types.js').Viewer} Viewer */

// ===========================================================================
// CONSTANTS
// ===========================================================================

let ifcLibrary = null; // Promise<{ lib, wasm }> once started
export let ifcLibraryReady = false; // loaded (then IFC files open in 3D again if it was chosen)
/** @type {Map<string, Pose>} */
/** @type {Map<string, Pose>} */
const view3dPoses = new Map(); // file url -> camera of its last 3D view (while this page is open)

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {ArrayBuffer} buf @returns {Promise<string>} */
async function sha256(buf) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Library (once per page)
/** @param {(s: string) => void} onStatus @returns {Promise<{ lib: { init: Function, GeometryProcessor: *, Renderer: * }, wasm: Uint8Array }>} */
function loadIfcLibrary(onStatus) {
    ifcLibrary ||= (async () => {
        if (!VIEWER_3D_FOLDER) throw new Error('the 3D viewer folder is not set (settings: "3D viewer folder")');
        /** @param {string} name @param {string} hash */
        const file = async (name, hash) => {
            if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('no 3D checksums in this build: use a release userscript');
            const site = (location.pathname.match(/^\/(?:sites|teams|personal)\/[^/]+/i) || [''])[0]; // current site
            const folder = VIEWER_3D_FOLDER.startsWith('/') ? VIEWER_3D_FOLDER : `${site}/${VIEWER_3D_FOLDER}`;
            const url = `${folder.replace(/\/$/, '')}/${name}`.split('/').map(encodeURIComponent).join('/');
            if (!sameOrigin(url)) throw new Error('the 3D viewer folder must be in this SharePoint');
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
        const lib = new Function(`${new TextDecoder().decode(js)}\n;return globalThis.IfcLite;`)();
        if (!lib) throw new Error('3D library did not start');
        ifcLibraryReady = true;
        return { lib, wasm: new Uint8Array(wasm) };
    })();
    ifcLibrary.catch(() => {
        ifcLibrary = null; // later click tries again
    });
    return ifcLibrary;
}

// IFC bytes in canvas; returns { pose(), dispose() }
/** @typedef {{ position: Object<string, number>, target: Object<string, number>, up: Object<string, number> }} Pose camera of a 3D view */
/** @param {*} lib @param {Uint8Array} wasm @param {HTMLCanvasElement} canvas @param {Uint8Array} ifcBytes @param {(s: string) => void} onStatus @param {Pose} [pose] @returns {Promise<{ pose: () => Pose, dispose: () => void }>} */
async function open3dModel(lib, wasm, canvas, ifcBytes, onStatus, pose) {
    onStatus('3D engine start …');
    lib.ready ||= lib.init({ module_or_path: wasm }); // once per page
    await lib.ready;
    // Canvas in CSS pixels, width multiple of 64 (WebGPU), set before renderer starts
    const size = () => {
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
    const fit = () => {
        const b = result.coordinateInfo?.shiftedBounds;
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

    /** @type {{ x: number, y: number, pan: boolean }|null} */
    let drag = null;
    /** @param {PointerEvent} e */
    const down = (e) => {
        drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
        canvas.setPointerCapture(e.pointerId);
    };
    /** @param {PointerEvent} e */
    const move = (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (drag.pan) camera.pan(dx, dy);
        else camera.orbit(dx, dy);
        renderer.requestRender();
    };
    const up = () => {
        drag = null;
    };
    /** @param {WheelEvent} e */
    const wheel = (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        camera.zoom(e.deltaY, false, e.clientX - r.left, e.clientY - r.top, canvas.width, canvas.height);
        renderer.requestRender();
    };
    /** @param {Event} e */
    const noMenu = (e) => e.preventDefault();
    const resize = new ResizeObserver(() => {
        renderer.resize(...size());
        renderer.requestRender();
    });
    resize.observe(canvas);

    // Draw loop: renders when asked to, and while camera still moves (inertia)
    let last = performance.now();
    let frame = 0;
    /** @param {number} now */
    const loop = (now) => {
        const moving = camera.update(now - last);
        last = now;
        if (renderer.consumeRenderRequest() || moving) renderer.render();
        frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    /** @type {[string, (e: *) => void][]} */
    const events = [
        ['pointerdown', down],
        ['pointermove', move],
        ['pointerup', up],
        ['pointercancel', up],
        ['wheel', wheel],
        ['dblclick', fit],
        ['contextmenu', noMenu],
    ];
    for (const [type, fn] of events)
        canvas.addEventListener(type, fn, type === 'wheel' ? { passive: false } : undefined);
    return {
        pose: () => ({
            position: { ...camera.getPosition() },
            target: { ...camera.getTarget() },
            up: { ...camera.getUp() },
        }),
        dispose() {
            cancelAnimationFrame(frame);
            resize.disconnect();
            for (const [type, fn] of events) canvas.removeEventListener(type, fn);
            renderer.destroy();
        },
    };
}

// Switch 3D view on / off for open IFC file
/** @param {Viewer} v @returns {Promise<void>} */
export async function toggle3d(v) {
    if (v.view3d) return close3d(v);
    const src = v.source;
    if (!src || v.previewBtn.disabled) return;
    if (!(/** @type {Navigator & { gpu?: unknown }} */ (navigator).gpu)) {
        alert('3D view needs WebGPU (current Chrome or Edge).');
        return;
    }
    if (v.writeMode && v.dirty) {
        alert('Please save your changes first, then switch the view.');
        return void flash(v.saveBtn);
    }
    if (!src.done && !(await v.loadAll())) return; // 3D view needs whole file
    if (!src.done) return;
    if ((src.ifcBytes ? src.ifcBytes.length : src.text.length) > MAX_3D_BYTES) {
        alert(`3D view: only for IFC files up to ${formatBytes(MAX_3D_BYTES)}.`);
        return;
    }
    const file = v.file;
    /** @type {{ disposed: boolean, handle: { pose: () => Pose, dispose: () => void }|null }} */
    const state = { disposed: false, handle: null };
    v.view3d = state;
    updateViews(v);
    v.content.style.display = 'none';
    v.editorWrap.style.display = 'none';
    v.loadMoreBtn.style.display = 'none';
    v.stage3d.style.display = 'block';
    /** @param {string} s */
    const status = (s) => {
        v.status3d.textContent = s;
    };
    try {
        const { lib, wasm } = await loadIfcLibrary(status);
        if (state.disposed || v.file !== file) return;
        const bytes = src.ifcBytes || new TextEncoder().encode(v.writeMode ? (v.staged ?? src.text) : src.text);
        const handle = await open3dModel(lib, wasm, v.canvas3d, bytes, status, view3dPoses.get(file.url));
        if (state.disposed) handle.dispose();
        else state.handle = handle;
    } catch (err) {
        if (!state.disposed) status(`3D view failed: ${/** @type {Error} */ (err).message}`);
    }
}

/** @param {Viewer} v @returns {void} */
export function close3d(v) {
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
