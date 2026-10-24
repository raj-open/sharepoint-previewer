// Text files: encoding sniffing and range reading

// ===========================================================================
// IMPORTS
// ===========================================================================

import { MAX_BYTES } from '../_core/settings.js';
import { SNIFF_BYTES } from '../_core/settings.js';
import { OUTSIDE } from './request.js';
import { responseDates } from './request.js';
import { sameOrigin } from './request.js';

/** @typedef {import('../_core/types.js').Source} Source */

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Content types that are never plain text
const BINARY_TYPE_RE =
    /^(image|audio|video|font)\/|^application\/(pdf|zip|x-zip|gzip|x-gzip|x-7z|x-rar|x-tar|msword|vnd\.ms-|vnd\.openxmlformats|vnd\.oasis)/i;

// Signatures of common binary files (PDF, ZIP/Office, PNG, JPEG, GIF, ...)
const BINARY_MAGIC = [
    [0x25, 0x50, 0x44, 0x46], // %PDF
    [0x50, 0x4b, 0x03, 0x04], // ZIP, docx/xlsx/pptx
    [0x89, 0x50, 0x4e, 0x47], // PNG
    [0xff, 0xd8, 0xff], // JPEG
    [0x47, 0x49, 0x46, 0x38], // GIF
    [0xd0, 0xcf, 0x11, 0xe0], // old Office (doc/xls)
    [0x1f, 0x8b], // gzip
    [0x37, 0x7a, 0xbc, 0xaf], // 7z
    [0x52, 0x61, 0x72, 0x21], // RAR
];

// ===========================================================================
// METHODS
// ===========================================================================

// Open file in chunks of MAX_BYTES, same origin only (nothing is sent elsewhere).
// Ranges if supported, else paused transfer. Returns { error } | { binary } | source.
/** @param {string} url @param {() => AbortSignal} getSignal @param {boolean} reload @param {(loaded: number, total: number) => void} onProgress @returns {Promise<Source|{ error: string }|{ binary: true, name?: string }>} */
export async function openSource(url, getSignal, reload, onProgress) {
    if (!sameOrigin(url)) return { error: OUTSIDE };
    /** @param {number} from */
    const request = (from) =>
        fetch(url, {
            credentials: 'same-origin',
            cache: reload ? 'reload' : 'default', // 'reload': fresh copy, which also updates cache
            headers: { Range: `bytes=${from}-${from + MAX_BYTES - 1}` },
            signal: getSignal(),
        });

    let response = await request(0);
    if (response.status === 416) response = await fetch(url, { credentials: 'same-origin', signal: getSignal() }); // empty file
    if (!response.ok) return { error: `Error ${response.status} on caching` };

    // File name from SharePoint (share links have none in URL)
    const cd = response.headers.get('content-disposition') || '';
    const cdName = (cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1];
    const name = cdName ? decodeURIComponent(cdName) : (cd.match(/filename="?([^";]+)"?/i) || [])[1];

    // Obvious binary types: stop before anything is cached
    if (BINARY_TYPE_RE.test(response.headers.get('content-type') || '')) {
        response.body?.cancel();
        return { binary: true, name };
    }

    const ranged = response.status === 206;
    /** @type {Object<string, *>} */
    const src = {
        name,
        dates: responseDates(response, cd),
        total: ranged
            ? +(response.headers.get('content-range') || '').split('/')[1] || 0
            : Number(response.headers.get('content-length')) || 0,
        loaded: 0,
        done: false,
        text: '',
    };
    /** @type {TextDecoder|null} */
    let decoder = null; // chosen from first bytes
    /** @type {ReadableStreamDefaultReader<Uint8Array>|null} */
    let reader = null; // open transfer (when SharePoint ignores ranges)

    // Add bytes to text; false = binary data (only first bytes decide)
    /** @param {Uint8Array} bytes */
    const feed = (bytes) => {
        if (!decoder) {
            const encoding = sniffText(bytes);
            if (!encoding) return false;
            decoder = new TextDecoder(encoding);
            src.encoding = encoding.toUpperCase();
            src.bom = encoding === 'utf-8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
        }
        src.loaded += bytes.length;
        src.text += decoder.decode(bytes, { stream: true });
        onProgress(src.loaded, src.total);
        return true;
    };

    const finish = () => {
        src.done = true;
        if (decoder) src.text += decoder.decode();
    };

    // Read `budget` bytes (after `skip`); 'more' | 'end' | 'binary'
    /** @param {Response|{ body: { getReader: () => ReadableStreamDefaultReader<Uint8Array> }, arrayBuffer?: undefined }} res @param {number} budget @param {number} [skip] */
    const read = async (res, budget, skip = 0) => {
        if (!res.body) {
            const all = new Uint8Array(await /** @type {Response} */ (res).arrayBuffer()).subarray(skip); // response without stream
            return feed(all) ? 'end' : 'binary';
        }
        const r = res.body.getReader();
        let got = 0;
        while (got < budget) {
            const { done, value } = await r.read();
            if (done) return 'end';
            let chunk = value;
            if (skip) {
                const drop = Math.min(skip, chunk.length);
                skip -= drop;
                chunk = chunk.subarray(drop);
                if (!chunk.length) continue;
            }
            if (!feed(chunk)) {
                r.cancel();
                return 'binary';
            }
            got += chunk.length;
        }
        reader = r; // budget reached: keep rest of this transfer for later
        return 'more';
    };

    const first = await read(response, MAX_BYTES);
    if (first === 'binary') return { binary: true, name };
    if (ranged) {
        /** @type {ReadableStreamDefaultReader<Uint8Array>|null} */ (reader)?.cancel(); // read() may have set it
        reader = null;
        if (src.total && src.loaded >= src.total) finish();
    } else if (first === 'end') {
        finish();
    }

    src.more = async () => {
        if (src.done) return;
        let state;
        if (reader) {
            // Resume paused transfer; if it was cut off, new request
            const r = reader;
            reader = null;
            const signal = getSignal(); // current one: aborted only by stop from now on
            try {
                state = await read({ body: { getReader: () => r } }, MAX_BYTES);
            } catch (err) {
                if (signal.aborted) throw err; // stopped by user now
                state = null;
            }
        }
        if (!state) {
            // Next range (if SharePoint suddenly sends whole file, skip what we have)
            const res = await request(src.loaded);
            if (res.status === 416) {
                finish(); // nothing left (size was unknown)
                return;
            }
            if (!res.ok) throw new Error(`Error ${res.status} on caching`);
            state = await read(res, MAX_BYTES, res.status === 206 ? 0 : src.loaded);
            if (res.status === 206) {
                /** @type {ReadableStreamDefaultReader<Uint8Array>|null} */ (reader)?.cancel(); // read() may have set it
                reader = null;
            }
        }
        if (state === 'end' || (src.total && src.loaded >= src.total)) finish();
    };

    src.loadAll = async () => {
        while (!src.done) {
            const before = src.loaded;
            await src.more();
            if (!src.done && src.loaded === before) throw new Error('no progress from SharePoint');
        }
    };
    return /** @type {Source} */ (src);
}

// First bytes -> text encoding, or null for binary
/** @param {Uint8Array} bytes @returns {string|null} encoding, or null for binary data */
export function sniffText(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    if (BINARY_MAGIC.some((sig) => sig.every((b, i) => bytes[i] === b))) return null;
    const head = bytes.subarray(0, SNIFF_BYTES);
    if (head.includes(0)) return null; // NUL bytes do not occur in text
    return 'utf-8';
}
