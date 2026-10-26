// Links: .url shortcut files ("[InternetShortcut] URL=...") point to another file; clean URLs of files and folders

// ===========================================================================
// IMPORTS
// ===========================================================================

import { encodePath } from './request.ts';

// ===========================================================================
// METHODS
// ===========================================================================

export function linkTarget(name: string, text: string): { display: string; name: string; fetchUrl: string } | null {
    if (!/\.url$/i.test(name) && !/^\s*\[InternetShortcut\]/i.test(text)) return null;
    const m = text.match(/^\s*URL\s*=\s*(\S+)\s*$/im);
    if (!m) return null;

    let target: URL;
    try {
        target = new URL(m[1], location.href);
    } catch {
        return null;
    }
    const display = decodeURIComponent(target.href);

    if (target.hostname === location.hostname) {
        const params = target.searchParams;
        // Viewer pages (.../AllItems.aspx?id=/sites/X/file.txt, Doc.aspx?id=...)
        const id = params.get('id');
        if (/\.aspx$/i.test(target.pathname) && id) {
            return {
                display,
                name: id.split('/').pop() ?? '',
                fetchUrl: encodePath(id),
            };
        }
        // Direct links: /:t:/r/sites/X/file.txt?web=1 -> /sites/X/file.txt
        const direct = target.pathname.match(/^\/:[a-z]:\/r(\/.*)$/i);
        if (direct) {
            return { display, name: decodeURIComponent(direct[1]).split('/').pop() ?? '', fetchUrl: direct[1] };
        }
        // Share links: /:t:/s/... or /:t:/g/... -> raw file
        if (/^\/:[a-z]:\/[sg]\//i.test(target.pathname)) {
            params.delete('web');
            params.set('download', '1');
            return { display, name: '', fetchUrl: target.href };
        }
    }
    // Other sites not followed (openSource() refuses other origins)
    const last = decodeURIComponent(target.pathname).split('/').pop();
    return { display, name: last ?? '', fetchUrl: target.href };
}

// ---------------------------------------------------------------------------
// Clean URLs: origin + path, not encoded, without query or fragment
// ---------------------------------------------------------------------------

/** @returns server-relative path a Sharepoint URL stands for (viewer pages: their id; direct links: /:t:/r/ dropped), not encoded */
export function serverPath(u: URL): string {
    const id = u.searchParams.get('id');
    if (/\.aspx$/i.test(u.pathname) && id) return id;
    return decode(u.pathname.replace(/^\/:[a-z]:\/r(?=\/)/i, ''));
}

/**
 * @param place server-relative path (as Sharepoint names it, not encoded) or URL (absolute, may be encoded)
 * @returns full URL as a person reads it: not encoded, no query, no fragment, no trailing "/"
 */
export function cleanUrl(place: string): string {
    if (/^\/(?!\/)/.test(place)) return `${location.origin}${place.replace(/\/+$/, '')}`;
    let u: URL;
    try {
        u = new URL(place, location.href);
    } catch {
        return place;
    }
    const path = u.origin === location.origin ? serverPath(u) : decode(u.pathname);
    return `${u.origin}${path.replace(/\/+$/, '')}`;
}

// ===========================================================================
// AUXILIARY METHODS
// ===========================================================================

/** @returns decoded, or as is if not valid (e.g. a lone "%") */
function decode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
