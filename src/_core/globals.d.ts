// Tampermonkey API granted to the userscript (cf. @grant in /src/_core/header.js); types only, not bundled

declare function GM_getValue(key: string, fallback?: unknown): unknown;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_registerMenuCommand(label: string, onClick: () => void): void;
declare function GM_openInTab(url: string, options?: { active?: boolean }): void;
declare const GM_info: { script: { version: string; uuid: string } };

// Selectors in this script target HTML elements (the one exception, icons incl. SVG, is typed as Element where used).
// Results may still be null: callers check.
interface ParentNode {
    querySelector<E extends HTMLElement = HTMLElement>(selectors: string): E | null;
    querySelectorAll<E extends HTMLElement = HTMLElement>(selectors: string): NodeListOf<E>;
}
interface Element {
    closest<E extends HTMLElement = HTMLElement>(selectors: string): E | null;
}
