// Icons (inline SVG): eyes, modes, buttons

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Closed eye: lid line with lashes
export const EYE_CLOSED_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 10s4 6 10 6 10-6 10-6"/>
    <path d="M5.5 14l-1.5 2.2M12 16v2.6M18.5 14l1.5 2.2"/>
  </svg>
`;

// Half-open eye: lowered lid, lower half of pupil visible
export const EYE_HALF_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4 7 11 7 11-7 11-7"/>
    <path d="M1 12c3-2.5 7-3.5 11-3.5s8 1 11 3.5"/>
    <path d="M9 12a3 3 0 0 0 6 0z" fill="currentColor"/>
  </svg>
`;

// Fully open eye with lashes (file completely cached; also column header)
export const EYE_FULL_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 13.5s4-6 11-6 11 6 11 6-4 6-11 6-11-6-11-6z"/>
    <circle cx="12" cy="13.5" r="2.8"/>
    <path d="M12 7.5V4.2M6.6 8.6L5 6.3M17.4 8.6L19 6.3"/>
  </svg>
`;

export const COPY_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
`;

export const CHECK_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
`;

// ---------------------------------------------------------------------------
// Viewer: popup (default), vertical split (preview right), horizontal split (preview below)
// ---------------------------------------------------------------------------

// Mode icons: filled part is where preview goes
export const SPLIT_V_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7z" fill="currentColor"/>
  </svg>
`;

export const POPUP_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor"/>
  </svg>
`;

// Palette: syntax colours
export const COLOUR_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2
             0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.4-9-7.4z"/>
    <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor"/>
    <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor"/>
    <circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>
  </svg>
`;

export const REFRESH_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
    <polyline points="21 3 21 9 15 9"/>
  </svg>
`;

// Cache all: filled top part, arrow down to whole frame
// Half-filled circle: light / dark
export const THEME_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>
  </svg>
`;

// Grid: table view
// Lines of text (text view)
export const TEXT_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M4 6h16M4 10h16M4 14h11M4 18h14"/>
  </svg>
`;
// Cube (3D view)
export const CUBE_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z"/>
    <path d="M3.5 7.25L12 12l8.5-4.75M12 12v9.5"/>
  </svg>
`;
export const TABLE_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2"/>
    <path d="M3 9h18M3 14.5h18M9.5 9v11M15.5 9v11"/>
    <path d="M3 4h18v5H3z" fill="currentColor" stroke="none" opacity=".35"/>
  </svg>
`;

// Cloud with arrow: upload
export const UPLOAD_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M7 18a4.5 4.5 0 0 1-.8-8.9A6 6 0 0 1 17.8 8a4 4 0 0 1-.8 10"/>
    <path d="M12 12v8M9 15l3-3 3 3"/>
  </svg>
`;

// Three dots: more options
export const MORE_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>
  </svg>
`;

// Small bin: delete table column
export const BIN_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>
  </svg>
`;

export const SAVE_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
    <path d="M7 3v5h8V3"/>
    <rect x="7" y="13" width="10" height="8"/>
  </svg>
`;

// Pen: write mode
export const WRITE_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>
  </svg>
`;

// Cancel: circle with diagonal slash (⊘)
export const STOP_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/>
    <path d="M5.6 5.6l12.8 12.8"/>
  </svg>
`;

export const CLEAR_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="4 7 20 7"/>
    <path d="M9 7V4h6v3"/>
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>
    <line x1="10" y1="11" x2="10" y2="17"/>
    <line x1="14" y1="11" x2="14" y2="17"/>
  </svg>
`;

export const LOAD_ALL_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M3 9V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4z" fill="currentColor"/>
    <path d="M12 12v6"/>
    <polyline points="9 15 12 18 15 15"/>
  </svg>
`;

export const SETTINGS_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M19.12 10.41 L21.52 10.76 L21.52 13.24 L19.12 13.59 L18.16 15.91 L19.61 17.85 L17.85 19.61 L15.91 18.16 L13.59 19.12 L13.24 21.52 L10.76 21.52 L10.41 19.12 L8.09 18.16 L6.15 19.61 L4.39 17.85 L5.84 15.91 L4.88 13.59 L2.48 13.24 L2.48 10.76 L4.88 10.41 L5.84 8.09 L4.39 6.15 L6.15 4.39 L8.09 5.84 L10.41 4.88 L10.76 2.48 L13.24 2.48 L13.59 4.88 L15.91 5.84 L17.85 4.39 L19.61 6.15 L18.16 8.09Z"/><circle cx="12" cy="12" r="3"/></svg>`; // gear
export const PROPS_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>`;
export const WRAP_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="3" y1="6" x2="21" y2="6"/>
    <path d="M3 12h15a3 3 0 0 1 0 6h-4"/>
    <polyline points="16 16 14 18 16 20"/>
    <line x1="3" y1="18" x2="10" y2="18"/>
  </svg>
`;

export const SPLIT_H_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M3 12h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor"/>
  </svg>
`;
