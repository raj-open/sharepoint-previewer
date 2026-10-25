// Shared by the unit tests: browser and Tampermonkey stubs (installed before any module loads),
// module loader, a fetch that serves byte ranges from memory, a ZIP writer.
// Each test file runs in its own process (node --test), so stubs and settings never leak between files.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const LIBRARY = path.join(ROOT, 'tests/fake-sharepoint/library');
export const ORIGIN = 'https://acme.sharepoint.com';

// ----------------------------------------------------------------
// Stubs
// ----------------------------------------------------------------

/** Anything: callable, constructible, every property is again a stub (DOM wiring at module load). */
export function anything(name = 'stub') {
    // biome-ignore lint/complexity/useArrowFunction: proxy target must be constructible (new MutationObserver …)
    return new Proxy(function () {}, {
        get: (_, key) => {
            if (key === Symbol.toPrimitive) return () => '';
            if (key === 'then') return undefined; // not a promise
            if (key === 'length') return 0;
            return anything(`${name}.${String(key)}`);
        },
        apply: () => anything(`${name}()`),
        construct: () => anything(`new ${name}`),
        set: () => true,
    });
}

/** Tampermonkey storage, localStorage, menu commands: inspectable by tests. */
export const gm = { store: {}, menu: {}, local: new Map() };

Object.assign(globalThis, {
    GM_getValue: (key) => gm.store[key],
    GM_setValue: (key, value) => {
        gm.store[key] = value;
    },
    GM_registerMenuCommand: (label, fn) => {
        gm.menu[label] = fn;
    },
    GM_info: { script: { version: 'test' } },
    localStorage: {
        getItem: (k) => (gm.local.has(k) ? gm.local.get(k) : null),
        setItem: (k, v) => gm.local.set(k, String(v)),
        removeItem: (k) => gm.local.delete(k),
    },
    location: new URL(`${ORIGIN}/sites/Test/Shared%20Documents/Forms/AllItems.aspx`),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    innerWidth: 1400,
    innerHeight: 900,
});
for (const name of ['document', 'window', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'NodeFilter']) {
    globalThis[name] = anything(name);
}

/** Points location at another page (current folder, links). */
export function setLocation(href) {
    globalThis.location = new URL(href, ORIGIN);
}

// ----------------------------------------------------------------
// Modules and files
// ----------------------------------------------------------------

/** @param {string} module path under /src @returns {Promise<Object>} */
export const load = (module) => import(path.join(ROOT, 'src', module));

/** @param {string} file path under the fake library @returns {Uint8Array} */
export const fixture = (file) => new Uint8Array(fs.readFileSync(path.join(LIBRARY, file)));

/** Byte reader over memory, recording the ranges asked for. */
export function reader(bytes) {
    const ranges = [];
    const read = async (from, to) => {
        ranges.push([from, Math.min(to, bytes.length)]);
        return bytes.subarray(from, to);
    };
    return { read, ranges };
}

/**
 * fetch() for files on this origin: answers Range requests (206) unless `ranges` is false (200, whole file).
 * @param {Object<string, Uint8Array|string>} files url path -> content
 */
export function serve(files, { ranges = true } = {}) {
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(url, location.href);
        const range = init.headers?.Range;
        requests.push({ url: u.pathname, range });
        let body = files[decodeURIComponent(u.pathname)];
        if (body === undefined) return new Response('not found', { status: 404 });
        if (typeof body === 'string') body = new TextEncoder().encode(body);
        const headers = {
            'last-modified': 'Thu, 01 Oct 2026 12:00:00 GMT',
            'content-type': 'application/octet-stream',
        };
        const m = ranges && range && /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!m)
            return new Response(body, { status: 200, headers: { ...headers, 'content-length': String(body.length) } });
        const from = Number(m[1]);
        if (from >= body.length) return new Response('', { status: 416 });
        const to = Math.min(body.length - 1, m[2] ? Number(m[2]) : body.length - 1);
        return new Response(body.subarray(from, to + 1), {
            status: 206,
            headers: { ...headers, 'content-range': `bytes ${from}-${to}/${body.length}` },
        });
    };
    return requests;
}

/** ZIP archive (deflated entries) from { path: text }; offsets: entry -> [start, end) in archive. */
export function zip(files) {
    const parts = [];
    const central = [];
    const offsets = {};
    let at = 0;
    for (const [name, text] of Object.entries(files)) {
        const raw = Buffer.from(text);
        const data = zlib.deflateRawSync(raw);
        const nameBytes = Buffer.from(name);
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0);
        head.writeUInt16LE(20, 4);
        head.writeUInt16LE(8, 8);
        head.writeUInt32LE(zlib.crc32(raw), 14);
        head.writeUInt32LE(data.length, 18);
        head.writeUInt32LE(raw.length, 22);
        head.writeUInt16LE(nameBytes.length, 26);
        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(0x02014b50, 0);
        head.copy(dir, 6, 4, 30); // same fields, 2 bytes further on
        dir.writeUInt32LE(at, 42);
        central.push(Buffer.concat([dir, nameBytes]));
        offsets[name] = [at, at + 30 + nameBytes.length + data.length];
        parts.push(head, nameBytes, data);
        at += 30 + nameBytes.length + data.length;
    }
    const dirBytes = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(dirBytes.length, 12);
    end.writeUInt32LE(at, 16);
    return { bytes: new Uint8Array(Buffer.concat([...parts, dirBytes, end])), offsets };
}

/** Text of tokens [[class, text], …] joined: highlighters must not lose or add characters. */
export const joined = (tokens) => tokens.map(([, t]) => t).join('');

/** Classes given to a piece of text by a highlighter. */
export const classesOf = (tokens, text) => tokens.filter(([, t]) => t === text).map(([c]) => c);

/** Minimal element: style, classList, text / HTML, attributes, one child for querySelector. */
export function element() {
    const classes = new Set();
    const attrs = new Map();
    const el = {
        style: {},
        hidden: false,
        disabled: false,
        textContent: '',
        innerHTML: '',
        title: '',
        value: '',
        className: '',
        classList: {
            add: (...c) => {
                for (const x of c) classes.add(x);
            },
            remove: (...c) => {
                for (const x of c) classes.delete(x);
            },
            toggle: (c, on = !classes.has(c)) => {
                if (on) classes.add(c);
                else classes.delete(c);
                return on;
            },
            contains: (c) => classes.has(c),
        },
        setAttribute: (k, v) => attrs.set(k, String(v)),
        getAttribute: (k) => attrs.get(k) ?? null,
        insertAdjacentHTML: (_, html) => {
            el.innerHTML += html;
            el.textContent += html.replace(/<[^>]*>/g, '');
        },
        querySelector: () => (el.child ||= element()),
    };
    return el;
}

/** Viewer with the elements status, lint, sheet and edit functions touch. */
export function fakeViewer(extra = {}) {
    const v = {};
    for (const name of [
        'progress',
        'progressBar',
        'progressFill',
        'progressText',
        'lint',
        'stopBtn',
        'loadAllBtn',
        'saveBtn',
        'uploadBtn',
        'textBtn',
        'tableBtn',
        'view3dBtn',
        'titleSheet',
        'stage3d',
        'status3d',
        'content',
        'editorWrap',
        'editor',
        'readBtn',
        'writeBtn',
        'csvBar',
    ]) {
        v[name] = element();
    }
    // picker: what was set last
    v.sheetPicker = { button: element(), set: (...args) => (v.sheetPicker.last = args), close() {} };
    return Object.assign(v, extra);
}
