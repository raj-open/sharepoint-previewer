// Tab "About" of the settings form: name and version, installation in brief, controls hard to discover, links

// ===========================================================================
// IMPORTS
// ===========================================================================

import { ABOUT_LINKS } from './config.ts';
import { scriptVersion } from './script.ts';
import { esc } from './util.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const APP_NAME = 'Sharepoint Previewer';

// Installation in brief (cf. /INSTALL.md)
const INSTALL = [
    'Tampermonkey (browser extension, user scripts allowed): a new script, ' +
        '<code>sharepoint-previewer.min.js</code> of a release pasted in, saved; then reload the Sharepoint page.',
    'Upgrade: Tampermonkey menu → Edit, the new release pasted over the old one.',
    '3D view (optional): <code>ifc-lite-3d.js</code> and <code>ifc-lite_bg.wasm</code> of the same release ' +
        'in a Sharepoint folder, named in the setting "3D viewer folder".',
    'Zen mode and search read through the Sharepoint API (setting "Use the Sharepoint API").',
];

// Controls hard to discover: gesture, what it does
export const CONTROLS: [string, string][] = [
    ['Eye (Sharepoint list)', 'file: preview; folder: the viewer for it; header: the viewer without a file'],
    ['Click (Zen list)', 'file: preview; folder: open it'],
    ['Checkbox, Shift + click', 'select; select a range'],
    ['Ctrl / ⌘ + click (Zen list)', 'select a row (or drop it) without opening it'],
    ['Delete, ⌘ + Backspace (Zen list)', "delete the items selected (asks first; to the site's recycle bin)"],
    ['Ctrl / ⌘ + A (text view)', 'select the whole text'],
    ['Ctrl / ⌘ + S', 'save (editing, Zen edit and layout mode, settings)'],
    ['Esc', 'leave editing; again: close the viewer'],
];

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns links of ABOUT_LINKS that may be shown (http or https only) */
export const aboutLinks = (links: Record<string, string> = ABOUT_LINKS): [string, string][] =>
    Object.entries(links ?? {}).filter(([label, url]) => label && /^https?:\/\/\S+$/i.test(url));

/**
 * @param c colours of the form (text muted, borders)
 * @param links label -> URL (default: ABOUT_LINKS); none: no link section
 * @returns HTML of the tab "About"
 */
export function aboutHtml(c: { muted: string; border: string }, links?: Record<string, string>): string {
    const version = scriptVersion();
    const head = `<h4 style="margin:0 0 2px; font-size:15px">${APP_NAME}${version ? ` v${esc(version)}` : ''}</h4>`;
    const section = (title: string, body: string) =>
        `<section style="margin-top:14px"><h5 style="margin:0 0 6px; font-size:13px">${title}</h5>${body}</section>`;
    const install = `<ul style="margin:0; padding-left:18px; line-height:1.6">${INSTALL.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    const kbd = `padding:1px 6px; border:1px solid ${c.border}; border-radius:4px; white-space:nowrap`;
    const controls =
        '<div style="display:grid; grid-template-columns:max-content 1fr; gap:6px 16px; align-items:baseline">' +
        CONTROLS.map(
            ([key, what]) => `<span><kbd style="${kbd}">${esc(key)}</kbd></span><span>${esc(what)}</span>`,
        ).join('') +
        '</div>';
    const shown = aboutLinks(links);
    const linkList = shown
        .map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`)
        .join(' · ');
    return (
        `<div data-about style="line-height:1.4">${head}` +
        `<div style="color:${c.muted}">Preview and editor for files in Sharepoint Online document libraries.</div>` +
        section('Installation', install) +
        section('Controls', controls) +
        (shown.length ? section('Links', `<div data-links>${linkList}</div>`) : '') +
        '</div>'
    );
}
