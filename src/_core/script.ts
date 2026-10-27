// The running userscript: its version, Tampermonkey's editor of it

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns version of the running script ('' outside Tampermonkey) */
export function scriptVersion(): string {
    // NOTE: not `!== 'undefined'`: minified to `GM_info<"u"`, which editors read as type arguments (brackets then mismatch)
    return typeof GM_info === 'object' ? GM_info.script.version : '';
}

/**
 * Opens Tampermonkey's editor of this userscript in a new tab (e.g. to paste in a new release).
 * The URL is relative: Tampermonkey opens it within the extension,
 * so no extension id is needed (it differs per store and browser).
 */
export function openEditor(): void {
    GM_openInTab(`options.html#nav=${GM_info.script.uuid}+editor`, { active: true });
}
