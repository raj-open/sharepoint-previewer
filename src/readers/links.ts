// Links: .url shortcut files ("[InternetShortcut] URL=...") point to another file

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
                fetchUrl: id.split('/').map(encodeURIComponent).join('/'),
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
