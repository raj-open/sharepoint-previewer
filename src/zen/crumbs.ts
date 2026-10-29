// Crumbs of the Zen list: site (its contents), library (with a menu of the site's libraries), the folders below it

// ===========================================================================
// IMPORTS
// ===========================================================================

import { esc } from '../_core/util.ts';
import { sameFile } from '../viewer/open.ts';

import type { Zen } from '../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const CRUMB_SEP = '<span class="tp-zen-sep">›</span>';

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns link target of a server-relative path */
const hrefOf = (path: string): string => esc(encodeURI(path));

/**
 * Folder path as links: site (once read), library (its title, once known; menu if the site has others),
 * then each folder below it. Site and libraries are ordinary links (new tab as usual), folders stay in the list.
 */
export function showCrumbs(z: Zen, library: string): void {
    const parts = z.folder.slice(library.length).split('/').filter(Boolean);
    const top = z.data?.title || (library.split('/').pop() ?? library);
    const crumbs = [top, ...parts].map((name, i) => {
        const folder = [library, ...parts.slice(0, i)].join('/');
        return i === parts.length
            ? `<strong title="${esc(folder)}">${esc(name)}</strong>`
            : `<a data-folder="${esc(folder)}" title="${esc(folder)}">${esc(name)}</a>`;
    });
    const site = z.site;
    if (site?.libraries.some((lib) => !sameFile(lib.folder, library))) {
        crumbs[0] +=
            '<button type="button" class="tp-zen-libs" data-libraries aria-haspopup="menu" ' +
            'title="Other libraries of the site">▾</button>';
    }
    if (site) {
        const link = `<a class="tp-zen-site" href="${hrefOf(site.url)}" title="Site contents">${esc(site.title)}</a>`;
        crumbs.unshift(link);
    }
    z.crumbs.innerHTML = crumbs.join(CRUMB_SEP);
}

/** Opens (or closes) the menu of the site's libraries below its button (links: Sharepoint opens the library) */
export function toggleLibraries(z: Zen, library: string, anchor: HTMLElement): void {
    const open = z.el.querySelector('.tp-zen-libraries');
    if (open) return void open.remove();
    if (!z.site) return;
    const menu = document.createElement('nav');
    menu.className = 'tp-menu tp-zen-libraries';
    menu.innerHTML = z.site.libraries
        .map((lib) => {
            const current = sameFile(lib.folder, library) ? ' aria-current="page"' : '';
            const title = esc(lib.folder);
            return `<a class="tp-menu-item" href="${hrefOf(lib.url)}" title="${title}"${current}>${esc(lib.title)}</a>`;
        })
        .join('');
    const box = z.el.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    menu.style.top = `${at.bottom - box.top + 4}px`;
    menu.style.left = `${Math.max(0, at.left - box.left)}px`;
    z.el.append(menu);
    const outside = (e: Event) => {
        if (menu.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
        menu.remove();
        document.removeEventListener('pointerdown', outside, true);
    };
    document.addEventListener('pointerdown', outside, true);
}
