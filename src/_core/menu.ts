// Tampermonkey menu: editor of the userscript, settings form, about, reset

// ===========================================================================
// IMPORTS
// ===========================================================================

import { openEditor } from './script.ts';
import { scriptVersion } from './script.ts';
import { openSettingsForm } from './settings-form.ts';
import { resetSettings } from './settings-form.ts';

// ===========================================================================
// METHODS
// ===========================================================================

/** Tampermonkey menu: entries shown without folding out the script's own entry. */
export function registerMenu(): void {
    GM_registerMenuCommand(`Edit (v${scriptVersion()})`, openEditor);
    GM_registerMenuCommand('Settings …', () => openSettingsForm());
    GM_registerMenuCommand('About …', () => openSettingsForm('about'));
    GM_registerMenuCommand('Reset settings', resetSettings);
}
