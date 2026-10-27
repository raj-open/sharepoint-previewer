// Shared by the unit tests: browser and Tampermonkey stubs (installed before any module loads),
// module loader, a fetch that serves byte ranges from memory, a ZIP writer.
// Each test file runs in its own process (node --test), so stubs and settings never leak between files.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const LIBRARY = path.join(ROOT, 'tests/mocks/mock-sharepoint/library');
export const ORIGIN = 'https://acme.sharepoint.com';

// ----------------------------------------------------------------
// Stubs
// ----------------------------------------------------------------

// Stand-ins for browser objects: loose by design
// biome-ignore lint/suspicious/noExplicitAny: stubs take any shape
export type Fake = Record<string, any>;

/** Anything: callable, constructible, every property is again a stub (DOM wiring at module load). */
// biome-ignore lint/suspicious/noExplicitAny: a stub is whatever its user expects
export function anything(name = 'stub'): any {
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

/** Tampermonkey storage, localStorage, menu commands, opened tabs: inspectable by tests. */
export const gm = {
    store: {} as Record<string, unknown>,
    menu: {} as Record<string, () => void>,
    tabs: [] as string[],
    local: new Map<string, string>(),
};

Object.assign(globalThis, {
    GM_getValue: (key: string) => gm.store[key],
    GM_setValue: (key: string, value: unknown) => {
        gm.store[key] = value;
    },
    GM_registerMenuCommand: (label: string, fn: () => void) => {
        gm.menu[label] = fn;
    },
    GM_openInTab: (url: string) => {
        gm.tabs.push(url);
    },
    GM_info: { script: { version: 'test', uuid: 'test-uuid' } },
    localStorage: {
        getItem: (k: string) => gm.local.get(k) ?? null,
        setItem: (k: string, v: unknown) => gm.local.set(k, String(v)),
        removeItem: (k: string) => gm.local.delete(k),
    },
    location: new URL(`${ORIGIN}/sites/Test/Shared%20Documents/Forms/AllItems.aspx`),
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    innerWidth: 1400,
    innerHeight: 900,
});
for (const name of ['document', 'window', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'NodeFilter']) {
    Object.assign(globalThis, { [name]: anything(name) });
}

/** Points location at another page (current folder, links). */
export function setLocation(href: string): void {
    Object.assign(globalThis, { location: new URL(href, ORIGIN) });
}

// ----------------------------------------------------------------
// Modules and files
// ----------------------------------------------------------------

/** @param module path under /src @returns its exports (loosely typed: tests call them freely) */
export const load = (module: string): Promise<Fake> => import(path.join(ROOT, 'src', module));

/** @param file path under the mock library */
export const fixture = (file: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(LIBRARY, file)));

/** Byte reader over memory, recording the ranges asked for. */
export function reader(bytes: Uint8Array): {
    read: (from: number, to: number) => Promise<Uint8Array>;
    ranges: [number, number][];
} {
    const ranges: [number, number][] = [];
    const read = async (from: number, to: number) => {
        ranges.push([from, Math.min(to, bytes.length)]);
        return bytes.subarray(from, to);
    };
    return { read, ranges };
}

/**
 * fetch() for files on this origin: answers Range requests (206) unless `ranges` is false (200, whole file).
 * @param files url path -> content
 * @param cap most bytes per partial answer (0: no limit), as servers may cut ranges short
 */
export function serve(
    files: Record<string, Uint8Array | string>,
    { ranges = true, cap = 0 } = {},
): { url: string; range?: string }[] {
    const requests: { url: string; range?: string }[] = [];
    const fake = async (url: string | URL, init: { headers?: Record<string, string> } = {}) => {
        const u = new URL(url, location.href);
        const range = init.headers?.Range;
        requests.push({ url: u.pathname, range });
        const content = files[decodeURIComponent(u.pathname)];
        if (content === undefined) return new Response('not found', { status: 404 });
        const body = (
            typeof content === 'string' ? new TextEncoder().encode(content) : content
        ) as Uint8Array<ArrayBuffer>;
        const headers = {
            'last-modified': 'Thu, 01 Oct 2026 12:00:00 GMT',
            'content-type': 'application/octet-stream',
        };
        const m = ranges && range && /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!m)
            return new Response(body, { status: 200, headers: { ...headers, 'content-length': String(body.length) } });
        const from = Number(m[1]);
        if (from >= body.length) return new Response('', { status: 416 });
        let to = Math.min(body.length - 1, m[2] ? Number(m[2]) : body.length - 1);
        if (cap) to = Math.min(to, from + cap - 1);
        return new Response(body.subarray(from, to + 1), {
            status: 206,
            headers: { ...headers, 'content-range': `bytes ${from}-${to}/${body.length}` },
        });
    };
    globalThis.fetch = fake as typeof fetch;
    return requests;
}

/** ZIP archive (deflated entries) from { path: text }; offsets: entry -> [start, end) in archive. */
export function zip(files: Record<string, string | Uint8Array>): {
    bytes: Uint8Array;
    offsets: Record<string, [number, number]>;
} {
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    const offsets: Record<string, [number, number]> = {};
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
export const joined = (tokens: [string, string][]): string => tokens.map(([, t]) => t).join('');

/** Classes given to a piece of text by a highlighter. */
export const classesOf = (tokens: [string, string][], text: string): string[] =>
    tokens.filter(([, t]) => t === text).map(([c]) => c);

/** Minimal element: style, classList, text / HTML, attributes, one child for querySelector. */
export function element(): Fake {
    const classes = new Set<string>();
    const attrs = new Map<string, string>();
    const el: Fake = {
        style: {},
        hidden: false,
        disabled: false,
        textContent: '',
        innerHTML: '',
        title: '',
        value: '',
        className: '',
        classList: {
            add: (...c: string[]) => {
                for (const x of c) classes.add(x);
            },
            remove: (...c: string[]) => {
                for (const x of c) classes.delete(x);
            },
            toggle: (c: string, on = !classes.has(c)) => {
                if (on) classes.add(c);
                else classes.delete(c);
                return on;
            },
            contains: (c: string) => classes.has(c),
        },
        setAttribute: (k: string, v: unknown) => attrs.set(k, String(v)),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        insertAdjacentHTML: (_: string, html: string) => {
            el.innerHTML += html;
            el.textContent += html.replace(/<[^>]*>/g, '');
        },
        querySelector: () => (el.child ||= element()),
    };
    return el;
}

/** Viewer with the elements status, lint, sheet and edit functions touch. */
export function fakeViewer(extra: Fake = {}): Fake {
    const v: Fake = {};
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
        'previewBtn',
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
    v.sheetPicker = { button: element(), set: (...args: unknown[]) => (v.sheetPicker.last = args), close() {} };
    v.formatPicker = { button: element(), set: (...args: unknown[]) => (v.formatPicker.last = args), close() {} };
    return Object.assign(v, extra);
}
