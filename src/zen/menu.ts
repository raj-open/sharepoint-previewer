// Zen list menus: closed by a pointer down outside; the ⋯ menu (settings, dark mode, reload, about: last), as the viewer's

// ===========================================================================
// IMPORTS
// ===========================================================================

import { view } from '../_core/prefs.ts';
import { openSettingsForm } from '../_core/settings-form.ts';
import { esc } from '../_core/util.ts';
import { placeBelow } from '../ui/bar.ts';
import { ABOUT_SVG } from '../ui/icons.ts';
import { REFRESH_SVG } from '../ui/icons.ts';
import { SETTINGS_SVG } from '../ui/icons.ts';
import { THEME_SVG } from '../ui/icons.ts';
import { toggleTheme } from '../viewer/panel.ts';

import type { Zen } from '../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

/** Removes `menu` on a pointer down outside it and its button */
export function closeOutside(menu: HTMLElement, anchor: HTMLElement): void {
    const outside = (e: Event) => {
        if (menu.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
        menu.remove();
        document.removeEventListener('pointerdown', outside, true);
    };
    document.addEventListener('pointerdown', outside, true);
}

/** Opens (or closes) the ⋯ menu below its button (right-aligned); `reload`: the folder read anew */
export function toggleMore(z: Zen, anchor: HTMLElement, reload: () => void): void {
    const open = z.el.querySelector('.tp-zen-more');
    if (open) return void open.remove();
    const menu = document.createElement('div');
    menu.className = 'tp-menu tp-zen-more';
    const item = (svg: string, label: string, act: () => void, pressed?: boolean) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tp-menu-item';
        b.innerHTML = `${svg}<span>${esc(label)}</span>`;
        if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
        b.onclick = () => {
            menu.remove();
            act();
        };
        return b;
    };
    menu.append(
        item(SETTINGS_SVG, 'Full settings …', () => openSettingsForm()),
        item(THEME_SVG, 'Dark mode', toggleTheme, view.theme === 'dark'),
        item(REFRESH_SVG, 'Reload the folder', reload),
        item(ABOUT_SVG, 'About …', () => openSettingsForm('about')),
    );
    z.el.append(menu);
    placeBelow(menu, anchor, true);
    closeOutside(menu, anchor);
}
