// Tampermonkey menu: settings form, reset to defaults, editor of the userscript

// ===========================================================================
// IMPORTS
// ===========================================================================

import { openSettingsForm } from './settings-form.ts';
import { resetSettings } from './settings-form.ts';

// ===========================================================================
// METHODS
// ===========================================================================

/** Tampermonkey menu: entries shown without folding out the script's own entry. */
export function registerMenu(): void {
    GM_registerMenuCommand('Settings …', openSettingsForm);
    GM_registerMenuCommand('Reset settings to defaults', resetSettings);
    GM_registerMenuCommand('Edit plugin', openEditor);
}

/**
 * Opens Tampermonkey's editor of this userscript in a new tab.
 * The URL is relative: Tampermonkey opens it within the extension,
 * so no extension id is needed (it differs per store and browser).
 */
export function openEditor(): void {
    GM_openInTab(`options.html#nav=${GM_info.script.uuid}+editor`, { active: true });
}
